import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { AdapterFactoryService } from '../../../infrastructure/adapters/adapter-factory.service';
import { RepositoriesService } from './repositories.service';
import { GitProviderPort } from '../../../ports/git-provider.port';

export interface DetectedStack {
  language?: string;
  framework?: string;
  packageManager?: string;
  runtime?: string;
}

export interface DetectedCi {
  provider: 'github-actions' | 'gitlab-ci' | 'other' | 'none';
  workflows: string[];
  triggers: string[];
}

/**
 * Auto-analysis of a connected repo — runs entirely over the git provider REST
 * API (getFileContent/listFiles), so NO clone and NO executor container are
 * needed. Detects the tech stack and CI, then asks the default AI provider for
 * a one-paragraph summary. Also suggests related repos (same name prefix) the
 * user might want to connect to the same portal.
 */
@Injectable()
export class RepoAnalysisService {
  private readonly logger = new Logger(RepoAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactoryService,
    private readonly repositories: RepositoriesService,
  ) {}

  /**
   * Analyze every repo in the org still marked `pending` (e.g. right after an
   * import). Fire-and-forget from the caller — failures are swallowed per-repo.
   */
  async analyzePending(organizationId: string): Promise<void> {
    const pending = await this.prisma.repository.findMany({
      where: { organizationId, analysisStatus: 'pending' },
      select: { id: true },
    });
    for (const { id } of pending) {
      try {
        await this.analyze(organizationId, id);
      } catch {
        // already marked failed inside analyze(); continue with the rest.
      }
    }
  }

  async analyze(organizationId: string, repositoryId: string) {
    const repo = await this.prisma.repository.findFirst({
      where: { id: repositoryId, organizationId },
    });
    if (!repo) throw new NotFoundException(`Repository ${repositoryId} not found`);

    await this.prisma.repository.update({
      where: { id: repositoryId },
      data: { analysisStatus: 'analyzing' },
    });

    try {
      const git = await this.adapterFactory.createGitProviderFromIntegration(
        organizationId,
        repo.integrationId,
      );
      // GitHub uses full_name as its externalId; GitLab uses the numeric id —
      // both are what listBranches already passes, so reuse externalId.
      const repoRef = repo.externalId;

      const [stack, ci] = await Promise.all([
        this.detectStack(git, repoRef, repo.defaultBranch),
        this.detectCi(git, repoRef, repo.defaultBranch),
      ]);

      const summary = await this.summarize(
        organizationId,
        repo.name,
        repo.description,
        stack,
        ci,
      );

      const related = await this.findRelatedRepos(organizationId, repo.name);

      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: {
          stack: stack as object,
          ciSummary: ci as object,
          summary,
          analyzedAt: new Date(),
          analysisStatus: 'done',
        },
      });

