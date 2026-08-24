import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  GitProvider,
  IntegrationType,
  PluginType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { EncryptionService } from '../../shared/encryption/encryption.service';
import { GitHubAdapter } from '../../infrastructure/adapters/git-provider/github.adapter';
import { OrchestrationService } from '../mcp/orchestration/orchestration.service';
import type { BuildSpec } from '@citshe/types';

export interface NewProjectKeys {
  github?: string;
  cloudflare?: string;
  vercel?: string;
  neon?: string;
}

export interface NewProjectInput {
  /** Portal (organization) name. */
  name: string;
  /** GitHub repo name (slug). */
  repoName: string;
  /** Raw tokens the user pasted in the wizard (GitHub required). */
  keys: NewProjectKeys;
  /** Build instructions. */
  buildSpec: Omit<BuildSpec, 'repositoryId' | 'repoFullPath'>;
}

/**
 * Creates a whole "New project" ATOMICALLY from the keys the user pasted in the
 * wizard — NOTHING is inherited from other portals, nothing is fetched. Each
 * portal gets its own freshly-typed credentials.
 *
 * Order (for atomicity — a failure leaves no orphan portal):
 *   1. Validate input; require a GitHub token.
 *   2. Create the repo on GitHub using the PASTED token (external call FIRST —
 *      if the token is bad or the repo name is taken, nothing is written yet).
 *   3. In ONE Prisma transaction: create org + member + GitHub integration +
 *      any stack plugins (Cloudflare/Vercel/Neon) + Repository row + Task.
 *   4. Outside the txn: kick off the build (best-effort; the task exists).
 */
@Injectable()
export class NewProjectService {
  private readonly logger = new Logger(NewProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly orchestration: OrchestrationService,
  ) {}

  async create(
    userId: string,
    input: NewProjectInput,
  ): Promise<{ organizationId: string; taskId: string; repoFullPath: string }> {
    const name = input.name.trim();
    const repoName = input.repoName.trim();
    const githubToken = input.keys.github?.trim();

    if (!name) throw new BadRequestException('Portal name is required.');
    if (!/^[A-Za-z0-9._-]+$/.test(repoName)) {
      throw new BadRequestException('Invalid repository name.');
    }
    if (!githubToken) {
      throw new BadRequestException(
        'A GitHub token is required — the project needs a place for its code.',
      );
    }

    // 1. Create the repo on GitHub using the pasted token FIRST (external, before
    // any DB write). A bad token / taken name fails here and writes nothing.
    const adapter = new GitHubAdapter({ accessToken: githubToken });
    let remote;
    try {
      remote = await adapter.createRepository({
        name: repoName,
        description: `${name} — built with citshe`,
        private: input.buildSpec.visibility !== 'public',
        autoInit: true,
      });
    } catch (err) {
      throw new BadRequestException(
        `Couldn't create the GitHub repo: ${(err as Error).message}. Check the token and that the name is free.`,
      );
    }

    // Encrypt the credentials once (global key) for storage.
    const githubEnc = this.encryption.encryptJson({
      mode: 'pat',
      accessToken: githubToken,
    });
    const plugins: Array<{
      type: PluginType;
      config: Record<string, unknown>;
    }> = [];
    if (input.keys.cloudflare?.trim()) {
      plugins.push({
        type: PluginType.CLOUDFLARE,
        config: { apiToken: input.keys.cloudflare.trim() },
      });
    }
    if (input.keys.vercel?.trim()) {
      plugins.push({
        type: PluginType.VERCEL,
        config: { apiToken: input.keys.vercel.trim() },
      });
    }
    if (input.keys.neon?.trim()) {
      plugins.push({
        type: PluginType.NEON,
        config: { apiKey: input.keys.neon.trim() },
      });
    }

    // 2. Everything DB-side in ONE transaction → all-or-nothing.
    const result = await this.prisma
      .$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name, slug: this.slug(name), ownerId: userId },
        });
        await tx.organizationMember.create({
          data: { organizationId: org.id, userId, role: 'OWNER' },
        });

        const integration = await tx.integration.create({
          data: {
            organizationId: org.id,
            type: IntegrationType.GITHUB,
            status: 'CONNECTED',
            config: new Uint8Array(githubEnc.encrypted),
            configIv: new Uint8Array(githubEnc.iv),
          },
        });

        for (const p of plugins) {
          const enc = this.encryption.encryptJson(p.config);
          await tx.plugin.create({
            data: {
              organizationId: org.id,
              type: p.type,
              status: 'CONNECTED',
              config: new Uint8Array(enc.encrypted),
              configIv: new Uint8Array(enc.iv),
            },
          });
        }

        const repo = await tx.repository.create({
          data: {
            organizationId: org.id,
            integrationId: integration.id,
            provider: GitProvider.GITHUB,
            externalId: remote.fullName,
            name: remote.name,
            fullPath: remote.fullName,
            description: remote.description ?? null,
            defaultBranch: remote.defaultBranch,
            cloneUrl: remote.cloneUrl,
            webUrl: remote.webUrl,
            isActive: true,
            analysisStatus: 'pending',
          },
        });

        const spec: BuildSpec = {
          ...input.buildSpec,
          repositoryId: repo.id,
          repoFullPath: repo.fullPath,
        };
        const title =
          input.buildSpec.mode === 'refresh'
            ? `Refresh: ${name}`
            : `Build: ${name}`;
        const task = await tx.task.create({
          data: {
            organizationId: org.id,
            repositoryId: null, // build task builds into the repo via buildSpec
            title: title.slice(0, 200),
            buildSpec: spec as unknown as Prisma.InputJsonValue,
            createdBy: userId,
            agentLogs: [],
          },
        });

        return {
          organizationId: org.id,
          taskId: task.id,
          repoFullPath: repo.fullPath,
        };
      })
      .catch((err) => {
        this.logger.error(
          `New project transaction failed (repo ${remote.fullName} was created on GitHub): ${(err as Error).message}`,
        );
        throw new BadRequestException(
          `Couldn't set up the project: ${(err as Error).message}`,
        );
      });

    // 3. Kick off the build (best-effort — the task exists either way).
    await this.orchestration
      .startBuildTask(result.organizationId, result.taskId)
      .catch((err) =>
        this.logger.warn(
          `Build task ${result.taskId} not started immediately: ${(err as Error).message}`,
        ),
      );

    return result;
  }

  /** Unique-ish org slug (DB enforces uniqueness; suffix keeps it collision-free). */
  private slug(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base || 'portal'}-${suffix}`;
  }
}
