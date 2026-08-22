"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Trash2,
  Loader2,
  ExternalLink,
  FolderOpen,
  MoreVertical,
  Sparkles,
  AlertCircle,
  Terminal,
  Plus,
  Bot,
  CheckCircle2,
  RotateCcw,
  GitPullRequest,
  ArrowUpRight,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/section-header";
import { formatDistanceToNow, cn } from "@/lib/utils";
import {
  useTask,
  useUpdateTask,
  useDeleteTask,
  useCloseTask,
  useReopenTask,
  useProcessTask,
} from "@/lib/api/hooks";
import { toast } from "sonner";
import type { Task, TaskStatus, TaskPriority } from "@/lib/api/types";
import { getTaskStatus, getPriority } from "@/lib/status-config";

// ---------------------------------------------------------------------------
// Helpers — defensive narrowing of loosely-typed JSON (result / agentLogs)
// ---------------------------------------------------------------------------

/** A single normalized activity entry pulled from task.agentLogs. */
interface AgentLogEntry {
  agentName: string;
  action: string;
  details?: unknown;
  timestamp?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Narrow task.agentLogs (unknown JSON) into a clean array of entries. */
function normalizeAgentLogs(raw: unknown): AgentLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((entry) => ({
    agentName: asString(entry.agentName) ?? "agent",
    action: asString(entry.action) ?? "",
    details: entry.details,
    timestamp: asString(entry.timestamp),
  }));
}

/** Compactly render an entry's `details` payload for the timeline. */
function formatDetails(details: unknown): string | null {
  if (details == null) return null;
  if (typeof details === "string") return details;
  if (typeof details === "number" || typeof details === "boolean") {
    return String(details);
  }
  if (isRecord(details)) {
    const lines = Object.entries(details)
      .map(([key, value]) => {
        const rendered =
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value);
        return `${key}: ${rendered}`;
      })
      .slice(0, 6);
    return lines.length > 0 ? lines.join("\n") : null;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return null;
  }
}

