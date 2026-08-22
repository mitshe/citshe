"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  ArrowLeft,
  Trash2,
  Loader2,
  ExternalLink,
  FolderOpen,
  Clock,
  MoreVertical,
  Sparkles,
  AlertCircle,
  Terminal,
  Plus,
  Bot,
  CheckCircle2,
  RotateCcw,
  GitPullRequest,
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
} from "@/lib/api/hooks";
import { toast } from "sonner";
import type { Task, TaskStatus, TaskPriority } from "@/lib/api/types";
import { getTaskStatus, getPriority } from "@/lib/status-config";
import { StatusPill } from "../components/task-shared";

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

// Statuses the user can pick inline (open/working states only).
// Labels come from status-config so the Select trigger and dropdown agree.
const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "PENDING", label: getTaskStatus("PENDING").label },
  { value: "IN_PROGRESS", label: getTaskStatus("IN_PROGRESS").label },
  { value: "REVIEW", label: getTaskStatus("REVIEW").label },
];

const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { data: task, isLoading, error } = useTask(taskId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const closeTask = useCloseTask();
  const reopenTask = useReopenTask();

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

  useEffect(() => {
    if (editingDescription) descriptionRef.current?.focus();
  }, [editingDescription]);

  const save = async (data: Parameters<typeof updateTask.mutateAsync>[0]["data"]) => {
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
      router.push("/tasks");
    } catch {
      toast.error("Failed to delete task");
    } finally {
      setIsDeleteOpen(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full max-w-[1400px] px-6 py-6">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="w-full max-w-[1400px] px-6 py-6">
        <EmptyState
          icon={<AlertCircle />}
          title="Task not found"
          description="It may have been deleted, or the link is wrong."
          action={
            <Link href="/tasks">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back to tasks
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const isClosed =
    task.closedAt != null || CLOSED_STATUSES.includes(task.status);
  const labels = task.labels ?? [];
  const agentLogs = normalizeAgentLogs(task.agentLogs);
  const resultSummary = extractResultSummary(task.result);
  const prUrl = extractPrUrl(task.result);
  const saving = updateTask.isPending;
  const liveWorker =
    !!task.sessionId &&
    (task.status === "ANALYZING" || task.status === "IN_PROGRESS");

  return (
    <div className="w-full max-w-[1400px] space-y-5 px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link href="/tasks">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <StatusPill status={task.status} />
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              isClosed
                ? "border-border bg-surface-inset/60 text-muted-foreground"
                : "border-border text-foreground",
            )}
          >
            {isClosed ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : (
              <Clock className="w-3 h-3" />
            )}
            {isClosed ? "Closed" : "Open"}
          </span>
          {saving && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving…
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isClosed ? (
            <Button
              variant="outline"
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
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setIsDeleteOpen(true)}
                className="text-danger"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Title (inline editable) */}
      {editingTitle ? (
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
          className="h-auto py-1.5 text-2xl font-semibold tracking-tight"
        />
      ) : (
        <h1
          className="-mx-2 cursor-text break-words rounded-md px-2 py-1 text-2xl font-semibold tracking-tight transition-linear hover:bg-surface-hover"
          onClick={() => {
            setTitleDraft(task.title);
            setEditingTitle(true);
          }}
        >
          {task.title}
        </h1>
      )}

      {/* Two-column: main content + right meta rail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* ---- Main content ---- */}
        <div className="min-w-0 space-y-6">
          {/* Description (inline editable) */}
          <div className="space-y-2">
            <Eyebrow>Description</Eyebrow>
            {editingDescription ? (
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
                rows={5}
                placeholder="Add a description…"
              />
            ) : (
              <div
                className="-mx-2 min-h-9 cursor-text rounded-md px-2 py-1.5 transition-linear hover:bg-surface-hover"
                onClick={() => {
                  setDescriptionDraft(task.description ?? "");
                  setEditingDescription(true);
                }}
              >
                {task.description ? (
                  <p className="whitespace-pre-wrap text-sm text-foreground">
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

          {/* Activity / AI log */}
          <div className="space-y-3">
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
              <ol className="relative ml-2 space-y-4 border-l border-border pl-6">
                {agentLogs.map((entry, index) => {
                  const details = formatDetails(entry.details);
                  return (
                    <li key={index} className="relative">
                      <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-card ring-4 ring-background">
                        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
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
                        <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border bg-surface-inset p-2 font-mono text-xs text-muted-foreground">
                          {details}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              !resultSummary && (
                <p className="text-sm italic text-text-subtle">
                  No activity yet.
                </p>
              )
            )}
          </div>
        </div>

        {/* ---- Right meta rail ---- */}
        <aside className="space-y-5 lg:border-l lg:border-border lg:pl-6">
          {/* Status */}
          <div className="space-y-1.5">
            <Eyebrow>Status</Eyebrow>
            <Select
              value={task.status}
              onValueChange={(value: TaskStatus) => void save({ status: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{getTaskStatus(task.status).label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
                {/* Preserve non-selectable statuses so the trigger stays valid */}
                {!STATUS_OPTIONS.some((o) => o.value === task.status) && (
                  <SelectItem value={task.status} disabled>
                    {getTaskStatus(task.status).label}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Eyebrow>Priority</Eyebrow>
            <Select
              value={task.priority ?? "medium"}
              onValueChange={(value: TaskPriority) =>
                void save({ priority: value })
              }
            >
              <SelectTrigger className="w-full">
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
          </div>

          {/* Repository */}
          <div className="space-y-1.5">
            <Eyebrow>Repository</Eyebrow>
            {task.repository ? (
              <Link
                href="/repos"
                className="flex items-center gap-1.5 text-sm text-foreground transition-linear hover:text-primary"
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{task.repository.name}</span>
              </Link>
            ) : (
              <span className="text-sm text-text-subtle">—</span>
            )}
          </div>

          {/* Labels */}
          <div className="space-y-1.5">
            <Eyebrow>Labels</Eyebrow>
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
          </div>

          {/* Timestamps */}
          <div className="space-y-1.5">
            <Eyebrow>Timeline</Eyebrow>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                Created {formatDistanceToNow(new Date(task.createdAt))}
              </div>
              {task.closedAt && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  Closed {formatDistanceToNow(new Date(task.closedAt))}
                </div>
              )}
            </div>
          </div>

          {/* Links */}
          {(prUrl || task.sessionId) && (
            <div className="space-y-1.5">
              <Eyebrow>Links</Eyebrow>
              <div className="flex flex-col gap-2">
                {prUrl && (
                  <a href={prUrl} target="_blank" rel="noopener noreferrer">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                    >
                      <GitPullRequest className="mr-2 h-4 w-4" />
                      View PR
                      <ExternalLink className="ml-auto h-3 w-3 opacity-60" />
                    </Button>
                  </a>
                )}
                {task.sessionId && (
                  <Link href={`/sessions/${task.sessionId}`}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                    >
                      {liveWorker ? (
                        <StatusDot state="running" size={8} className="mr-2" />
                      ) : (
                        <Terminal className="mr-2 h-4 w-4" />
                      )}
                      Watch terminal
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Delete confirm */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{task.title}&rdquo;. This
              action cannot be undone.
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
    </div>
  );
}
