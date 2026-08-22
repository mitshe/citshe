import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { AdapterFactoryService } from '../../../infrastructure/adapters/adapter-factory.service';
import { EncryptionService } from '../../../shared/encryption/encryption.service';
import { GithubAppService } from '../../../infrastructure/adapters/git-provider/github-app.service';
import { GitHubAdapter } from '../../../infrastructure/adapters/git-provider/github.adapter';
import {
  IntegrationType,
  GitProvider,
  IntegrationStatus,
} from '@prisma/client';
import type {
  RepositoryOverview,
  RepoCiStatus,
  RepoWorkflowRun,
} from '@citshe/types';
import {
  UpdateRepositoryDto,
  BulkUpdateRepositoriesDto,
} from '../dto/repository.dto';

@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactoryService,
    private readonly encryption: EncryptionService,
    private readonly githubApp: GithubAppService,
  ) {}

  /** Read an integration's mode + installationId (GitHub App), if any. */
  private appInstallation(integration: {
    config: Uint8Array;
    configIv: Uint8Array;
  }): string | null {
    try {
      const config = this.encryption.decryptJson<Record<string, string>>(
        Buffer.from(integration.config),
        Buffer.from(integration.configIv),
      );
      return config.mode === 'app' ? config.installationId : null;
    } catch {
      return null;
    }
  }

  /**
   * Get all repositories for an organization
   */
  async findAll(organizationId: string, options?: { isActive?: boolean }) {
    return this.prisma.repository.findMany({
      where: {
        organizationId,
        ...(options?.isActive !== undefined && { isActive: options.isActive }),
      },
      include: {
        integration: {
          select: {
            id: true,
            type: true,
            status: true,
          },
        },
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Get a single repository
   */
  async findOne(organizationId: string, id: string) {
    const repository = await this.prisma.repository.findFirst({
      where: { id, organizationId },
      include: {
        integration: {
          select: {
            id: true,
            type: true,
            status: true,
          },
        },
      },
    });

    if (!repository) {
      throw new NotFoundException(`Repository ${id} not found`);
    }

    return repository;
  }

  /**
   * Update repository settings
   */
  async update(organizationId: string, id: string, dto: UpdateRepositoryDto) {
    await this.findOne(organizationId, id);

    return this.prisma.repository.update({
      where: { id },
      data: dto,
      include: {
        integration: {
          select: {
            id: true,
            type: true,
            status: true,
          },
        },
      },
    });
  }

  /**
   * Bulk update repositories (enable/disable)
   */
  async bulkUpdate(organizationId: string, dto: BulkUpdateRepositoriesDto) {
    const result = await this.prisma.repository.updateMany({
      where: {
        id: { in: dto.ids },
        organizationId,
      },
      data: { isActive: dto.isActive },
    });

    return { updated: result.count };
  }

  /**
   * List branches for a repository from the git provider
   */
  async listBranches(
    organizationId: string,
    repositoryId: string,
    search?: string,
  ) {
    const repo = await this.findOne(organizationId, repositoryId);

    if (!repo.integration) {
      throw new BadRequestException('Repository has no linked integration');
    }

    const gitProvider =
      await this.adapterFactory.createGitProviderFromIntegration(
        organizationId,
        repo.integration.id,
      );

    return gitProvider.listBranches(repo.externalId, {
      search,
      limit: 100,
    });
  }

  /**
   * Build the static GitHub web links for a repo from its webUrl / fullPath.
   * These always work (no API call), so they are the resilient fallback when
   * every dynamic section fails.
   */
  private buildLinks(repo: {
    webUrl: string | null;
    fullPath: string;
  }): RepositoryOverview['links'] {
    const github = (
      repo.webUrl ||
      `https://github.com/${repo.fullPath}`
    ).replace(/\/+$/, '');
    return {
      github,
      actions: `${github}/actions`,
      pulls: `${github}/pulls`,
      branches: `${github}/branches`,
      commits: `${github}/commits`,
    };
  }

  /** Map a GitHub Actions run's status/conclusion to a coarse CI status. */
  private mapCiStatus(
    status: string | null,
    conclusion: string | null,
  ): RepoCiStatus {
    if (status === 'in_progress' || status === 'queued') {
      return 'running';
    }
    if (conclusion === 'success') {
      return 'passing';
    }
    if (
      conclusion === 'failure' ||
      conclusion === 'timed_out' ||
      conclusion === 'startup_failure'
    ) {
      return 'failing';
    }
    return 'unknown';
  }

  /**
   * Repo detail overview: GitHub CI/CD data (last workflow run, recent commits,
   * open PRs, branches) plus static quick links.
   *
   * Fully resilient: static links are always returned; each dynamic section is
   * fetched in its own try/catch and set to null/empty on failure so a missing
   * token scope (e.g. no Actions read) never breaks the whole endpoint. Never
   * throws except when the repo itself is not found (404) via findOne.
   */
  async getOverview(
    organizationId: string,
    id: string,
  ): Promise<RepositoryOverview> {
    const repo = await this.findOne(organizationId, id);

    const overview: RepositoryOverview = {
      ci: null,
      commits: [],
      pulls: { open: 0, items: [] },
      branches: { count: 0, items: [] },
      links: this.buildLinks(repo),
    };

    // Only GitHub is supported today; other providers get links-only.
    if (repo.provider !== GitProvider.GITHUB || !repo.integration) {
      return overview;
    }

    let adapter: GitHubAdapter;
    try {
      const provider =
        await this.adapterFactory.createGitProviderFromIntegration(
          organizationId,
          repo.integration.id,
        );
      if (!(provider instanceof GitHubAdapter)) {
        return overview;
      }
      adapter = provider;
    } catch (error) {
      // Can't build the client (e.g. integration disconnected) → links only.
      this.logger.warn(
        `Overview: failed to build GitHub adapter for repo ${id}: ${(error as Error).message}`,
      );
      return overview;
    }

    const repoId = repo.externalId;

    // 1) CI status from the latest workflow runs.
    try {
      const runs = await adapter.listWorkflowRuns(repoId, 5);
      if (runs.length > 0) {
        const recent: RepoWorkflowRun[] = runs.map((r) => ({
          name: r.name,
          branch: r.headBranch,
          sha: r.headSha,
          url: r.htmlUrl,
          when: r.createdAt,
          event: r.event,
          status: this.mapCiStatus(r.status, r.conclusion),
        }));
        overview.ci = {
          status: recent[0].status,
          run: recent[0],
          recent,
        };
      } else {
        // No runs at all still counts as a successful read → empty CI section.
        overview.ci = { status: 'unknown', recent: [] };
      }
    } catch (error) {
      this.logger.debug(
        `Overview: workflow runs unavailable for repo ${id}: ${(error as Error).message}`,
      );
      overview.ci = null;
    }

    // 2) Recent commits (scoped to the default branch when known).
    try {
      const commits = await adapter.listCommits(repoId, {
        sha: repo.defaultBranch || undefined,
        limit: 5,
      });
      overview.commits = commits.map((c) => ({
        sha: c.sha,
        message: c.message,
        author: c.author,
        when: c.date,
        url: c.htmlUrl,
      }));
    } catch (error) {
      this.logger.debug(
        `Overview: commits unavailable for repo ${id}: ${(error as Error).message}`,
      );
      overview.commits = [];
    }

    // 3) Open pull requests.
    try {
      const prs = await adapter.listOpenPullRequests(repoId, 10);
      overview.pulls = {
        open: prs.length,
        items: prs.map((pr) => ({
          number: pr.number,
          title: pr.title,
          author: pr.author,
          branch: pr.headRef,
          url: pr.htmlUrl,
          when: pr.createdAt,
          draft: pr.draft,
        })),
      };
    } catch (error) {
      this.logger.debug(
        `Overview: pull requests unavailable for repo ${id}: ${(error as Error).message}`,
      );
      overview.pulls = { open: 0, items: [] };
    }

    // 4) Branches.
    try {
      const branches = await adapter.listBranchesRaw(repoId, 20);
      overview.branches = {
        count: branches.length,
        items: branches.map((b) => ({
          name: b.name,
          protected: b.protected,
        })),
      };
    } catch (error) {
      this.logger.debug(
        `Overview: branches unavailable for repo ${id}: ${(error as Error).message}`,
      );
      overview.branches = { count: 0, items: [] };
    }

    return overview;
  }

  /**
   * Delete a repository
   */
  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.repository.delete({ where: { id } });
  }

  /**
   * Bulk delete repositories
   */
  async bulkDelete(organizationId: string, ids: string[]) {
    const result = await this.prisma.repository.deleteMany({
      where: {
        id: { in: ids },
        organizationId,
      },
    });

    return { deleted: result.count };
  }

  /**
   * List remote repositories from all connected git integrations without importing
   */
  async listRemoteRepositories(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: {
        organizationId,
        status: IntegrationStatus.CONNECTED,
        type: IntegrationType.GITHUB,
      },
    });

    const existingRepos = await this.prisma.repository.findMany({
      where: { organizationId },
      select: { provider: true, externalId: true },
    });

    const existingSet = new Set(
      existingRepos.map((r) => `${r.provider}:${r.externalId}`),
    );

    const results: Array<{
      externalId: string;
      name: string;
      fullPath: string;
      description: string | null;
      defaultBranch: string;
      webUrl: string;
      provider: GitProvider;
      integrationId: string;
      alreadyImported: boolean;
    }> = [];

    for (const integration of integrations) {
      try {
        const provider = this.mapIntegrationToGitProvider(integration.type);
        const installationId = this.appInstallation(integration);

        if (installationId) {
          // GitHub App: list exactly the repos granted to the installation.
          const repos =
            await this.githubApp.listInstallationRepos(installationId);
          for (const remote of repos) {
            results.push({
              externalId: remote.full_name,
              name: remote.name,
              fullPath: remote.full_name,
              description: remote.description ?? null,
              defaultBranch: remote.default_branch,
              webUrl: remote.html_url,
              provider,
              integrationId: integration.id,
              alreadyImported: existingSet.has(
                `${provider}:${remote.full_name}`,
              ),
            });
          }
          continue;
        }

        const adapter =
          await this.adapterFactory.createGitProviderFromIntegration(
            organizationId,
            integration.id,
          );
        const remoteRepos = await adapter.listRepositories({ limit: 100 });

        for (const remote of remoteRepos) {
          results.push({
            externalId: remote.id,
            name: remote.name,
            fullPath: remote.fullName,
            description: remote.description ?? null,
            defaultBranch: remote.defaultBranch,
            webUrl: remote.webUrl,
            provider,
            integrationId: integration.id,
            alreadyImported: existingSet.has(`${provider}:${remote.id}`),
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to list repos from ${integration.type}: ${(error as Error).message}`,
        );
      }
    }

    return results;
  }

  /**
   * Sync repositories from a git provider integration
   */
  async syncFromIntegration(
    organizationId: string,
    integrationId: string,
    externalIds?: string[],
  ) {
    // Get the integration
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        organizationId,
        status: IntegrationStatus.CONNECTED,
        type: IntegrationType.GITHUB,
      },
    });

    if (!integration) {
      throw new NotFoundException(
        `Git integration ${integrationId} not found or not connected`,
      );
    }

    // Fetch remote repositories (GitHub App installation or PAT), normalized.
    this.logger.log(`Syncing repositories from ${integration.type}...`);
    const installationId = this.appInstallation(integration);
    let allRemoteRepos: Array<{
      id: string;
      name: string;
      fullName: string;
      description: string | null;
      defaultBranch: string;
      cloneUrl: string;
      webUrl: string;
    }>;

    if (installationId) {
      const repos = await this.githubApp.listInstallationRepos(installationId);
      allRemoteRepos = repos.map((r) => ({
        id: r.full_name,
        name: r.name,
        fullName: r.full_name,
        description: r.description ?? null,
        defaultBranch: r.default_branch,
        cloneUrl: r.clone_url,
        webUrl: r.html_url,
      }));
    } else {
      const adapter =
        await this.adapterFactory.createGitProviderFromIntegration(
          organizationId,
          integrationId,
        );
      const remote = await adapter.listRepositories({ limit: 100 });
      allRemoteRepos = remote.map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.fullName,
        description: r.description ?? null,
        defaultBranch: r.defaultBranch,
        cloneUrl: r.cloneUrl,
        webUrl: r.webUrl,
      }));
    }

    // Filter by external IDs if provided
    const remoteRepos = externalIds
      ? allRemoteRepos.filter((r) => externalIds.includes(r.id))
      : allRemoteRepos;

    // Map provider type
    const provider = this.mapIntegrationToGitProvider(integration.type);

    // Sync to database using upsert to prevent race conditions
    // This handles concurrent syncs that might try to create the same repository
    const results = {
      synced: 0,
      total: remoteRepos.length,
    };

    for (const remote of remoteRepos) {
      try {
        // Use upsert for atomic create-or-update operation
        // This prevents TOCTOU race condition from check-then-create/update
        await this.prisma.repository.upsert({
          where: {
            organizationId_provider_externalId: {
              organizationId,
              provider,
              externalId: remote.id,
            },
          },
          update: {
            name: remote.name,
            fullPath: remote.fullName,
            description: remote.description,
            defaultBranch: remote.defaultBranch,
            cloneUrl: remote.cloneUrl,
            webUrl: remote.webUrl,
            lastSyncedAt: new Date(),
          },
          create: {
            organizationId,
            integrationId,
            provider,
            externalId: remote.id,
            name: remote.name,
            fullPath: remote.fullName,
            description: remote.description,
            defaultBranch: remote.defaultBranch,
            cloneUrl: remote.cloneUrl,
            webUrl: remote.webUrl,
            isActive: true, // Connected repos are active in the portal
            analysisStatus: 'pending',
            lastSyncedAt: new Date(),
          },
        });
        results.synced++;
      } catch (error) {
        this.logger.error(
          `Failed to sync repository ${remote.id}: ${(error as Error).message}`,
        );
      }
    }

    // Update integration last sync
    await this.prisma.integration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date() },
    });

    this.logger.log(
      `Sync complete: ${results.synced} of ${results.total} repositories synced`,
    );

    return results;
  }

  /**
   * Sync all git integrations for an organization (imports new repos via upsert)
   */
  async syncAll(organizationId: string) {
    const integrations = await this.prisma.integration.findMany({
      where: {
        organizationId,
        status: IntegrationStatus.CONNECTED,
        type: IntegrationType.GITHUB,
      },
    });

    const results = {
      integrations: integrations.length,
      totalSynced: 0,
      totalRepositories: 0,
      errors: [] as string[],
    };

    for (const integration of integrations) {
      try {
        const syncResult = await this.syncFromIntegration(
          organizationId,
          integration.id,
        );
        results.totalSynced += syncResult.synced;
        results.totalRepositories += syncResult.total;
      } catch (error) {
        const message = `Failed to sync ${integration.type}: ${(error as Error).message}`;
        this.logger.error(message);
        results.errors.push(message);
      }
    }

    return results;
  }

  /**
   * Sync only already-imported repositories (update metadata, no new imports)
   */
  async syncExisting(organizationId: string) {
    const existingRepos = await this.prisma.repository.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        externalId: true,
        integrationId: true,
      },
    });

    if (existingRepos.length === 0) {
      return { synced: 0, total: 0 };
    }

    // Group by integrationId
    const byIntegration = new Map<
      string,
      Array<{ id: string; externalId: string }>
    >();
    for (const repo of existingRepos) {
      const list = byIntegration.get(repo.integrationId) || [];
      list.push({ id: repo.id, externalId: repo.externalId });
      byIntegration.set(repo.integrationId, list);
    }

    const results = { synced: 0, total: existingRepos.length };

    for (const [integrationId, repos] of byIntegration) {
      try {
        const adapter =
          await this.adapterFactory.createGitProviderFromIntegration(
            organizationId,
            integrationId,
          );
        const remoteRepos = await adapter.listRepositories({ limit: 100 });
        const remoteMap = new Map(remoteRepos.map((r) => [r.id, r]));

        for (const repo of repos) {
          const remote = remoteMap.get(repo.externalId);
          if (!remote) continue;

          try {
            await this.prisma.repository.update({
              where: { id: repo.id },
              data: {
                name: remote.name,
                fullPath: remote.fullName,
                description: remote.description,
                defaultBranch: remote.defaultBranch,
                cloneUrl: remote.cloneUrl,
                webUrl: remote.webUrl,
                lastSyncedAt: new Date(),
              },
            });
            results.synced++;
          } catch (error) {
            this.logger.error(
              `Failed to update repository ${repo.id}: ${(error as Error).message}`,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to sync from integration ${integrationId}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Sync existing complete: ${results.synced} of ${results.total} repositories updated`,
    );

    return results;
  }

  /**
   * Sync a single already-imported repository
   */
  async syncOne(organizationId: string, id: string) {
    const repo = await this.findOne(organizationId, id);

    const adapter = await this.adapterFactory.createGitProviderFromIntegration(
      organizationId,
      repo.integrationId,
    );

    const remoteRepos = await adapter.listRepositories({ limit: 100 });
    const remote = remoteRepos.find((r) => r.id === repo.externalId);

    if (!remote) {
      return { synced: false, message: 'Repository not found on remote' };
    }

    await this.prisma.repository.update({
      where: { id },
      data: {
        name: remote.name,
        fullPath: remote.fullName,
        description: remote.description,
        defaultBranch: remote.defaultBranch,
        cloneUrl: remote.cloneUrl,
        webUrl: remote.webUrl,
        lastSyncedAt: new Date(),
      },
    });

    return { synced: true, message: 'Repository synced successfully' };
  }

  /**
   * Get repositories available for a project (active repos)
   */
  async getAvailableForProject(organizationId: string) {
    return this.prisma.repository.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        fullPath: true,
        provider: true,
        defaultBranch: true,
        webUrl: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  private mapIntegrationToGitProvider(type: IntegrationType): GitProvider {
    switch (type) {
      case IntegrationType.GITHUB:
        return GitProvider.GITHUB;
      default:
        throw new BadRequestException(`Unsupported integration type: ${type}`);
    }
  }
}
