import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskStatus, Prisma, DeliveryMode } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { SessionsService } from '../../sessions/services/sessions.service';
import { SessionContainerService } from '../../sessions/services/session-container.service';
import { EventsGateway } from '../../../infrastructure/websocket/events.gateway';
import {
  QUEUES,
  TaskQueueJob,
} from '../../../infrastructure/queue/queues';

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
    @InjectQueue(QUEUES.TASK_QUEUE)
    private readonly taskQueue: Queue<TaskQueueJob>,
  ) {}

  /**
   * How many worker threads may run at once. This is also the BullMQ worker
   * concurrency for the `task-queue` (see TaskQueueProcessor) — BullMQ caps
   * parallelism natively, so no manual runningWorkers counting is needed.
   */
  static readonly MAX_CONCURRENT_WORKERS = 3;
  private readonly MAX_CONCURRENT_WORKERS =
    OrchestrationService.MAX_CONCURRENT_WORKERS;
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
        // Queue column ordering: queueOrder asc (nulls last), then createdAt.
        orderBy: [{ queueOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          sessionId: true,
          repositoryId: true,
          queueOrder: true,
        },
      }),
      // A "worker" is a running session that was spun up to work a task —
      // NOT an interactive terminal the user opened by hand. Count only running
      // sessions that have a task attached, so ad-hoc terminals don't inflate
      // the worker count.
      this.prisma.agentSession.count({
        where: {
          organizationId,
          status: 'RUNNING',
          tasks: { some: {} },
        },
      }),
    ]);

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { queuePaused: true, autoPull: true },
    });

    const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);

    return {
      queuePaused: org?.queuePaused ?? false,
      autoPull: org?.autoPull ?? false,
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

  // ─── auto-pull (per-portal toggle) ────────────────────────────────────────

  /**
   * Toggle per-portal auto-pull.
   *  ON  → enqueue ALL of the org's QUEUED tasks as BullMQ jobs (ordered by
   *        queueOrder) so free workers start pulling them. Respects the global
   *        queuePaused hard-stop (no jobs added while paused).
   *  OFF → remove the org's pending (waiting/delayed) jobs from `task-queue`;
   *        tasks stay QUEUED in the DB. Already-active jobs finish.
   */
  async setAutoPull(organizationId: string, autoPull: boolean) {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { autoPull },
    });

    if (autoPull) {
      await this.enqueueOrgQueue(organizationId);
    } else {
      await this.removeOrgPendingJobs(organizationId);
    }

    return { autoPull };
  }

  /**
   * Enqueue all of an org's QUEUED tasks as BullMQ jobs (ordered by queueOrder).
   * No-op while queuePaused. Skips tasks that already have a pending job.
   */
  async enqueueOrgQueue(organizationId: string): Promise<{ enqueued: number }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { queuePaused: true, autoPull: true },
    });
    if (!org || org.queuePaused || !org.autoPull) {
      return { enqueued: 0 };
    }

    const queued = await this.prisma.task.findMany({
      where: { organizationId, status: TaskStatus.QUEUED },
      orderBy: [{ queueOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, queueOrder: true },
    });

    let enqueued = 0;
    for (const task of queued) {
      const added = await this.addTaskJob(
        organizationId,
        task.id,
        task.queueOrder,
      );
      if (added) enqueued++;
    }
    return { enqueued };
  }

  /**
   * Remove an org's not-yet-active jobs (waiting/delayed/prioritized) from the
   * worker queue. Active (running) jobs are left to finish. Tasks stay QUEUED.
   */
  async removeOrgPendingJobs(
    organizationId: string,
  ): Promise<{ removed: number }> {
    const jobs = await this.taskQueue.getJobs([
      'waiting',
      'delayed',
      'prioritized',
      'paused',
    ]);
    let removed = 0;
    for (const job of jobs) {
      if (job.data?.organizationId === organizationId) {
        try {
          await job.remove();
          removed++;
        } catch (err) {
          this.logger.warn(
            `Failed to remove job ${job.id}: ${(err as Error).message}`,
          );
        }
      }
    }
    return { removed };
  }

  // ─── enqueue + reorder ────────────────────────────────────────────────────

  /**
   * Move a task into the Queue column: status = QUEUED with queueOrder appended
   * to the end of the org's queue. If auto-pull is ON (and not paused), a
   * BullMQ job is added immediately so a free worker can pull it.
   */
  async enqueueTask(organizationId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true, status: true },
    });
    if (!task) {
      return { status: 'error', message: `Task ${taskId} not found.` };
    }

    const last = await this.prisma.task.findFirst({
      where: {
        organizationId,
        status: TaskStatus.QUEUED,
        queueOrder: { not: null },
      },
      orderBy: { queueOrder: 'desc' },
      select: { queueOrder: true },
    });
    const queueOrder = (last?.queueOrder ?? 0) + 1;

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.QUEUED, queueOrder },
    });
    this.eventsGateway.emitTaskUpdate(organizationId, {
      taskId,
      status: TaskStatus.QUEUED,
    });

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { queuePaused: true, autoPull: true },
    });
    if (org?.autoPull && !org.queuePaused) {
      await this.addTaskJob(organizationId, taskId, queueOrder);
    }

    return updated;
  }

  /**
   * Update a task's queueOrder (the frontend computes a fractional value
   * between neighbours). If the task has a pending BullMQ job, its priority is
   * re-derived so the worker pull order follows the new position.
   */
  async reorderTask(
    organizationId: string,
    taskId: string,
    newQueueOrder: number,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true },
    });
    if (!task) {
      return { status: 'error', message: `Task ${taskId} not found.` };
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { queueOrder: newQueueOrder },
    });

    // Re-prioritize the pending job if one exists (remove + re-add).
    const job = await this.findPendingJob(organizationId, taskId);
    if (job) {
      try {
        await job.remove();
        await this.addTaskJob(organizationId, taskId, newQueueOrder);
      } catch (err) {
        this.logger.warn(
          `Failed to reprioritize job for task ${taskId}: ${(err as Error).message}`,
        );
      }
    }

    this.eventsGateway.emitTaskUpdate(organizationId, {
      taskId,
      status: TaskStatus.QUEUED,
    });
    return updated;
  }

  // ─── BullMQ job helpers ───────────────────────────────────────────────────

  /**
   * Map a queueOrder (Float, may be null) to a BullMQ priority. Smaller number
   * = higher priority = pulled first. BullMQ requires a positive integer; we
   * clamp into a safe range. Nulls sort last.
   */
  private queueOrderToPriority(queueOrder: number | null): number {
    if (queueOrder == null) return 2_000_000;
    const scaled = Math.round(queueOrder * 1000) + 1_000_000;
    return Math.min(Math.max(scaled, 1), 2_000_000);
  }

  /**
   * Add a BullMQ job for a task if it doesn't already have a pending one.
   * Uses the task id as jobId to dedupe. Returns true if a job was added.
   */
  private async addTaskJob(
    organizationId: string,
    taskId: string,
    queueOrder: number | null,
  ): Promise<boolean> {
    const existing = await this.findPendingJob(organizationId, taskId);
    if (existing) return false;

    await this.taskQueue.add(
      'run',
      { taskId, organizationId },
      {
        // BullMQ forbids ':' in custom job ids ("Custom Id cannot contain :"),
        // which made auto-pull 500. Use a dash-delimited id instead.
        jobId: `task-${taskId}`,
        priority: this.queueOrderToPriority(queueOrder),
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    return true;
  }

  /** Find a not-yet-active job for a task (used for dedupe / reprioritize). */
  private async findPendingJob(organizationId: string, taskId: string) {
    const job = await this.taskQueue.getJob(`task-${taskId}`);
    if (!job) return null;
    const state = await job.getState();
    if (state === 'active' || state === 'completed') return null;
    if (job.data?.organizationId !== organizationId) return null;
    return job;
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

    // Resolve repositories: explicit override, else the task's own repo, else
    // the org's active repos (when there's exactly one).
    const repositoryIds =
      opts?.repositoryIds && opts.repositoryIds.length > 0
        ? opts.repositoryIds
        : task.repositoryId
          ? [task.repositoryId]
          : await this.defaultRepositoryIds(organizationId);

    // Create the worker thread.
    const session = await this.sessionsService.create(organizationId, userId, {
      name: `worker: ${task.title}`.slice(0, 80),
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

  // ─── BullMQ worker entry point ────────────────────────────────────────────

  /**
   * Run one QUEUED task end-to-end, driven by the `task-queue` BullMQ worker.
   * Reuses the SAME session-container path as terminals: create a session
   * (which spins up the container), wait for it, run `claude -p`, advance the
   * task QUEUED→IN_PROGRESS→REVIEW, and stop the worker container.
   *
   * This awaits completion (so BullMQ concurrency caps real parallelism) and
   * RE-THROWS on failure so BullMQ can retry (attempts + backoff). The
   * processor marks the task FAILED once retries are exhausted. No manual queue
   * draining here — BullMQ pulls the next job itself.
   */
  async executeTask(organizationId: string, taskId: string): Promise<void> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) {
      this.logger.warn(`executeTask: task ${taskId} not found — skipping.`);
      return;
    }
    if (
      task.status === TaskStatus.IN_PROGRESS ||
      task.status === TaskStatus.REVIEW ||
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.CANCELLED
    ) {
      this.logger.log(
        `executeTask: task ${taskId} already ${task.status} — skipping.`,
      );
      return;
    }

    // Respect the hard global stop even if a job slipped through.
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { queuePaused: true },
    });
    if (org?.queuePaused) {
      throw new Error('Queue is paused — retry later.');
    }

    const repositoryIds = task.repositoryId
      ? [task.repositoryId]
      : await this.defaultRepositoryIds(organizationId);

    // Attach the org's connected GitHub integration(s) so the worker can
    // clone and push a PR.
    const gitIntegrations = await this.prisma.integration.findMany({
      where: { organizationId, type: 'GITHUB', status: 'CONNECTED' },
      select: { id: true },
    });
    const integrationIds = gitIntegrations.map((i) => i.id);

    // Create the worker thread (same container path as terminals/sessions).
    const session = await this.sessionsService.create(
      organizationId,
      task.createdBy,
      {
        name: `worker: ${task.title}`.slice(0, 80),
        repositoryIds,
        integrationIds,
        instructions: this.buildWorkerInstructions(
          task.title,
          task.description,
        ),
      },
    );

    await this.prisma.task.update({
      where: { id: taskId },
      data: { sessionId: session.id, status: TaskStatus.IN_PROGRESS },
    });
    this.eventsGateway.emitTaskUpdate(organizationId, {
      taskId,
      status: TaskStatus.IN_PROGRESS,
      message: 'Worker starting…',
    });

    // Actually spin up the container and flip the session to RUNNING — the
    // service's create() only writes the DB row (the HTTP controller normally
    // does this part), so without it the worker sat in CREATING forever
    // ("did not become ready in time").
    try {
      const [repos, integrationConfigs] = await Promise.all([
        this.sessionsService.buildRepoConfigs(
          session.repositories,
          organizationId,
        ),
        this.sessionsService.resolveIntegrationConfigs(
          integrationIds,
          organizationId,
          undefined,
          session.id,
        ),
      ]);

      const containerId = await this.containerService.createAndStart(
        {
          sessionId: session.id,
          organizationId,
          repos,
          instructions: session.instructions,
          provider: session.aiCredential?.provider,
          enableDocker: session.enableDocker,
          enableBrowser: session.enableBrowser,
          integrations:
            integrationConfigs.length > 0 ? integrationConfigs : undefined,
        },
        async (cid) => {
          await this.sessionsService.updateContainerId(session.id, cid);
        },
      );

      await this.sessionsService.updateStatus(
        session.id,
        'RUNNING',
        containerId,
      );
      this.eventsGateway.emitSessionStatus(
        organizationId,
        session.id,
        'RUNNING',
      );
    } catch (err) {
      await this.sessionsService.updateStatus(session.id, 'FAILED');
      this.eventsGateway.emitSessionStatus(
        organizationId,
        session.id,
        'FAILED',
        (err as Error).message,
      );
      throw err;
    }

    // Awaits, and re-throws on failure (see runWorker { rethrow: true }).
    await this.runWorker(organizationId, taskId, session.id, task, {
      rethrow: true,
      drain: false,
    });
  }

  // ─── internals ──────────────────────────────────────────────────────────

  /**
   * Wait for the worker container to come up, run the task with `claude -p`,
   * record the result on the task, stop the worker, then (optionally) drain
   * the legacy in-process queue.
   *
   * @param opts.rethrow when true, errors are re-thrown after stopping the
   *   worker (BullMQ path — the caller/processor decides FAILED vs retry).
   *   When false (legacy dispatchTask path), the task is marked FAILED here.
   * @param opts.drain when true, promote the next QUEUED task after finishing
   *   (legacy in-process path). The BullMQ path leaves draining to BullMQ.
   */
  private async runWorker(
    organizationId: string,
    taskId: string,
    sessionId: string,
    task: {
      title: string;
      description: string | null;
      createdBy: string;
      deliveryMode?: DeliveryMode;
    },
    opts: { rethrow?: boolean; drain?: boolean } = {},
  ): Promise<void> {
    const { rethrow = false, drain = true } = opts;
    let caught: Error | null = null;
    try {
      const ready = await this.waitForRunning(organizationId, sessionId);
      if (!ready) {
        throw new Error('Worker container did not become ready in time.');
      }

      const session = await this.sessionsService.findOne(
        organizationId,
        sessionId,
      );
      if (!session.containerId) {
        throw new Error('Worker has no container.');
      }

      await this.recordAgentLog(organizationId, taskId, {
        agentName: 'worker',
        action: 'executing',
        details: { title: task.title },
      });

      const prompt = this.buildWorkerInstructions(
        task.title,
        task.description,
        task.deliveryMode ?? 'PR',
      );
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

      const delivery = this.parseDeliveryResult(output);
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.REVIEW,
          result: {
            output: output.slice(0, 20_000),
            ...(delivery.prUrl ? { prUrl: delivery.prUrl } : {}),
            ...(delivery.branch ? { branch: delivery.branch } : {}),
          },
        },
      });
      await this.recordAgentLog(organizationId, taskId, {
        agentName: 'worker',
        action: 'finished',
        details: {
          summary: output.slice(0, 2000),
          ...(delivery.prUrl ? { prUrl: delivery.prUrl } : {}),
          ...(delivery.branch ? { pushed: delivery.branch } : {}),
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
      caught = err as Error;
      if (!rethrow) {
        // Legacy path: mark FAILED here (no retry mechanism upstream).
        await this.failTask(
          organizationId,
          taskId,
          `Worker failed: ${caught.message}`,
        );
      }
    } finally {
      // Always free the worker slot / stop the container.
      await this.stopWorker(organizationId, sessionId);
      if (drain) {
        await this.drainQueue(organizationId, task.createdBy).catch(() => {});
      }
    }

    // BullMQ path: surface the error so the processor can retry / fail.
    if (caught && rethrow) throw caught;
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

  /**
   * Append an entry to the task's persisted activity feed (task.agentLogs) AND
   * emit it live. emitAgentLog alone only pushes a WS event, so re-opening a
   * task later showed "No activity yet" even though the worker had run.
   */
  private async recordAgentLog(
    organizationId: string,
    taskId: string,
    entry: {
      agentName: string;
      action: string;
      details?: Record<string, unknown>;
    },
  ): Promise<void> {
    const logEntry = { ...entry, timestamp: new Date().toISOString() };
    try {
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { agentLogs: true },
      });
      const existing = Array.isArray(task?.agentLogs) ? task!.agentLogs : [];
      await this.prisma.task.update({
        where: { id: taskId },
        data: { agentLogs: [...existing, logEntry] as Prisma.JsonArray },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist agent log for ${taskId}: ${(err as Error).message}`,
      );
    }
    this.eventsGateway.emitAgentLog(organizationId, taskId, entry);
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
    await this.recordAgentLog(organizationId, taskId, {
      agentName: 'worker',
      action: 'failed',
      details: { error: reason },
    });
    this.eventsGateway.emitTaskFailed(organizationId, taskId, reason);
  }

  /**
   * Public wrapper for the BullMQ processor to mark a task FAILED after retries
   * are exhausted.
   */
  async markTaskFailed(
    organizationId: string,
    taskId: string,
    reason: string,
  ): Promise<void> {
    await this.failTask(organizationId, taskId, reason);
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
    deliveryMode: DeliveryMode = 'PR',
  ): string {
    const body = description?.trim()
      ? `${title}\n\n${description.trim()}`
      : title;

    // The worker prints a machine-readable marker as its LAST line so citshe
    // can record the real PR link / pushed branch on the task.
    const delivery =
      deliveryMode === 'DIRECT_PUSH'
        ? `When done, commit your changes and push them directly to the default ` +
          `branch (master/main). Do NOT open a pull request. As the VERY LAST ` +
          `line of your output, print exactly: PUSHED: <branch>@<short-sha>`
        : `When done, commit your changes on a new branch named ` +
          `citshe/<short-slug> and open a pull request against the default ` +
          `branch. As the VERY LAST line of your output, print exactly: ` +
          `PR_URL: <full pull request url>`;

    return (
      `You are a worker agent. Complete this task end-to-end in the current ` +
      `repository. Do not ask for confirmation — make reasonable decisions.\n\n` +
      `${delivery}\n\n` +
      `TASK:\n${body}`
    );
  }

  /**
   * Pull the PR url / pushed branch out of the worker's output (the marker it
   * was told to print last), so the task carries a real link, not a blind
   * "went to review".
   */
  private parseDeliveryResult(output: string): {
    prUrl?: string;
    branch?: string;
  } {
    const prMatch = output.match(/PR_URL:\s*(\S+)/);
    if (prMatch) return { prUrl: prMatch[1] };
    const pushMatch = output.match(/PUSHED:\s*(\S+)/);
    if (pushMatch) return { branch: pushMatch[1] };
    return {};
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
