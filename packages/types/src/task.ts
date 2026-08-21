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

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  repositoryId: string | null;
  sessionId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  organizationId: string;
  createdBy: string;
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
}

/** Live snapshot of the orchestrator queue and its workers. */
export interface QueueOverview {
  queuePaused: boolean;
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
  repositoryId?: string;
  assigneeId?: string;
  dueDate?: string;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  repositoryId?: string;
  assigneeId?: string;
  dueDate?: string;
}
