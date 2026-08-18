import { Injectable, Logger } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { SessionsService } from '../../sessions/services/sessions.service';
import { SessionContainerService } from '../../sessions/services/session-container.service';
import { EventsGateway } from '../../../infrastructure/websocket/events.gateway';

/**
 * The orchestrator: a persistent chat (the main Claude thread) decomposes work
 * into Tasks and dispatches them to worker threads. A worker is a session
 * (container running the `claude` CLI) that executes one task end-to-end and
 * reports back. The orchestrator plans; workers implement.
 *
 * This service holds the dispatch logic the MCP tools call into.
 */
@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly containerService: SessionContainerService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /** How many worker threads may run at once per organization. */
  private readonly MAX_CONCURRENT_WORKERS = 3;
  /** How long to wait for a worker container to become RUNNING. */
  private readonly WORKER_READY_TIMEOUT_MS = 90_000;
  /** How long a single task execution may run inside the worker. */
  private readonly WORKER_EXEC_TIMEOUT_MS = 20 * 60_000;

  /**
   * Snapshot of the queue: tasks grouped by lifecycle + the workers currently
   * running. This is what the orchestrator reads to reason about the plan.
   */
  async getQueueOverview(organizationId: string) {
    const [tasks, runningWorkers] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          organizationId,
          status: {
            in: [
              TaskStatus.PENDING,
              TaskStatus.QUEUED,
              TaskStatus.IN_PROGRESS,
              TaskStatus.REVIEW,
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          sessionId: true,
          projectId: true,
        },
      }),
      this.prisma.agentSession.count({
        where: { organizationId, status: 'RUNNING' },
      }),
    ]);

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { queuePaused: true },
    });

    const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);

    return {
      queuePaused: org?.queuePaused ?? false,
      runningWorkers,
      maxWorkers: this.MAX_CONCURRENT_WORKERS,
      pending: byStatus(TaskStatus.PENDING),
      queued: byStatus(TaskStatus.QUEUED),
      inProgress: byStatus(TaskStatus.IN_PROGRESS),
      review: byStatus(TaskStatus.REVIEW),
    };
  }

  async setQueuePaused(organizationId: string, paused: boolean) {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { queuePaused: paused },
    });
    return { queuePaused: paused };
  }

  /**
   * Dispatch a task to a worker. If the queue is paused or the concurrency
   * limit is reached, the task is marked QUEUED and picked up later. Otherwise
   * a worker thread is spun up and the task runs in the background — the result
   * is written back to the task and streamed over WebSocket, so this returns as
   * soon as the worker is launched (fire-and-forget).
   */
  async dispatchTask(
    organizationId: string,
    userId: string,
    taskId: string,
    opts?: { repositoryIds?: string[] },
  ): Promise<{ status: string; sessionId?: string; message: string }> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) {
      return { status: 'error', message: `Task ${taskId} not found.` };
    }
    if (
      task.status === TaskStatus.IN_PROGRESS ||
      task.status === TaskStatus.COMPLETED
    ) {
      return {
        status: 'skipped',
        message: `Task is already ${task.status}.`,
      };
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { queuePaused: true },
    });
    const runningWorkers = await this.prisma.agentSession.count({
      where: { organizationId, status: 'RUNNING' },
    });

    // Paused or at capacity → hold in the queue.
    if (org?.queuePaused || runningWorkers >= this.MAX_CONCURRENT_WORKERS) {
      await this.updateTaskStatus(organizationId, taskId, TaskStatus.QUEUED);
      return {
        status: 'queued',
        message: org?.queuePaused
          ? 'Queue is paused — task is QUEUED and will run once resumed.'
          : `At worker capacity (${this.MAX_CONCURRENT_WORKERS}) — task is QUEUED.`,
      };
    }

    // Resolve repositories: explicit, else the project's/org's active repos.
    const repositoryIds =
      opts?.repositoryIds && opts.repositoryIds.length > 0
        ? opts.repositoryIds
        : await this.defaultRepositoryIds(organizationId);

    // Create the worker thread.
    const session = await this.sessionsService.create(organizationId, userId, {
      name: `worker: ${task.title}`.slice(0, 80),
      projectId: task.projectId || undefined,
      repositoryIds,
      instructions: this.buildWorkerInstructions(task.title, task.description),
    });

    await this.prisma.task.update({
      where: { id: taskId },
      data: { sessionId: session.id, status: TaskStatus.IN_PROGRESS },
    });
    this.eventsGateway.emitTaskUpdate(organizationId, {
      taskId,
      status: TaskStatus.IN_PROGRESS,
      message: 'Worker starting…',
    });

    // Run the task in the background; don't block the orchestrator's tool call.
    void this.runWorker(organizationId, taskId, session.id, task).catch(
      (err) => {
        this.logger.error(
          `Worker for task ${taskId} crashed: ${(err as Error).message}`,
        );
      },
    );

    return {
      status: 'dispatched',
      sessionId: session.id,
      message: `Worker ${session.id} launched for "${task.title}".`,
    };
  }

  /**
   * Promote QUEUED tasks to workers up to the concurrency limit. Called after a
   * worker finishes or when the queue is resumed.
   */
  async drainQueue(organizationId: string, userId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { queuePaused: true },
    });
    if (org?.queuePaused) return { dispatched: 0 };

    let dispatched = 0;
    // Loop: each dispatch consumes a worker slot; stop when full or empty.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const running = await this.prisma.agentSession.count({
        where: { organizationId, status: 'RUNNING' },
      });
      if (running >= this.MAX_CONCURRENT_WORKERS) break;

      const next = await this.prisma.task.findFirst({
        where: { organizationId, status: TaskStatus.QUEUED },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) break;

      const result = await this.dispatchTask(organizationId, userId, next.id);
      if (result.status !== 'dispatched') break;
      dispatched++;
    }
    return { dispatched };
  }

  // ─── internals ──────────────────────────────────────────────────────────

  /**
   * Wait for the worker container to come up, run the task with `claude -p`,
   * record the result on the task, stop the worker, then drain the queue.
   */
  private async runWorker(
    organizationId: string,
    taskId: string,
    sessionId: string,
    task: { title: string; description: string | null; createdBy: string },
  ): Promise<void> {
    try {
      const ready = await this.waitForRunning(organizationId, sessionId);
      if (!ready) {
        await this.failTask(
          organizationId,
          taskId,
          'Worker container did not become ready in time.',
        );
        return;
      }

      const session = await this.sessionsService.findOne(
        organizationId,
        sessionId,
      );
      if (!session.containerId) {
        await this.failTask(organizationId, taskId, 'Worker has no container.');
        return;
      }

      this.eventsGateway.emitAgentLog(organizationId, taskId, {
        agentName: 'worker',
        action: 'executing',
        details: { title: task.title },
      });

      const prompt = this.buildWorkerInstructions(task.title, task.description);
      const promptB64 = Buffer.from(prompt).toString('base64');
      const output = await this.containerService.execCommand(
        session.containerId,
        [
          'bash',
          '-c',
          `echo '${promptB64}' | base64 -d | claude -p --dangerously-skip-permissions --output-format text`,
        ],
        '/workspace',
        this.WORKER_EXEC_TIMEOUT_MS,
      );

      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.REVIEW,
          result: { output: output.slice(0, 20_000) },
        },
      });
      this.eventsGateway.emitTaskUpdate(organizationId, {
        taskId,
        status: TaskStatus.REVIEW,
        message: 'Worker finished — ready for review.',
      });
      this.eventsGateway.emitTaskCompleted(organizationId, taskId, {
        type: 'worker_finished',
        comment: output.slice(0, 2000),
      });
    } catch (err) {
      await this.failTask(
        organizationId,
        taskId,
        `Worker failed: ${(err as Error).message}`,
      );
    } finally {
      // Free the worker slot and let the next queued task run.
      await this.stopWorker(organizationId, sessionId);
      await this.drainQueue(organizationId, task.createdBy).catch(() => {});
    }
  }

  private async waitForRunning(
    organizationId: string,
    sessionId: string,
  ): Promise<boolean> {
    const deadline = Date.now() + this.WORKER_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const session = await this.prisma.agentSession.findFirst({
        where: { id: sessionId, organizationId },
        select: { status: true },
      });
      if (!session) return false;
      if (session.status === 'RUNNING') return true;
      if (session.status === 'FAILED') return false;
      await this.sleep(2000);
    }
    return false;
  }

  private async stopWorker(organizationId: string, sessionId: string) {
    try {
      const session = await this.sessionsService.findOne(
        organizationId,
        sessionId,
      );
      if (session.containerId) {
        await this.containerService.stopContainer(session.containerId);
      }
      await this.sessionsService.updateStatus(sessionId, 'COMPLETED');
    } catch (err) {
      this.logger.warn(
        `Failed to stop worker ${sessionId}: ${(err as Error).message}`,
      );
    }
  }

  private async failTask(
    organizationId: string,
    taskId: string,
    reason: string,
  ) {
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.FAILED, result: { error: reason } },
    });
    this.eventsGateway.emitTaskFailed(organizationId, taskId, reason);
  }

  private async updateTaskStatus(
    organizationId: string,
    taskId: string,
    status: TaskStatus,
  ) {
    await this.prisma.task.update({ where: { id: taskId }, data: { status } });
    this.eventsGateway.emitTaskUpdate(organizationId, { taskId, status });
  }

  private async defaultRepositoryIds(
    organizationId: string,
  ): Promise<string[]> {
    const repos = await this.prisma.repository.findMany({
      where: { organizationId, isActive: true },
      select: { id: true },
    });
    // Single active repo → attach it; otherwise leave empty (worker gets an
    // empty workspace, the orchestrator can pass repositoryIds explicitly).
    return repos.length === 1 ? [repos[0].id] : [];
  }

  private buildWorkerInstructions(
    title: string,
    description: string | null,
  ): string {
    const body = description?.trim()
      ? `${title}\n\n${description.trim()}`
      : title;
    return (
      `You are a worker agent. Complete this task end-to-end in the current ` +
      `repository, then commit your changes on a new branch and open a pull ` +
      `request. Do not ask for confirmation — make reasonable decisions.\n\n` +
      `TASK:\n${body}`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
