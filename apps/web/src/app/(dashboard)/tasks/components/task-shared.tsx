"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Terminal,
  Play,
  MoreHorizontal,
  Trash2,
  ArrowRight,
  GitPullRequest,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import {
  useProcessTask,
  useUpdateTask,
  useCloseTask,
  useReopenTask,
} from "@/lib/api/hooks";
import { formatDistanceToNow, cn } from "@/lib/utils";
import { getTaskStatus, getPriority } from "@/lib/status-config";
import { toast } from "sonner";
import type { Task, TaskStatus } from "@/lib/api/types";

const LIVE_WORKER_STATUSES: TaskStatus[] = ["ANALYZING", "IN_PROGRESS"];
const OPEN_STATUSES: TaskStatus[] = ["PENDING", "QUEUED"];

// ============================================================================
// Board columns — a display layer over the machine TaskStatus.
// There is NO "Done" column: finishing a task = closing it (it leaves the
// board). Exactly 3 working columns + an optional "Closed" section.
// ============================================================================

export type ColumnId = "todo" | "in_progress" | "review" | "closed";

export interface Column {
  id: ColumnId;
  name: string;
  statuses: TaskStatus[];
  // The status a card moves to when dropped into this column.
  moveTo?: TaskStatus;
}

export const COLUMNS: Column[] = [
  { id: "todo", name: "Todo", statuses: ["PENDING", "QUEUED"], moveTo: "PENDING" },
  {
    id: "in_progress",
    name: "In Progress",
    statuses: ["ANALYZING", "IN_PROGRESS"],
    moveTo: "IN_PROGRESS",
  },
  { id: "review", name: "Review", statuses: ["REVIEW"], moveTo: "REVIEW" },
];

// Extra section for closed tasks, shown only when "Show closed" is on.
export const CLOSED_COLUMN: Column = {
  id: "closed",
  name: "Closed",
  statuses: ["COMPLETED", "FAILED", "CANCELLED"],
};

// A task is "closed" when it has a closedAt, or its status is terminal.
const TERMINAL_STATUSES: TaskStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

export function isClosed(task: Task): boolean {
  return !!task.closedAt || TERMINAL_STATUSES.includes(task.status);
}

/** Which of the 3 working columns an (open) task belongs to. */
export function columnForTask(task: Task): ColumnId {
  if (isClosed(task)) return "closed";
  const col = COLUMNS.find((c) => c.statuses.includes(task.status));
  return col?.id ?? "todo";
}

/** Pull a PR/MR url off task.result if present. */
export function prUrl(task: Task): string | null {
  const r = task.result as Record<string, unknown> | null | undefined;
  if (!r) return null;
  const candidate = r.prUrl ?? r.mergeRequestUrl ?? r.pullRequestUrl;
  return typeof candidate === "string" && candidate ? candidate : null;
}

/** MIME-ish key the drag payload uses. */
export const DND_TASK_ID = "application/x-citshe-task-id";

// ============================================================================
// Shared visual primitives — status pill + label chip (new design system).
// ============================================================================

/** Status pill driven by status-config (kept as the source of truth). */
export function StatusPill({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  const s = getTaskStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium [&>svg]:size-3 transition-linear",
        s.color,
        className,
      )}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

/** Label chip — bordered pill, xs, subtle hover. Uses the shared Chip. */
export function LabelChip({
  label,
  onClick,
}: {
  label: string;
  onClick?: (label: string) => void;
}) {
  return <Chip onClick={onClick ? () => onClick(label) : undefined}>{label}</Chip>;
}

// ============================================================================
// Shared task actions hook — Run / Move / Close / Reopen with toasts.
// ============================================================================

