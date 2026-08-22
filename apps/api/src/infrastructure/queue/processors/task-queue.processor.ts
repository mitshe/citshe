import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES, TaskQueueJob } from '../queues';
import { OrchestrationService } from '../../../modules/mcp/orchestration/orchestration.service';

/**
 * Orchestrator worker queue (`task-queue`).
 *
 * Each job runs one QUEUED task end-to-end inside a session container
 * (`claude -p`) via {@link OrchestrationService.executeTask} — the SAME
 * container/session path terminals use. Concurrency is capped at
 * MAX_CONCURRENT_WORKERS so BullMQ limits real parallelism natively (no manual
 * runningWorkers counting). Job `priority` is derived from the task's
 * queueOrder (lower queueOrder = smaller priority = pulled first).
 *
 * Resilience: failures re-throw so BullMQ retries (attempts + backoff). On the
 * final attempt the task is marked FAILED — a failed job never crashes the
 * worker.
 */
@Processor(QUEUES.TASK_QUEUE, {
  concurrency: OrchestrationService.MAX_CONCURRENT_WORKERS,
})
export class TaskQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(TaskQueueProcessor.name);

  constructor(private readonly orchestration: OrchestrationService) {
    super();
  }

  async process(job: Job<TaskQueueJob>): Promise<void> {
    const { taskId, organizationId } = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    this.logger.log(
      `Running task ${taskId} (org ${organizationId}) — attempt ${attempt}/${maxAttempts}`,
    );

    try {
      await this.orchestration.executeTask(organizationId, taskId);
      this.logger.log(`Task ${taskId} finished — REVIEW.`);
    } catch (err) {
      const message = (err as Error).message;
      const isLastAttempt = attempt >= maxAttempts;
      this.logger.error(
        `Task ${taskId} failed on attempt ${attempt}/${maxAttempts}: ${message}`,
      );

      if (isLastAttempt) {
        // Retries exhausted → mark FAILED. Swallow so the worker stays alive.
        try {
          await this.orchestration.markTaskFailed(
            organizationId,
            taskId,
            `Worker failed after ${maxAttempts} attempts: ${message}`,
          );
        } catch (failErr) {
          this.logger.error(
            `Failed to mark task ${taskId} FAILED: ${(failErr as Error).message}`,
          );
        }
      }

      // Re-throw so BullMQ records the failure and schedules a retry (if any
      // attempts remain). The worker itself is not crashed by this.
      throw err;
    }
  }
}
