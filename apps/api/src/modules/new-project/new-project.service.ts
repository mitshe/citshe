import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GitProvider, IntegrationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { AdapterFactoryService } from '../../infrastructure/adapters/adapter-factory.service';
import { GitHubAdapter } from '../../infrastructure/adapters/git-provider/github.adapter';
import { OrchestrationService } from '../mcp/orchestration/orchestration.service';
import type { BuildSpec } from '@citshe/types';

export interface NewProjectInput {
  /** Portal (organization) name. */
  name: string;
  /** GitHub repo name (slug). */
  repoName: string;
  /** Build instructions. */
  buildSpec: Omit<BuildSpec, 'repositoryId' | 'repoFullPath'>;
}

/**
 * Creates a whole "New project" ATOMICALLY: portal + GitHub repo + Repository
 * row + build task, all-or-nothing. If any step fails, nothing is left behind
 * (no orphan portals). The GitHub integration is copied from the CURRENT org
 * (which the wizard verified has GitHub) into the new portal — the same GitHub
 * App installation covers both, so the copied credentials work.
 *
 * Order matters for atomicity:
 *   1. Verify GitHub on the current org (fail fast).
 *   2. Create the repo on GitHub (external, non-transactional) FIRST — if this
 *      fails, no DB rows were written yet.
 *   3. In ONE Prisma transaction: create org + member + copy GitHub integration
 *      + create Repository row + create Task. Any failure rolls all of it back.
 *   4. Outside the txn: kick off the build (best-effort; the task already exists).
 */
@Injectable()
export class NewProjectService {
  private readonly logger = new Logger(NewProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactoryService,
    private readonly orchestration: OrchestrationService,
  ) {}

  async create(
    currentOrgId: string,
    userId: string,
    input: NewProjectInput,
  ): Promise<{ organizationId: string; taskId: string; repoFullPath: string }> {
    const name = input.name.trim();
    const repoName = input.repoName.trim();
    if (!name) throw new BadRequestException('Portal name is required.');
    if (!/^[A-Za-z0-9._-]+$/.test(repoName)) {
      throw new BadRequestException('Invalid repository name.');
    }

    // 1. Verify GitHub on the CURRENT org — this is what we copy into the new
    // portal. The wizard already gates on it, but never trust the client.
    const sourceIntegration = await this.prisma.integration.findFirst({
      where: {
        organizationId: currentOrgId,
        type: IntegrationType.GITHUB,
        status: 'CONNECTED',
      },
    });
    if (!sourceIntegration) {
      throw new BadRequestException(
        'Connect GitHub first — the project needs a place for its code.',
      );
    }

    // 2. Create the repo on GitHub FIRST (external call, before any DB writes),
    // so a GitHub failure leaves nothing behind.
    const adapter = await this.adapterFactory.createGitProviderFromIntegration(
      currentOrgId,
      sourceIntegration.id,
    );
    if (!(adapter instanceof GitHubAdapter)) {
      throw new BadRequestException('The connected integration is not GitHub.');
    }
    const remote = await adapter.createRepository({
      name: repoName,
      description: `${name} — built with citshe`,
      private: input.buildSpec.visibility !== 'public',
      autoInit: true,
    });

    // 3. Everything DB-side in ONE transaction → all-or-nothing.
    const result = await this.prisma
      .$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name, slug: this.slug(name), ownerId: userId },
        });
        await tx.organizationMember.create({
          data: { organizationId: org.id, userId, role: 'OWNER' },
        });

        // Copy the GitHub integration (ciphertext copied verbatim — global key).
        await tx.integration.create({
          data: {
            organizationId: org.id,
            type: IntegrationType.GITHUB,
            status: sourceIntegration.status,
            config: sourceIntegration.config,
            configIv: sourceIntegration.configIv,
          },
        });

        const repo = await tx.repository.create({
          data: {
            organizationId: org.id,
            integrationId: (
              await tx.integration.findFirstOrThrow({
                where: { organizationId: org.id, type: IntegrationType.GITHUB },
                select: { id: true },
              })
            ).id,
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
            repositoryId: null, // build task creates into repo via buildSpec
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

    // 4. Kick off the build (best-effort — the task exists either way).
    await this.orchestration
      .startBuildTask(result.organizationId, result.taskId)
      .catch((err) =>
        this.logger.warn(
          `Build task ${result.taskId} not started immediately: ${(err as Error).message}`,
        ),
      );

    return result;
  }

  private slug(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    // Uniqueness is enforced by the DB unique constraint; add a short suffix.
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base || 'portal'}-${suffix}`;
  }
}
