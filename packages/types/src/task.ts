// Task types

export type TaskStatus =
  | "PENDING"
  | "QUEUED"
  | "ANALYZING"
  | "IN_PROGRESS"
  | "REVIEW"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

/** How a worker hands off its work when it finishes a task. */
export type DeliveryMode = "PR" | "DIRECT_PUSH";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  deliveryMode?: DeliveryMode;
  repositoryId: string | null;
  sessionId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  organizationId: string;
  createdBy: string;
  /** Ordering within the Queue column (gap-based; lower = pulled first). */
  queueOrder?: number | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  repository?: { id: string; name: string };
  result?: Record<string, unknown> | null;
  agentLogs?: Record<string, unknown>[] | null;
}

/** A trimmed task as it appears in the orchestrator queue overview. */
export interface QueueTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  sessionId: string | null;
  repositoryId: string | null;
  queueOrder?: number | null;
}

/** Live snapshot of the orchestrator queue and its workers. */
export interface QueueOverview {
  queuePaused: boolean;
  /** Per-portal auto-pull: when true, QUEUED tasks are actively pulled by workers. */
  autoPull: boolean;
  runningWorkers: number;
  maxWorkers: number;
  pending: QueueTask[];
  queued: QueueTask[];
  inProgress: QueueTask[];
  review: QueueTask[];
}

/** AI suggestion returned by the task composer while drafting a task. */
export interface RefinedTask {
  title: string;
  description: string;
  labels: string[];
  subtasks: { title: string; description: string; labels: string[] }[];
}

export interface CreateTaskDto {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  deliveryMode?: DeliveryMode;
  repositoryId?: string;
  assigneeId?: string;
  dueDate?: string;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  deliveryMode?: DeliveryMode;
  labels?: string[];
  repositoryId?: string;
  assigneeId?: string;
  dueDate?: string;
  queueOrder?: number;
}
