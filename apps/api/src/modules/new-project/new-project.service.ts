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
 * Buduje repo + task w BIEŻĄCEJ organizacji (portalu). Portal (org) już istnieje
 * — wizard tworzy go WCZEŚNIEJ (pustą org), a użytkownik podłącza do niego
 * GitHub/Cloudflare/itd. od zera w kroku "connect". ZERO dziedziczenia/kopiowania
 * credentials między portalami — każdy portal ma własne, świeżo podłączone.
 *
 * Order matters for atomicity:
 *   1. Verify GitHub on THIS org (fail fast — user musiał go podłączyć w wizardzie).
 *   2. Create the repo on GitHub (external, non-transactional) FIRST.
 *   3. In ONE Prisma transaction: create Repository row + create Task.
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

    // 1. Verify GitHub on THIS org (portal). Użytkownik podłączył go w wizardzie
    // do tego portalu — nic nie dziedziczymy z innych org.
    const integration = await this.prisma.integration.findFirst({
      where: {
        organizationId: currentOrgId,
        type: IntegrationType.GITHUB,
        status: 'CONNECTED',
      },
    });
    if (!integration) {
      throw new BadRequestException(
        'Connect GitHub first — the project needs a place for its code.',
      );
    }

    // 2. Create the repo on GitHub FIRST (external call, before any DB writes),
    // so a GitHub failure leaves nothing behind.
    const adapter = await this.adapterFactory.createGitProviderFromIntegration(
      currentOrgId,
      integration.id,
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

    // 3. Repo + task w BIEŻĄCEJ org w ONE transaction (org już istnieje).
    const result = await this.prisma
      .$transaction(async (tx) => {
        const repo = await tx.repository.create({
          data: {
            organizationId: currentOrgId,
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
            organizationId: currentOrgId,
            repositoryId: null, // build task creates into repo via buildSpec
            title: title.slice(0, 200),
            buildSpec: spec as unknown as Prisma.InputJsonValue,
            createdBy: userId,
            agentLogs: [],
          },
        });

        return {
          organizationId: currentOrgId,
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
}
