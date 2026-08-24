import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import * as jwt from 'jsonwebtoken';
import { TaskStatus, Prisma, DeliveryMode } from '@prisma/client';
import { BuildSpec } from '@citshe/types';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { SessionsService } from '../../sessions/services/sessions.service';
import { SessionContainerService } from '../../sessions/services/session-container.service';
import { EventsGateway } from '../../../infrastructure/websocket/events.gateway';
import { QUEUES, TaskQueueJob } from '../../../infrastructure/queue/queues';

/**
 * The orchestrator: a persistent chat (the main Claude thread) decomposes work
 * into Tasks and dispatches them to worker threads. A worker is a session
 * (container running the `claude` CLI) that executes one task end-to-end and
 * reports back. The orchestrator plans; workers implement.
 *
 * This service holds the dispatch logic the MCP tools call into.
 */
@Injectable()
export class OrchestrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrchestrationService.name);
  private watchdogTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly containerService: SessionContainerService,
    private readonly eventsGateway: EventsGateway,
    private readonly config: ConfigService,
    @InjectQueue(QUEUES.TASK_QUEUE)
    private readonly taskQueue: Queue<TaskQueueJob>,
  ) {}

  onModuleInit() {
    // Watchdog: a worker can die silently (crash, OOM, killed container) and
    // leave its task stuck IN_PROGRESS forever — the agent never runs
    // `citshe-status review`, so nothing moves it. Sweep periodically and FAIL
    // tasks that have been IN_PROGRESS well past the exec timeout with no fresh
    // activity, so the board never shows a permanently "running" ghost.
    this.watchdogTimer = setInterval(() => {
      void this.sweepStuckTasks().catch(() => undefined);
      void this.reapIdleWorkers().catch(() => undefined);
    }, this.WATCHDOG_INTERVAL_MS);
    // Don't keep the process alive just for the timer.
    this.watchdogTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }

  /**
   * Sign a short-lived token the worker container uses to create follow-up
   * tasks on the board (POST /api/v1/worker/tasks) as the same org/user.
   */
  private signWorkerToken(
    organizationId: string,
    userId: string,
    taskId?: string,
  ): string {
    return jwt.sign(
      { organizationId, userId, taskId, type: 'worker' },
      this.config.get<string>('JWT_SECRET') || 'dev-secret',
      { expiresIn: '2h' },
    );
  }

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
  /** Watchdog sweep cadence. */
  private readonly WATCHDOG_INTERVAL_MS = 5 * 60_000;
  /**
   * A task IN_PROGRESS longer than this with no fresh activity is considered
   * dead (crashed worker / lost container). Comfortably past WORKER_EXEC_TIMEOUT
   * so a legitimately long build is never killed.
   */
  private readonly STUCK_TASK_MS = 30 * 60_000;
  /**
   * On success we KEEP the worker container running so you can "Continue with
   * Claude". But an idle finished worker left running forever leaks a container
   * + volumes. Stop it after this idle window (the per-org home volume persists,
   * so a later terminal/resume just spins a fresh container with the same auth).
   */
  private readonly WORKER_IDLE_REAP_MS = 30 * 60_000;

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

  /** Is the Claude engine logged in? Gate for the New-project wizard. */
  async engineStatus(): Promise<{ ok: boolean; reason?: string }> {
    return this.containerService.checkEngineAuth();
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
   * Start a "New project" build task immediately, regardless of the portal's
   * autoPull setting. The wizard calls this so the user watches Claude build
   * right away; a fresh portal has autoPull off, so plain enqueue would sit in
   * QUEUED. Respects only the hard queuePaused stop and worker capacity (via
   * the task-queue processor / executeTask, which QUEUEs when at capacity).
   */
  async startBuildTask(organizationId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true, status: true, queueOrder: true },
    });
    if (!task) {
      return { status: 'error', message: `Task ${taskId} not found.` };
    }

    const queueOrder = task.queueOrder ?? 0;
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.QUEUED, queueOrder },
    });
    this.eventsGateway.emitTaskUpdate(organizationId, {
      taskId,
      status: TaskStatus.QUEUED,
      message: 'Build queued…',
    });

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { queuePaused: true },
    });
    if (!org?.queuePaused) {
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

    // Resolve repositories: build tasks create their own repo (none), else
    // explicit override, else the task's own repo, else the org's active repos.
    const repositoryIds = task.buildSpec
      ? []
      : opts?.repositoryIds && opts.repositoryIds.length > 0
        ? opts.repositoryIds
        : task.repositoryId
          ? [task.repositoryId]
          : await this.defaultRepositoryIds(organizationId);

    // A build task has no repo to clone, so attach the org's GitHub
    // integration explicitly (repos normally carry it) — the worker needs `gh`
    // auth to create the new repo.
    const buildIntegrationIds = task.buildSpec
      ? (
          await this.prisma.integration.findMany({
            where: { organizationId, type: 'GITHUB', status: 'CONNECTED' },
            select: { id: true },
          })
        ).map((i) => i.id)
      : undefined;

    // Create the worker thread.
    const session = await this.sessionsService.create(organizationId, userId, {
      name: `worker: ${task.title}`.slice(0, 80),
      repositoryIds,
      ...(buildIntegrationIds ? { integrationIds: buildIntegrationIds } : {}),
      instructions: this.buildWorkerInstructions(
        task.title,
        task.description,
        task.deliveryMode ?? 'PR',
        [],
        (task.buildSpec as BuildSpec | null) ?? null,
      ),
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

    // A build task clones the repo the wizard created up-front (so the worker
    // builds into a real, panel-tracked repo). Older build tasks with no repo
    // fall back to an empty /workspace (the prompt then runs `gh repo create`).
    const buildSpec = (task.buildSpec as BuildSpec | null) ?? null;
    const repositoryIds = task.buildSpec
      ? buildSpec?.repositoryId
        ? [buildSpec.repositoryId]
        : []
      : task.repositoryId
        ? [task.repositoryId]
        : await this.defaultRepositoryIds(organizationId);

    // Attach the org's connected GitHub integration(s) so the worker can
    // clone and push a PR (and, for a build task, create the new repo).
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
          task.deliveryMode ?? 'PR',
          [],
          (task.buildSpec as BuildSpec | null) ?? null,
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
          workerToken: this.signWorkerToken(
            organizationId,
            task.createdBy,
            task.id,
          ),
          workerTaskId: task.id,
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
      buildSpec?: Prisma.JsonValue;
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

      const comments = await this.collectUserComments(taskId);
      const prompt = this.buildWorkerInstructions(
        task.title,
        task.description,
        task.deliveryMode ?? 'PR',
        comments,
        (task.buildSpec as BuildSpec | null) ?? null,
      );
      // Run Claude INTERACTIVELY inside the shared tmux "agent" window so you
      // can watch it live and even take over (attach to the same window). We
      // pipe the window to a log to capture the transcript, and detect the end
      // via a printed marker.
      const output = await this.runClaudeInTmux(session.containerId, prompt);

      // Claude never actually ran (e.g. not authenticated) — the worker printed
      // an error and exited 0, so don't mislabel it as "ready for review".
      const hardError = this.detectWorkerHardError(output);
      if (hardError) {
        throw new Error(hardError);
      }

      const delivery = this.parseDeliveryResult(output);

      // The AGENT owns the task status via the citshe skill: it calls
      // `citshe-status review` (or done) when its work is actually ready. We
      // respect that — if it already moved the task out of the working states,
      // we DON'T overwrite it. Only if it finished the process without setting a
      // status (forgot) do we fall back to REVIEW. This is why a task no longer
      // flips to REVIEW the instant it starts — the status is driven by the
      // agent's own skill call, not our guesswork.
      const current = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      const agentSetStatus =
        current != null &&
        current.status !== TaskStatus.IN_PROGRESS &&
        current.status !== TaskStatus.ANALYZING;
      const finalStatus =
        agentSetStatus && current ? current.status : TaskStatus.REVIEW;

      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: finalStatus,
          result: {
            output: output.slice(0, 20_000),
            ...(delivery.prUrl ? { prUrl: delivery.prUrl } : {}),
            ...(delivery.branch ? { branch: delivery.branch } : {}),
            ...(delivery.siteUrl ? { siteUrl: delivery.siteUrl } : {}),
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
        status: finalStatus,
        message: 'Worker finished.',
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
      // On failure, stop the (dead/unusable) container. On success, LEAVE it
      // running so you can "Continue with Claude" — take over the same session
      // interactively to refine or discuss the work. It's stopped when you
      // explicitly Stop/Close the session. The BullMQ worker slot frees itself
      // when this function returns, regardless of the container.
      if (caught) {
        await this.stopWorker(organizationId, sessionId);
      }
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

  /**
   * Reap finished-but-idle worker containers. On task success the worker is left
   * RUNNING for "Continue with Claude"; without this, those containers pile up
   * indefinitely (a real resource leak — this is why "the worker doesn't close").
   * Stop workers whose task is terminal (REVIEW/COMPLETED/FAILED) and whose
   * session has been idle past the reap window. The home volume stays, so resume
   * still works by spinning a fresh container. Bounded work; runs every 5 min.
   */
  private async reapIdleWorkers(): Promise<void> {
    const idleCutoff = new Date(Date.now() - this.WORKER_IDLE_REAP_MS);
    const sessions = await this.prisma.agentSession.findMany({
      where: {
        status: 'RUNNING',
        lastActiveAt: { lt: idleCutoff },
        // Only worker sessions (they have a task); leave ad-hoc terminals alone.
        tasks: {
          some: {
            status: {
              in: [
                TaskStatus.REVIEW,
                TaskStatus.COMPLETED,
                TaskStatus.FAILED,
                TaskStatus.CANCELLED,
              ],
            },
          },
        },
      },
      select: { id: true, organizationId: true },
      take: 50,
    });
    for (const s of sessions) {
      this.logger.log(`Reaping idle finished worker session ${s.id}.`);
      await this.stopWorker(s.organizationId, s.id).catch((err) =>
        this.logger.warn(`Reap failed for ${s.id}: ${(err as Error).message}`),
      );
    }
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
  /**
   * User comments added to a task's activity since the last worker run, so a
   * re-run ("Process with AI" after leaving feedback) picks them up. We take
   * comments that appear AFTER the most recent "executing" entry; if the worker
   * never ran, all comments count.
   */
  private async collectUserComments(taskId: string): Promise<string[]> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { agentLogs: true },
    });
    const logs = Array.isArray(task?.agentLogs)
      ? (task.agentLogs as Array<Record<string, unknown>>)
      : [];
    let lastRun = -1;
    logs.forEach((l, i) => {
      if (l.action === 'executing') lastRun = i;
    });
    return logs
      .slice(lastRun + 1)
      .filter((l) => l.action === 'comment')
      .map((l) => {
        const d = l.details as { text?: unknown } | undefined;
        return typeof d?.text === 'string' ? d.text : '';
      })
      .filter((t) => t.trim().length > 0);
  }

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
      const existing = Array.isArray(task?.agentLogs) ? task.agentLogs : [];
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

  /**
   * Run Claude interactively in the shared tmux "agent" window and return its
   * cleaned transcript. Because it runs in tmux, you can attach to the same
   * window (Watch / Continue) to see it work and take over. We pipe the window
   * to a log for the transcript and poll for a done-marker to detect the end.
   */
  private async runClaudeInTmux(
    containerId: string,
    prompt: string,
  ): Promise<string> {
    const promptB64 = Buffer.from(prompt).toString('base64');
    const LOG = '/tmp/citshe-agent.log';
    const OUT = '/tmp/citshe-agent.out';
    const PROMPT = '/tmp/citshe-prompt';
    // Completion is signalled by writing this SEPARATE file after claude exits —
    // NOT by a marker echoed in the pane (the shell echoes the command itself,
    // which made the poller "see" the marker instantly and flip the task to
    // REVIEW ~0.5s after START, with an empty result).
    const DONEFILE = '/tmp/citshe-agent.done';
    const DONE = '__CITSHE_DONE__'; // legacy marker (kept for cleanTranscript)
    const tmux = 'tmux -f /etc/tmux.conf';
    const bash = (script: string) =>
      this.containerService.execCommand(
        containerId,
        ['bash', '-lc', script],
        '/workspace',
        60_000,
        'executor',
      );

    // Prepare: write the prompt, (re)create the agent window, start logging it,
    // then launch Claude reading the prompt from stdin.
    //
    // CRITICAL: export HOME=/home/executor. tmux/exec run with HOME=/root, but
    // Claude's auth (~/.claude/.credentials.json) and settings live under the
    // executor home — without this, claude fails immediately ("Execution
    // error") because it can't find its credentials.
    //
    // We DON'T type the prompt interactively — a stdin redirect into interactive
    // claude can pop the one-time "Bypass Permissions" acknowledgment whose menu
    // then eats the piped prompt and the run stalls. `--print` is headless (no
    // TUI, no dialog); belt-and-suspenders we still auto-answer the dialog below.
    await bash(
      [
        `${tmux} has-session -t citshe 2>/dev/null || ${tmux} new-session -d -s citshe -x 200 -y 50 -c /workspace`,
        `echo '${promptB64}' | base64 -d > ${PROMPT}`,
        `: > ${LOG}`,
        `: > ${OUT}`,
        `rm -f ${DONEFILE}`,
        // Fresh agent window each run.
        `${tmux} kill-window -t citshe:agent 2>/dev/null || true`,
        `${tmux} new-window -t citshe -n agent -c /workspace`,
        `${tmux} pipe-pane -t citshe:agent -o 'cat >> ${LOG}'`,
        // Stream claude's events (stream-json) through the citshe formatter so
        // the pane shows LIVE, readable progress (Claude's text + "› tool …")
        // instead of a dead prompt while it "thinks in memory". The formatter
        // also writes the plain final text to ${OUT} for the task summary.
        // Completion is signalled by writing ${DONEFILE} AFTER claude exits —
        // never by a pane marker (which the shell echo would false-trigger).
        `${tmux} send-keys -t citshe:agent 'export HOME=/home/executor; ` +
          `claude --print --permission-mode bypassPermissions ` +
          `--output-format stream-json --include-partial-messages --verbose ` +
          `< ${PROMPT} 2>&1 | citshe-stream ${OUT}; ` +
          `echo $? > ${DONEFILE}' Enter`,
      ].join('; '),
    );

    // Poll a SEPARATE done-file (written only after claude exits) — not the pane
    // capture, which contains the echoed command and used to false-trigger.
    // If the bypass-mode acknowledgment ever appears, auto-accept it once.
    const deadline = Date.now() + this.WORKER_EXEC_TIMEOUT_MS;
    let acceptedDialog = false;
    while (Date.now() < deadline) {
      const done = await bash(`test -f ${DONEFILE} && echo 1 || true`);
      if (done.trim() === '1') break;
      if (!acceptedDialog) {
        const dlg = await bash(
          `grep -c 'Bypass Permissions mode' ${LOG} || true`,
        );
        if (parseInt(dlg.trim(), 10) > 0) {
          await bash(`${tmux} send-keys -t citshe:agent '2' Enter || true`);
          acceptedDialog = true;
        }
      }
      await this.sleep(3000);
    }

    // The formatter wrote Claude's plain final text to ${OUT}. Fall back to
    // scrubbing the noisy pane capture only if that's empty.
    const out = (await bash(`cat ${OUT} 2>/dev/null || true`)).trim();
    if (out) return out;
    const raw = await bash(`cat ${LOG} 2>/dev/null || true`);
    return this.cleanTranscript(raw, DONE);
  }

  /**
   * Clean a raw tmux pane capture into readable text: strip OSC title codes
   * (]0;… ), CSI colour/cursor sequences and other control chars, drop the
   * shell prompt lines and the command echo / done-marker we injected, and
   * collapse the runs of blank lines.
   */
  private cleanTranscript(raw: string, done: string): string {
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    let s = raw.replace(/\r/g, '');
    // OSC: ESC ] … (terminated by BEL or ESC\)  — e.g. window titles ]0;…
    s = s.replace(
      new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g'),
      '',
    );
    // CSI: ESC [ … final-byte  — colours, cursor moves.
    s = s.replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g'), '');
    // Any other lone control chars (except tab/newline).

    s = s.replace(new RegExp(`[${ESC}${BEL}\\x00-\\x08\\x0b-\\x1f]`, 'g'), '');

    const lines = s.split('\n').filter((line) => {
      const t = line.trim();
      if (!t) return true; // keep blanks for now, collapsed below
      // Drop the shell prompt / the command we injected / the done marker.
      if (/^executor@[^:]+:.*\$\s*/.test(t)) return false;
      // The launch line (any form of our claude command / the marker echo).
      if (t.includes('claude --print') || t.includes('claude --dangerously'))
        return false;
      if (t.includes('__CITSHE_DONE__') || t.includes(done)) return false;
      return true;
    });

    return lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
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

  /**
   * Watchdog sweep: fail tasks stuck IN_PROGRESS well past the exec timeout.
   * A task is "stuck" if it hasn't been touched (updatedAt) in STUCK_TASK_MS AND
   * its worker session/container is gone or not RUNNING — meaning the worker
   * died silently and will never move the task. Bounded work; runs every 5 min.
   */
  private async sweepStuckTasks(): Promise<void> {
    const cutoff = new Date(Date.now() - this.STUCK_TASK_MS);
    const stuck = await this.prisma.task.findMany({
      where: { status: TaskStatus.IN_PROGRESS, updatedAt: { lt: cutoff } },
      select: { id: true, organizationId: true, sessionId: true },
      take: 50,
    });
    if (stuck.length === 0) return;

    for (const t of stuck) {
      // If the session container is still genuinely running, leave it — the
      // build may just be long. Only fail when nothing is actually working.
      let alive = false;
      if (t.sessionId) {
        try {
          const s = await this.prisma.agentSession.findUnique({
            where: { id: t.sessionId },
            select: { status: true, containerId: true },
          });
          if (s?.status === 'RUNNING' && s.containerId) {
            const state = await this.containerService.getContainerState(
              s.containerId,
            );
            alive = state === 'running';
          }
        } catch {
          alive = false;
        }
      }
      if (alive) continue;

      this.logger.warn(
        `Watchdog: task ${t.id} stuck IN_PROGRESS with no live worker — failing.`,
      );
      await this.failTask(
        t.organizationId,
        t.id,
        'The build stopped unexpectedly (the worker went away). Try running it again.',
      ).catch((err) =>
        this.logger.error(
          `Watchdog could not fail task ${t.id}: ${(err as Error).message}`,
        ),
      );
    }
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
    comments: string[] = [],
    buildSpec?: BuildSpec | null,
  ): string {
    // "New project" wizard tasks get a dedicated builder prompt: the worker
    // creates its own repo, builds a site, and deploys it.
    if (buildSpec) {
      return this.buildBuilderInstructions(buildSpec, comments);
    }

    const base = description?.trim()
      ? `${title}\n\n${description.trim()}`
      : title;
    // Fold any user comments in as additional instructions for this run.
    const body =
      comments.length > 0
        ? `${base}\n\nADDITIONAL INSTRUCTIONS FROM THE USER (address these):\n` +
          comments.map((c) => `- ${c}`).join('\n')
        : base;

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
      this.commitIdentityRule() +
      `Use the "citshe" skill to keep the human updated: leave a note at ` +
      `meaningful milestones, attach a screenshot when you test a running web ` +
      `app, and add follow-up tasks for real out-of-scope work.\n\n` +
      `WHEN YOU ARE DONE, run ` +
      `\${CLAUDE_SKILL_DIR}/scripts/citshe-status.sh review — this is how the ` +
      `panel knows you finished. The task stays "in progress" until you run it, ` +
      `so run it ONLY when your work is actually ready. Don't spam.\n\n` +
      `TASK:\n${body}`
    );
  }

  /**
   * A prompt fragment telling the worker to commit as the configured git
   * identity — NOT to invent an author or add Co-Authored-By trailers. The
   * name/email come from config (GIT_COMMIT_NAME/EMAIL); nothing is hardcoded.
   * Returns '' when unset (git then uses the container's own config).
   */
  private commitIdentityRule(): string {
    const name = this.config.get<string>('GIT_COMMIT_NAME');
    const email = this.config.get<string>('GIT_COMMIT_EMAIL');
    if (!name || !email) return '';
    return (
      `COMMIT IDENTITY (important): commit as "${name} <${email}>". This is ` +
      `already configured via git env — do NOT set a different author, do NOT ` +
      `pass --author, and do NOT add any "Co-Authored-By" trailer. Every commit ` +
      `must be authored by ${name} only.\n\n`
    );
  }

  /**
   * Build the prompt for a "New project" task: create a brand-new repo, build a
   * site (or refresh an existing one), and deploy it live. The stack rules are
   * fixed policy; hosting has a suggested default per stack but can be
   * overridden. The repo is PRIVATE unless the user explicitly chose public.
   */
  private buildBuilderInstructions(
    spec: BuildSpec,
    comments: string[] = [],
  ): string {
    const visibilityFlag =
      spec.visibility === 'public' ? '--public' : '--private';

    const stackRules = [
      'STACK RULES (pick what fits what you are building):',
      '- A web application (auth, dashboards, dynamic server logic) → Next.js.',
      '- A static site (blog, docs, landing) → Astro.',
      '- A content site that needs interactive islands → Astro + Svelte.',
      '- If it needs a database → Neon (Postgres); use the neonctl CLI / NEON_API_KEY.',
      spec.stackHint ? `The user forced the stack: use ${spec.stackHint}.` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const hostingRules = [
      'HOSTING (deploy the finished site so it is live on a URL):',
      '- Astro / static / content → Cloudflare Pages (wrangler, CLOUDFLARE_API_TOKEN). Suggested.',
      '- Next.js / application → Vercel (vercel CLI, VERCEL_TOKEN). Suggested.',
      '- Next.js can also run on Cloudflare if that is what is connected.',
      'Only use a host whose token is present in the environment. Run ' +
        '`env | grep -E "CLOUDFLARE|VERCEL|NEON"` to see what is connected. If ' +
        'the host you would pick is NOT connected, use whichever IS, and leave a ' +
        'citshe note explaining the choice.',
      spec.hostingHint
        ? `The user forced the host: deploy to ${spec.hostingHint}.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const source =
      spec.mode === 'refresh' && spec.sourceUrl
        ? `This is a REFRESH of an existing site: ${spec.sourceUrl}\n` +
          `First visit it (fetch it / open it) to understand what they do and ` +
          `their current style, then build a modern, faster, better version — ` +
          `same character, improved UX. Do NOT copy it verbatim.\n\n`
        : `This is a brand-new project, built from scratch.\n\n`;

    const extra =
      comments.length > 0
        ? `\n\nADDITIONAL INSTRUCTIONS FROM THE USER (address these):\n` +
          comments.map((c) => `- ${c}`).join('\n')
        : '';

    // The wizard now creates the repo up-front and clones it into /workspace,
    // so the worker builds INTO it rather than running `gh repo create`.
    const repoStep = spec.repositoryId
      ? `1. The repo already exists and is cloned in /workspace` +
        (spec.repoFullPath ? ` (${spec.repoFullPath})` : '') +
        `. Build directly in it — it currently only has a README.\n`
      : `1. Create a new GitHub repo with: gh repo create <good-slug> ` +
        `${visibilityFlag} --source . --remote origin (initialise git in ` +
        `/workspace first; the repo MUST be ${spec.visibility}).\n`;

    return (
      `You are a builder agent. Build a project and deploy it live. Do not ask ` +
      `for confirmation — make reasonable decisions.\n\n` +
      source +
      `WHAT THE USER WANTS:\n${spec.prompt.trim()}${extra}\n\n` +
      stackRules +
      '\n\n' +
      hostingRules +
      '\n\n' +
      `STEPS:\n` +
      repoStep +
      `2. Scaffold and build the site per the stack rules. Make it genuinely ` +
      `good — real content, clean design, responsive, sensible SEO.\n` +
      `3. Commit and push (the default branch, origin is already set).\n` +
      `4. Deploy it to the chosen host so it is live on a public URL.\n` +
      `5. Report the live URL: run ` +
      `\${CLAUDE_SKILL_DIR}/scripts/citshe-site.sh "<live url>".\n` +
      `6. FINISH: run \${CLAUDE_SKILL_DIR}/scripts/citshe-status.sh review — this ` +
      `is how the panel knows you are DONE. The task stays "in progress" until ` +
      `you run it, so ONLY run it when the site is actually live. Also print, as ` +
      `the VERY LAST line of your output, exactly: SITE_URL: <live url>\n\n` +
      this.commitIdentityRule() +
      `Use the "citshe" skill throughout: leave a note at meaningful milestones ` +
      `(repo created, framework scaffolded, deploying…) and attach a screenshot ` +
      `of the deployed site. Report meaningfully, don't spam.`
    );
  }

  /**
   * Pull the PR url / pushed branch out of the worker's output (the marker it
   * was told to print last), so the task carries a real link, not a blind
   * "went to review".
   */
  /**
   * Spot outputs where Claude never really ran, so the task isn't mislabeled as
   * "review". The worker command exits 0 even when claude prints an error (e.g.
   * "Not logged in · Please run /login"), which otherwise sailed through to
   * REVIEW with an empty result. Returns a human message or null.
   */
  private detectWorkerHardError(output: string): string | null {
    const head = output.slice(0, 4000);
    if (
      /Not logged in|Please run \/login|Invalid API key|Credit balance|OAuth session expired|could not be refreshed|Failed to authenticate/i.test(
        head,
      )
    ) {
      return (
        "Claude isn't logged in (the session expired). Open a terminal and run " +
        '`claude /login` once, then retry the task. If the whole engine went ' +
        'stale, the login has to be refreshed on the server.'
      );
    }
    return null;
  }

  private parseDeliveryResult(output: string): {
    prUrl?: string;
    branch?: string;
    siteUrl?: string;
  } {
    const result: { prUrl?: string; branch?: string; siteUrl?: string } = {};
    // A build task deploys a site — capture its live URL (last one wins).
    const siteMatches = output.match(/SITE_URL:\s*(\S+)/g);
    if (siteMatches) {
      const last = siteMatches[siteMatches.length - 1];
      const m = last.match(/SITE_URL:\s*(\S+)/);
      if (m) result.siteUrl = m[1];
    }
    const prMatch = output.match(/PR_URL:\s*(\S+)/);
    if (prMatch) result.prUrl = prMatch[1];
    const pushMatch = output.match(/PUSHED:\s*(\S+)/);
    if (pushMatch) result.branch = pushMatch[1];
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