      return { stack, ciSummary: ci, summary, related };
    } catch (err) {
      this.logger.warn(
        `Analysis failed for repo ${repositoryId}: ${(err as Error).message}`,
      );
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { analysisStatus: 'failed' },
      });
      throw err;
    }
  }

  /** Read package.json (Node) to infer language/framework/package manager. */
  private async detectStack(
    git: GitProviderPort,
    repoRef: string,
    branch: string,
  ): Promise<DetectedStack> {
    const stack: DetectedStack = {};
    const pkg = await this.tryFile(git, repoRef, 'package.json', branch);
    if (pkg) {
      stack.language = 'TypeScript/JavaScript';
      stack.runtime = 'Node.js';
      try {
        const json = JSON.parse(pkg) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...json.dependencies, ...json.devDependencies };
        if (deps.next) stack.framework = 'Next.js';
        else if (deps.astro) stack.framework = 'Astro';
        else if (deps['@nestjs/core']) stack.framework = 'NestJS';
        else if (deps.react) stack.framework = 'React';
        else if (deps.vue) stack.framework = 'Vue';
        else if (deps.express) stack.framework = 'Express';
      } catch {
        // package.json unparseable — keep the runtime hint only.
      }
    }

    // Lockfile → package manager.
    const files = await this.tryList(git, repoRef, '', branch);
    const names = new Set(files.map((f) => f.name));
    if (names.has('pnpm-lock.yaml')) stack.packageManager = 'pnpm';
    else if (names.has('yarn.lock')) stack.packageManager = 'yarn';
    else if (names.has('package-lock.json')) stack.packageManager = 'npm';
    else if (names.has('bun.lockb')) stack.packageManager = 'bun';

    // Non-Node hints.
    if (!pkg) {
      if (names.has('go.mod')) stack.language = 'Go';
      else if (names.has('Cargo.toml')) stack.language = 'Rust';
      else if (names.has('requirements.txt') || names.has('pyproject.toml'))
        stack.language = 'Python';
      else if (names.has('composer.json')) stack.language = 'PHP';
    }

    return stack;
  }

  /** Detect CI: GitHub Actions workflows or a GitLab CI file. */
  private async detectCi(
    git: GitProviderPort,
    repoRef: string,
    branch: string,
  ): Promise<DetectedCi> {
    const workflows = await this.tryList(
      git,
      repoRef,
      '.github/workflows',
      branch,
    );
    if (workflows.length > 0) {
      const ymls = workflows
        .filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name))
        .map((f) => f.name);
      const triggers = new Set<string>();
      // Peek at a couple of workflows to learn their triggers.
      for (const name of ymls.slice(0, 3)) {
        const body = await this.tryFile(
          git,
          repoRef,
          `.github/workflows/${name}`,
          branch,
        );
        if (!body) continue;
        for (const t of ['push', 'pull_request', 'workflow_dispatch', 'schedule', 'release']) {
          if (new RegExp(`\\b${t}\\b`).test(body)) triggers.add(t);
        }
      }
      return {
        provider: 'github-actions',
        workflows: ymls,
        triggers: [...triggers],
      };
    }

    const gitlabCi = await this.tryFile(git, repoRef, '.gitlab-ci.yml', branch);
    if (gitlabCi) {
      return { provider: 'gitlab-ci', workflows: ['.gitlab-ci.yml'], triggers: [] };
    }

    return { provider: 'none', workflows: [], triggers: [] };
  }

  /** Ask the default AI provider for a short human summary of the repo. */
  private async summarize(
    organizationId: string,
    name: string,
    description: string | null,
    stack: DetectedStack,
    ci: DetectedCi,
  ): Promise<string> {
    const ai = await this.adapterFactory.getDefaultAIProvider(organizationId);
    const facts = [
      `Repo: ${name}`,
      description ? `Description: ${description}` : '',
      `Stack: ${JSON.stringify(stack)}`,
      `CI: ${JSON.stringify(ci)}`,
    ]
      .filter(Boolean)
      .join('\n');

    if (!ai) {
      // No AI key — still return a useful factual summary.
      const parts = [stack.framework || stack.language, stack.runtime]
        .filter(Boolean)
        .join(', ');
      const ciNote =
        ci.provider === 'none' ? 'no CI detected' : `CI: ${ci.provider}`;
      return [parts, ciNote].filter(Boolean).join(' · ');
    }

    const res = await ai.complete(
      [
        {
          role: 'user',
          content: `In one or two sentences, describe what this repository is and how it ships, based on these facts. Be concrete, no fluff.\n\n${facts}`,
        },
      ],
      { maxTokens: 300 },
    );
    return res.content.trim();
  }

  /** Suggest not-yet-connected repos that share this repo's name prefix. */
  private async findRelatedRepos(organizationId: string, name: string) {
    // e.g. "dronexamine-web" → prefix "dronexamine"
    const prefix = name.split(/[-_.]/)[0]?.toLowerCase();
    if (!prefix || prefix.length < 3) return [];

    try {
      const remote = await this.repositories.listRemoteRepositories(
        organizationId,
      );
      return remote
        .filter(
          (r) =>
            !r.alreadyImported &&
            r.name.toLowerCase().startsWith(prefix) &&
            r.name.toLowerCase() !== name.toLowerCase(),
        )
        .slice(0, 8)
        .map((r) => ({
          externalId: r.externalId,
          name: r.name,
          fullPath: r.fullPath,
          integrationId: r.integrationId,
          provider: r.provider,
        }));
    } catch (err) {
      this.logger.debug(
        `Related-repo lookup skipped: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async tryFile(
    git: GitProviderPort,
    repoRef: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    try {
      return await git.getFileContent(repoRef, path, ref);
    } catch {
      return null;
    }
  }

  private async tryList(
    git: GitProviderPort,
    repoRef: string,
    path: string,
    ref: string,
  ) {
    try {
      return await git.listFiles(repoRef, path, ref);
    } catch {
      return [];
    }
  }
}
