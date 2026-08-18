/**
 * Queue Definitions
 */

export const QUEUES = {
  TASK_PROCESSING: 'task-processing',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// Job Types
export interface TaskProcessingJob {
  type: 'process' | 'analyze' | 'complete' | 'fail';
  taskId: string;
  organizationId: string;
  payload?: Record<string, unknown>;
}