/** Pull a human-readable summary out of task.result, if any. */
function extractResultSummary(result: Task["result"]): string | null {
  if (!isRecord(result)) return null;
  for (const key of ["summary", "analysis", "message", "description"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

/** Pull a PR/MR url out of task.result, if any. */
function extractPrUrl(result: Task["result"]): string | null {
  if (!isRecord(result)) return null;
  for (const key of ["prUrl", "mergeRequestUrl", "pullRequestUrl"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

const CLOSED_STATUSES: TaskStatus[] = ["COMPLETED", "CANCELLED", "FAILED"];
const OPEN_STATUSES: TaskStatus[] = ["PENDING", "QUEUED"];

// Statuses the user can pick inline (open/working states only).
const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "PENDING", label: getTaskStatus("PENDING").label },
  { value: "IN_PROGRESS", label: getTaskStatus("IN_PROGRESS").label },
  { value: "REVIEW", label: getTaskStatus("REVIEW").label },
];

const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];

type Variant = "page" | "panel";

export interface TaskDetailProps {
  taskId: string;
  /**
   * `page` renders a two-column layout (main + meta rail) for the full-page
   * route. `panel` renders a dense single column for the slide-over.
   */
  variant?: Variant;
  /**
   * Called after the task is deleted. The page navigates to /tasks; the panel
   * closes the sheet.
   */
  onDeleted?: () => void;
  /** Optional deep-link shown in the panel header ("Open full page"). */
  fullPageHref?: string;
}

/**
 * The single source of truth for rendering a task's detail. Used both by the
 * full-page route (`/tasks/[id]`) and the board/list slide-over panel.
 *
 * Layout follows the Jira issue-view: a main column (title → primary actions →
 * a bordered description card → an activity feed) and a narrower meta rail (a
 * prominent Status control at the top → a collapsible "Details" panel →
 * Created/Updated timestamps). The `page` variant lays these out in two
 * columns; the `panel` variant stacks them in a single dense column.
 */
export function TaskDetail({
  taskId,
  variant = "page",
  onDeleted,
  fullPageHref,
}: TaskDetailProps) {
  const { data: task, isLoading, error } = useTask(taskId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const closeTask = useCloseTask();
  const reopenTask = useReopenTask();
  const processTask = useProcessTask();

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Inline description editing
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Add-label input
  const [newLabel, setNewLabel] = useState("");

  // Collapsible "Details" panel (Jira "Details ∧").
  const [detailsOpen, setDetailsOpen] = useState(true);

  useEffect(() => {
    if (editingDescription) descriptionRef.current?.focus();
  }, [editingDescription]);

  const save = async (
    data: Parameters<typeof updateTask.mutateAsync>[0]["data"],
  ) => {
    try {
      await updateTask.mutateAsync({ id: taskId, data });
    } catch {
      toast.error("Failed to save");
    }
  };

  const commitTitle = () => {
    setEditingTitle(false);
    if (task && titleDraft.trim() && titleDraft !== task.title) {
      void save({ title: titleDraft.trim() });
    }
  };

  const commitDescription = () => {
    setEditingDescription(false);
    if (task && descriptionDraft !== (task.description ?? "")) {
      void save({ description: descriptionDraft });
    }
  };

  const addLabel = () => {
    const value = newLabel.trim();
    if (!task || !value) return;
    const labels = task.labels ?? [];
    if (labels.includes(value)) {
      setNewLabel("");
      return;
    }
    setNewLabel("");
    void save({ labels: [...labels, value] });
  };

  const removeLabel = (label: string) => {
    if (!task) return;
    void save({ labels: (task.labels ?? []).filter((l) => l !== label) });
  };

  const handleDeleteTask = async () => {
    try {
      await deleteTask.mutateAsync(taskId);
      toast.success("Task deleted");
      onDeleted?.();
    } catch {
      toast.error("Failed to delete task");
    } finally {
      setIsDeleteOpen(false);
    }
  };

  const isPanel = variant === "panel";
  const pad = isPanel ? "" : "px-4 sm:px-6 py-6";

  if (isLoading) {
    return (
      <div className={cn("w-full", pad)}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className={cn("w-full", pad)}>
        <EmptyState
          icon={<AlertCircle />}
          title="Task not found"
          description="It may have been deleted, or the link is wrong."
          action={
            onDeleted ? (
              <Button variant="outline" size="sm" onClick={onDeleted}>
                Close
              </Button>
            ) : (
              <Link href="/tasks">
                <Button variant="outline" size="sm">
                  Back to tasks
                </Button>
              </Link>
            )
          }
        />
      </div>
    );
  }

  const isTaskClosed =
    task.closedAt != null || CLOSED_STATUSES.includes(task.status);
  const canRun = OPEN_STATUSES.includes(task.status);
  const labels = task.labels ?? [];
  const agentLogs = normalizeAgentLogs(task.agentLogs);
  const resultSummary = extractResultSummary(task.result);
  const prUrl = extractPrUrl(task.result);
  const saving = updateTask.isPending;
  const liveWorker =
    !!task.sessionId &&
    (task.status === "ANALYZING" || task.status === "IN_PROGRESS");
  const statusMeta = getTaskStatus(task.status);

  // -- Small building blocks reused across both layouts --------------------

  const overflowMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <MoreVertical className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canRun && (
          <DropdownMenuItem
            onClick={async () => {
              try {
                await processTask.mutateAsync(taskId);
                toast.success("Delegated to a worker");
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to run task",
                );
              }
            }}
            disabled={processTask.isPending}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Process with AI
          </DropdownMenuItem>
        )}
        {fullPageHref && (
          <DropdownMenuItem asChild>
            <Link href={fullPageHref}>
              <ArrowUpRight className="w-4 h-4 mr-2" />
              Open full page
            </Link>
          </DropdownMenuItem>
        )}
        {(fullPageHref || canRun) && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onClick={() => setIsDeleteOpen(true)}
          className="text-danger"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete task
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const closeReopenButton = isTaskClosed ? (
    <Button
      variant="outline"
      size={isPanel ? "sm" : "default"}
      onClick={async () => {
        try {
          await reopenTask.mutateAsync(taskId);
        } catch {
          toast.error("Failed to reopen task");
        }
      }}
      disabled={reopenTask.isPending}
    >
      <RotateCcw className="w-4 h-4 mr-2" />
      Reopen
    </Button>
  ) : (
    <Button
      variant="outline"
      size={isPanel ? "sm" : "default"}
      onClick={async () => {
        try {
          await closeTask.mutateAsync(taskId);
        } catch {
          toast.error("Failed to close task");
        }
      }}
      disabled={closeTask.isPending}
    >
      <CheckCircle2 className="w-4 h-4 mr-2" />
      Close
    </Button>
  );

  const titleBlock = editingTitle ? (
    <Input
      autoFocus
      value={titleDraft}
      onChange={(e) => setTitleDraft(e.target.value)}
      onBlur={commitTitle}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTitle();
        } else if (e.key === "Escape") {
          setEditingTitle(false);
        }
      }}
      className={cn(
        "h-auto py-1.5 font-semibold tracking-tight",
        isPanel ? "text-xl" : "text-2xl",
      )}
    />
  ) : (
    <h1
      className={cn(
        "-mx-2 cursor-text break-words rounded-md px-2 py-1 font-semibold tracking-tight transition-linear hover:bg-surface-hover",
        isPanel ? "text-xl leading-snug" : "text-2xl",
      )}
      onClick={() => {
        setTitleDraft(task.title);
        setEditingTitle(true);
      }}
    >
      {task.title}
    </h1>
  );

  // Primary actions row under the title (Jira "Create subtask / Link issue").
  const primaryActions = (
    <div className="flex flex-wrap items-center gap-2">
      {canRun && (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await processTask.mutateAsync(taskId);
              toast.success("Delegated to a worker");
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "Failed to run task",
              );
            }
          }}
          disabled={processTask.isPending}
        >
          {processTask.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-3.5 w-3.5" />
          )}
          Process with AI
        </Button>
      )}
      {prUrl && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            <GitPullRequest className="mr-2 h-3.5 w-3.5" />
            View PR
            <ExternalLink className="ml-1.5 h-3 w-3 opacity-60" />
          </Button>
        </a>
      )}
      {task.sessionId && (
        <Link href={`/sessions/${task.sessionId}`}>
          <Button variant="outline" size="sm">
            {liveWorker ? (
              <StatusDot state="running" size={8} className="mr-2" />
            ) : (
              <Terminal className="mr-2 h-3.5 w-3.5" />
            )}
            Watch terminal
          </Button>
        </Link>
      )}
    </div>
  );

  // Description in its own bordered card (the big visual change).
  const descriptionCard = (
    <section className="space-y-2">
      <Eyebrow>Description</Eyebrow>
      <div className="rounded-lg border border-border bg-surface-card">
        {editingDescription ? (
          <div className="p-3">
            <Textarea
              ref={descriptionRef}
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={commitDescription}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commitDescription();
                } else if (e.key === "Escape") {
                  setEditingDescription(false);
                }
              }}
              rows={6}
              placeholder="Add a description…"
            />
          </div>
        ) : (
          <div
            className="min-h-[3.5rem] cursor-text rounded-lg px-4 py-3 transition-linear hover:bg-surface-hover"
            onClick={() => {
              setDescriptionDraft(task.description ?? "");
              setEditingDescription(true);
            }}
          >
            {task.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {task.description}
              </p>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                Add a description…
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );

  // Jira-style activity feed: AI Summary card above an avatar/entry/timestamp
  // timeline, newest first.
  const activityBlock = (
    <section className="space-y-3">
      <Eyebrow>Activity</Eyebrow>

      {resultSummary && (
        <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            AI Summary
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {resultSummary}
          </p>
        </div>
      )}

      {agentLogs.length > 0 ? (
        <ol className="space-y-3">
          {[...agentLogs].reverse().map((entry, index) => {
            const details = formatDetails(entry.details);
            return (
              <li key={index} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-inset">
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {entry.agentName}
                    </span>
                    {entry.action && (
                      <span className="text-sm text-muted-foreground">
                        {entry.action}
                      </span>
                    )}
                    {entry.timestamp && (
                      <span className="text-xs text-text-subtle">
                        {formatDistanceToNow(new Date(entry.timestamp))}
                      </span>
                    )}
                  </div>
                  {details && (
                    <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-border bg-surface-inset p-2 font-mono text-xs text-muted-foreground">
                      {details}
                    </pre>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        !resultSummary && (
          <p className="text-sm italic text-text-subtle">No activity yet.</p>
        )
      )}
    </section>
  );

  // Prominent Status control — the primary control of the rail (Jira's colored
  // status button). Accent-tinted trigger driven by status-config.
  const statusControl = (
    <Select
      value={task.status}
      onValueChange={(value: TaskStatus) => void save({ status: value })}
    >
      <SelectTrigger
        className={cn(
          "w-full gap-2 border text-sm font-medium [&>svg]:size-3.5",
          statusMeta.color,
        )}
      >
        <span className="flex items-center gap-1.5">
          {statusMeta.icon}
          <SelectValue>{statusMeta.label}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
        {!STATUS_OPTIONS.some((o) => o.value === task.status) && (
          <SelectItem value={task.status} disabled>
            {statusMeta.label}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );

  // A single dense Details row: muted label (left) → value (right).
  const detailRow = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2 py-1.5">
      <span className="text-xs uppercase tracking-wide text-text-subtle">
        {label}
      </span>
      <div className="min-w-0 text-sm text-foreground">{value}</div>
    </div>
  );

  const priorityValue = (
    <Select
      value={task.priority ?? "medium"}
      onValueChange={(value: TaskPriority) => void save({ priority: value })}
    >
      <SelectTrigger size="sm" className="h-8 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITY_OPTIONS.map((value) => (
          <SelectItem key={value} value={value}>
            {getPriority(value).label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const repositoryValue = task.repository ? (
    <Link
      href="/repos"
      className="flex items-center gap-1.5 text-sm text-foreground transition-linear hover:text-primary"
    >
      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{task.repository.name}</span>
    </Link>
  ) : (
    <span className="text-sm text-text-subtle">—</span>
  );

  const labelsValue = (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <Chip
          key={label}
          onRemove={() => removeLabel(label)}
          removeLabel={`Remove ${label}`}
        >
          {label}
        </Chip>
      ))}
      <div className="flex items-center gap-1">
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLabel();
            }
          }}
          onBlur={addLabel}
          placeholder="Add label"
          className="h-7 w-24 text-xs"
        />
      </div>
    </div>
  );

  // Collapsible Details panel (Jira "Details ∧").
  const detailsPanel = (
    <div className="rounded-lg border border-border bg-surface-card">
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 transition-linear hover:bg-surface-hover"
      >
        <Eyebrow>Details</Eyebrow>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            !detailsOpen && "-rotate-90",
          )}
        />
      </button>
      {detailsOpen && (
        <div className="divide-y divide-border/60 border-t border-border px-3">
          {detailRow("Priority", priorityValue)}
          {detailRow("Repository", repositoryValue)}
          {detailRow("Labels", labelsValue)}
        </div>
      )}
    </div>
  );

  // Created / Updated / Closed timestamps (Jira's muted footer).
  const timestamps = (
    <div className="space-y-1 text-xs text-text-subtle">
      <div>Created {formatDistanceToNow(new Date(task.createdAt))}</div>
      <div>Updated {formatDistanceToNow(new Date(task.updatedAt))}</div>
      {task.closedAt && (
        <div>Closed {formatDistanceToNow(new Date(task.closedAt))}</div>
      )}
    </div>
  );

  const deleteDialog = (
    <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete task?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete &ldquo;{task.title}&rdquo;. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteTask.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteTask}
            disabled={deleteTask.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteTask.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            {deleteTask.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const savingIndicator = saving && (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="w-3 h-3 animate-spin" />
      Saving…
    </span>
  );

  // ------------------------------------------------------------------------
  // PANEL layout — dense single column, mobile-first. Same order as the page:
  // status → actions → title → description card → details → activity → dates.
  // ------------------------------------------------------------------------
  if (isPanel) {
    return (
      <div className="space-y-5">
        {/* Prominent status at the top, close/reopen + ⋯ on the right. */}
        <div className="flex items-center gap-2">
          <div className="min-w-[10rem] flex-1">{statusControl}</div>
          {savingIndicator}
          <div className="ml-auto flex items-center gap-2">
            {closeReopenButton}
            {overflowMenu}
          </div>
        </div>

        {titleBlock}
        {primaryActions}
        {descriptionCard}
        {detailsPanel}
        {activityBlock}
        {timestamps}

        {deleteDialog}
      </div>
    );
  }

  // ------------------------------------------------------------------------
  // PAGE layout — two columns: main (max readable width) + meta rail (~300px).
  // ------------------------------------------------------------------------
  return (
    <div className="w-full max-w-[1200px] space-y-6 px-4 sm:px-6 py-6 sm:py-8">
      {/* Back + top-level actions */}
      <div className="flex items-center justify-between gap-4">
        <Link href="/tasks">
          <Button variant="ghost" size="sm" className="-ml-2 shrink-0">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Tasks
          </Button>
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          {savingIndicator}
          {closeReopenButton}
          {overflowMenu}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        {/* ---- LEFT: main content ---- */}
        <div className="min-w-0 space-y-6">
          {titleBlock}
          {primaryActions}
          {descriptionCard}
          {activityBlock}
        </div>

        {/* ---- RIGHT: meta rail ---- */}
        <aside className="space-y-4 lg:border-l lg:border-border lg:pl-8">
          <div className="space-y-1.5">
            <Eyebrow>Status</Eyebrow>
            {statusControl}
          </div>
          {detailsPanel}
          {timestamps}
        </aside>
      </div>

      {deleteDialog}
    </div>
  );
}
