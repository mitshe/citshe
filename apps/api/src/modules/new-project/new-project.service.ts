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

  /**
   * Pre-flight check for the wizard's GitHub token, run when the user leaves the
   * "Connect" step — BEFORE the atomic build. Surfaces a precise, human message
   * ("token expired", "add the workflow scope") so the build never fails
   * mid-flight for a reason we could have caught up front.
   *
   * Only GitHub is validated here: it's required and its scopes gate everything
   * (repo creation + optional CI). Cloudflare/Vercel/Neon are optional and their
   * tokens are exercised later by the build itself, so we don't block on them.
   */
  async validateGithub(token: string): Promise<{
    ok: boolean;
    login?: string;
    /** Non-blocking heads-up (e.g. missing `workflow` scope). */
    warning?: string;
    /** Blocking reason when ok=false. */
    error?: string;
  }> {
    const t = token?.trim();
    if (!t) {
      return { ok: false, error: 'Paste your GitHub token to continue.' };
    }
    const adapter = new GitHubAdapter({ accessToken: t });
    const v = await adapter.validateForNewProject();
    if (!v.ok) {
      return { ok: false, error: v.error };
    }
    // Classic PAT with a readable scope list but no `repo` → it literally can't
    // create the repo. Block now with an exact fix.
    if (v.scopes !== null && !v.hasRepo) {
      return {
        ok: false,
        login: v.login,
        error:
          'This token is missing the "repo" scope, so it can\'t create your project\'s repository. Create a new token with "repo" checked.',
      };
    }
    // Missing `workflow` isn't fatal (only matters if the build writes CI), so
    // let them through with a heads-up rather than a hard stop.
    const warning =
      v.scopes !== null && !v.hasWorkflow
        ? 'Heads up: this token has no "workflow" scope. The build works, but it won\'t be able to add GitHub Actions files if it needs to.'
        : undefined;
    return { ok: true, login: v.login, warning };
  }

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
      // The adapter prefixes messages with "GitHub:"; strip it and turn the two
      // errors the user can act on into plain-language fixes.
      const raw = ((err as Error).message ?? '').replace(/^GitHub:\s*/i, '');
      let friendly: string;
      if (/already exists|name already/i.test(raw)) {
        friendly = `The repository name "${repoName}" is already taken on your GitHub account. Pick a different name.`;
      } else if (/bad credentials|401|unauthorized|invalid/i.test(raw)) {
        friendly =
          'That GitHub token was rejected. Create a fresh token (with the "repo" scope) and try again.';
      } else {
        friendly = `Couldn't create the GitHub repo. ${raw || 'Check the token and that the name is free.'}`;
      }
      throw new BadRequestException(friendly);
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
      .catch(async (err) => {
        // Compensating rollback: the repo was created on GitHub BEFORE the txn,
        // so a txn failure would leave an orphan repo (which also blocks
        // retrying with the same name). Delete it. Best-effort — needs the
        // delete_repo scope; if it fails we log the leftover for cleanup.
        try {
          await adapter.deleteRepository(remote.fullName);
          this.logger.warn(
            `Rolled back orphan GitHub repo ${remote.fullName} after a failed new-project txn.`,
          );
        } catch (delErr) {
          this.logger.error(
            `Could not delete orphan repo ${remote.fullName} (needs delete_repo scope): ${(delErr as Error).message}`,
          );
        }
        this.logger.error(
          `New project transaction failed: ${(err as Error).message}`,
        );
        // Don't leak Prisma/internal error text to the wizard. Map the one
        // failure the user can actually act on (a name collision), else a
        // generic, friendly message. Full detail stays in the server log above.
        const raw = (err as Error).message ?? '';
        const friendly = /unique|constraint|slug|already exists/i.test(raw)
          ? 'A portal with a similar name already exists. Try a different name.'
          : 'Something went wrong setting up the project. Nothing was saved — please try again.';
        throw new BadRequestException(friendly);
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
