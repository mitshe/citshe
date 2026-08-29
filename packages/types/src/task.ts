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

/** Build a brand-new project, or refresh an existing live site. */
export type BuildMode = "scratch" | "refresh";

/**
 * What KIND of thing the worker is building. Each type gets its own prompt,
 * stack and deploy recipe (see buildBuilderInstructions). `website` is the
 * default and the historical behaviour.
 */
export type ProjectType =
  | "website" // marketing / content / landing / blog
  | "webapp" // app with auth, dashboard, dynamic server logic
  | "api" // an HTTP API / backend service
  | "scraper" // pulls data on a schedule into a database
  | "worker"; // a recurring job / action (cron)

/** Who can see the repo the worker creates. Defaults to private. */
export type RepoVisibility = "private" | "public";

/**
 * Instructions for a "New project" build task. Present only on tasks created by
 * the New-project wizard; such a task has no repositoryId — the worker creates
 * the repo itself, builds the site, and deploys it.
 */
export interface BuildSpec {
  mode: BuildMode;
  /** What KIND of project this is. Defaults to "website" for back-compat. */
  projectType?: ProjectType;
  /** What the user wants built, in their own words. */
  prompt: string;
  /** For "refresh": the existing site the worker should look at and improve. */
  sourceUrl?: string;
  /** Repo visibility on GitHub. Defaults to private. */
  visibility: RepoVisibility;
  /**
   * The repo citshe created up-front for this project (the worker clones it and
   * builds into it, instead of running `gh repo create`). Set by the wizard.
   */
  repositoryId?: string;
  /** The created repo's full path (owner/name), for the builder prompt. */
  repoFullPath?: string;
  /** Optional advanced override: force a stack instead of letting Claude pick. */
  stackHint?: "next" | "astro" | "astro-svelte";
  /** Optional advanced override: force a host instead of the suggested one. */
  hostingHint?: "cloudflare" | "vercel";
}

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
  /** Present when this task was created by the New-project wizard. */
  buildSpec?: BuildSpec | null;
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
  /** Set to turn this into a "build a project from scratch / refresh" task. */
  buildSpec?: BuildSpec;
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