export function useTaskActions(task: Task) {
  const processTask = useProcessTask();
  const updateTask = useUpdateTask();
  const closeTask = useCloseTask();
  const reopenTask = useReopenTask();

  const busy =
    processTask.isPending ||
    updateTask.isPending ||
    closeTask.isPending ||
    reopenTask.isPending;

  const run = async () => {
    try {
      await processTask.mutateAsync(task.id);
      toast.success("Delegated to a worker");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run task");
    }
  };

  const moveTo = async (col: Column) => {
    if (!col.moveTo) return;
    try {
      await updateTask.mutateAsync({ id: task.id, data: { status: col.moveTo } });
      toast.success(`Moved to ${col.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move task");
    }
  };

  const close = async () => {
    try {
      await closeTask.mutateAsync(task.id);
      toast.success("Task closed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to close task");
    }
  };

  const reopen = async () => {
    try {
      await reopenTask.mutateAsync(task.id);
      toast.success("Task reopened");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reopen task");
    }
  };

  return { run, moveTo, close, reopen, busy, processTask };
}

// ============================================================================
// Task actions menu — the "⋯" dropdown, shared by card and list row.
// ============================================================================

export function TaskMenu({
  task,
  onDelete,
  triggerClassName,
}: {
  task: Task;
  onDelete: (task: Task) => void;
  triggerClassName?: string;
}) {
  const { run, moveTo, close, reopen, busy, processTask } = useTaskActions(task);

  const liveWorker =
    !!task.sessionId && LIVE_WORKER_STATUSES.includes(task.status);
  const isOpen = OPEN_STATUSES.includes(task.status);
  const closed = isClosed(task);
  const current = columnForTask(task);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={cn("h-6 w-6 p-0 opacity-60 hover:opacity-100", triggerClassName)}
          onClick={(e) => e.stopPropagation()}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem asChild>
          <Link href={`/tasks/${task.id}`}>Open</Link>
        </DropdownMenuItem>
        {isOpen && (
          <DropdownMenuItem onClick={run} disabled={processTask.isPending}>
            <Play className="mr-2 h-3.5 w-3.5" />
            Run
          </DropdownMenuItem>
        )}
        {liveWorker && task.sessionId && (
          <DropdownMenuItem asChild>
            <Link href={`/sessions/${task.sessionId}`}>
              <Terminal className="mr-2 h-3.5 w-3.5" />
              Watch
            </Link>
          </DropdownMenuItem>
        )}
        {!closed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight className="mr-2 h-3.5 w-3.5" />
                Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {COLUMNS.filter((c) => c.id !== current).map((c) => (
                  <DropdownMenuItem key={c.id} onClick={() => moveTo(c)}>
                    {c.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        <DropdownMenuSeparator />
        {closed ? (
          <DropdownMenuItem onClick={reopen}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Reopen
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={close}>
            <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
            Close
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(task)}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================================
// Task card (board)
// ============================================================================

export function TaskCard({
  task,
  repoName,
  onDelete,
  onLabelClick,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  repoName: string;
  onDelete: (task: Task) => void;
  onLabelClick: (label: string) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  const link = prUrl(task);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-lg border border-border bg-surface-card p-2.5 transition-linear hover:bg-surface-hover focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      {/* Status + menu */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <StatusPill status={task.status} />
        <TaskMenu
          task={task}
          onDelete={onDelete}
          triggerClassName="group-hover:opacity-100"
        />
      </div>

      {/* Title */}
      <Link
        href={`/tasks/${task.id}`}
        className="block text-sm font-medium leading-snug text-foreground hover:underline"
      >
        {task.title}
      </Link>

      {/* Labels */}
      {(task.labels ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(task.labels ?? []).map((l) => (
            <LabelChip key={l} label={l} onClick={onLabelClick} />
          ))}
        </div>
      )}

      {/* Footer: repo · updated · PR */}
      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-text-subtle">
        <span className="truncate">{repoName}</span>
        <span className="text-text-subtle/50">·</span>
        <span className="whitespace-nowrap">
          {formatDistanceToNow(new Date(task.updatedAt))}
        </span>
        {link && (
          <>
            <span className="text-text-subtle/50">·</span>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <GitPullRequest className="h-3 w-3" />
              View PR
            </a>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Task row (list)
// ============================================================================

export function TaskRow({
  task,
  repoName,
  onDelete,
  onLabelClick,
}: {
  task: Task;
  repoName: string;
  onDelete: (task: Task) => void;
  onLabelClick: (label: string) => void;
}) {
  const priority = task.priority ? getPriority(task.priority) : null;
  const link = prUrl(task);

  return (
    <tr className="group border-b border-border last:border-0 transition-linear hover:bg-surface-hover focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
      {/* Title */}
      <td className="max-w-0 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/tasks/${task.id}`}
            className="truncate text-sm font-medium text-foreground hover:underline"
          >
            {task.title}
          </Link>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-primary hover:underline"
              title="View PR"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="px-3 py-2">
        <StatusPill status={task.status} />
      </td>

      {/* Priority */}
      <td className="px-3 py-2">
        {priority ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
              priority.color,
            )}
          >
            {priority.label}
          </span>
        ) : (
          <span className="text-xs text-text-subtle">—</span>
        )}
      </td>

      {/* Repo */}
      <td className="px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{repoName}</span>
      </td>

      {/* Labels */}
      <td className="px-3 py-2">
        {(task.labels ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {(task.labels ?? []).map((l) => (
              <LabelChip key={l} label={l} onClick={onLabelClick} />
            ))}
          </div>
        ) : (
          <span className="text-xs text-text-subtle">—</span>
        )}
      </td>

      {/* Updated */}
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {formatDistanceToNow(new Date(task.updatedAt))}
      </td>

      {/* Actions */}
      <td className="px-3 py-2 text-right">
        <TaskMenu
          task={task}
          onDelete={onDelete}
          triggerClassName="opacity-100"
        />
      </td>
    </tr>
  );
}
