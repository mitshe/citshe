/**
 * Queue Definitions
 */

export const QUEUES = {
  TASK_PROCESSING: 'task-processing',
  /**
   * Orchestrator worker queue: each job runs one QUEUED task end-to-end in a
   * session container (`claude -p`). Only tasks actively being pulled live
   * here — the DB (status QUEUED + queueOrder) is the source of truth.
   */
  TASK_QUEUE: 'task-queue',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// Job Types
export interface TaskProcessingJob {
  type: 'process' | 'analyze' | 'complete' | 'fail';
  taskId: string;
  organizationId: string;
  payload?: Record<string, unknown>;
}

/**
 * A job on the orchestrator worker queue (`task-queue`). Job `priority` is
 * derived from the task's queueOrder (lower queueOrder = smaller priority =
 * pulled first).
 */
export interface TaskQueueJob {
  taskId: string;
  organizationId: string;
}
