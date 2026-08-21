"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Eye,
  X,
  Plus,
  Bot,
  CheckCircle2,
  RotateCcw,
  GitPullRequest,
} from "lucide-react";
import { formatDistanceToNow } from "@/lib/utils";
import {
  useTask,
  useUpdateTask,
  useDeleteTask,
  useProcessTask,
  useCloseTask,
  useReopenTask,
  useCreateSession,
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

// Statuses the user can pick inline (open/working states only).
const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "PENDING", label: "Todo" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "REVIEW", label: "Review" },
];

const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { data: task, isLoading, error } = useTask(taskId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const processTask = useProcessTask();
  const closeTask = useCloseTask();
  const reopenTask = useReopenTask();
  const createSession = useCreateSession();

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

  const handleProcessTask = async () => {
    try {
      await processTask.mutateAsync(taskId);
      toast.success("Task processing started");
    } catch {
      toast.error("Failed to process task");
    }
  };

  const openInThread = async (name: string, instructions: string) => {
    try {
      const session = await createSession.mutateAsync({
        name,
        repositoryIds: task?.repositoryId ? [task.repositoryId] : [],
        instructions,
      });
      toast.success("Thread created");
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create thread";
      toast.error(message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-red-500 mb-2">Task not found</p>
        <Link href="/tasks">
          <Button variant="outline">Back to Tasks</Button>
        </Link>
      </div>
    );
  }

  const isClosed =
    task.closedAt != null || CLOSED_STATUSES.includes(task.status);
  const statusConfig = getTaskStatus(task.status);
  const labels = task.labels ?? [];
  const agentLogs = normalizeAgentLogs(task.agentLogs);
  const resultSummary = extractResultSummary(task.result);
  const prUrl = extractPrUrl(task.result);
  const saving = updateTask.isPending;

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Link href="/tasks">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          {task.priority && (
            <Badge variant={getPriority(task.priority).variant}>
              {getPriority(task.priority).label}
            </Badge>
          )}
          <Badge variant={isClosed ? "secondary" : "outline"} className="gap-1">
            {isClosed ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : (
              <Clock className="w-3 h-3" />
            )}
            {isClosed ? "Closed" : "Open"}
          </Badge>
          {saving && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
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
                onClick={() =>
                  openInThread(task.title, task.description || task.title)
                }
                disabled={createSession.isPending}
              >
                <Terminal className="w-4 h-4 mr-2" />
                Open in Thread
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  openInThread(
                    `Review: ${task.title}`,
                    `Review this code for the following task:\n\n${task.title}\n\n${task.description || ""}\n\nCheck for: security issues, performance problems, code quality, test coverage.`,
                  )
                }
                disabled={createSession.isPending}
              >
                <Eye className="w-4 h-4 mr-2" />
                Review in Thread
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleProcessTask}
                disabled={processTask.isPending}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Process with AI
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setIsDeleteOpen(true)}
                className="text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Task
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
          className="text-2xl font-bold h-auto py-1.5"
        />
      ) : (
        <h1
          className="text-2xl font-bold break-words cursor-text rounded-md -mx-2 px-2 py-1 hover:bg-muted/50"
          onClick={() => {
            setTitleDraft(task.title);
            setEditingTitle(true);
          }}
        >
          {task.title}
        </h1>
      )}

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground border-b pb-4">
        {task.repository && (
          <Link
            href="/repos"
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            <FolderOpen className="w-4 h-4" />
            {task.repository.name}
          </Link>
        )}
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4" />
          Created {formatDistanceToNow(new Date(task.createdAt))}
        </div>
        {task.closedAt && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            Closed {formatDistanceToNow(new Date(task.closedAt))}
          </div>
        )}
      </div>

      {/* Status & priority controls */}
      <div className="flex flex-wrap gap-6">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Status
          </span>
          <Select
            value={task.status}
            onValueChange={(value: TaskStatus) => void save({ status: value })}
          >
            <SelectTrigger className="w-40">
              <SelectValue>{statusConfig.label}</SelectValue>
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
                  {statusConfig.label}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Priority
          </span>
          <Select
            value={task.priority ?? "medium"}
            onValueChange={(value: TaskPriority) =>
              void save({ priority: value })
            }
          >
            <SelectTrigger className="w-40">
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
      </div>

      {/* Labels */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          Labels
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {labels.map((label) => (
            <Badge key={label} variant="secondary" className="gap-1 pr-1">
              {label}
              <button
                type="button"
                onClick={() => removeLabel(label)}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${label}`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          <div className="flex items-center gap-1">
            <Plus className="w-3.5 h-3.5 text-muted-foreground" />
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
              className="h-7 w-32 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Description (inline editable) */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Description
        </h2>
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
            className="cursor-text rounded-md -mx-2 px-2 py-1.5 hover:bg-muted/50 min-h-9"
            onClick={() => {
              setDescriptionDraft(task.description ?? "");
              setEditingDescription(true);
            }}
          >
            {task.description ? (
              <p className="whitespace-pre-wrap text-foreground text-sm">
                {task.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Add a description…
              </p>
            )}
          </div>
        )}
      </div>

      {/* Links */}
      {(prUrl || task.sessionId) && (
        <div className="flex flex-wrap gap-2">
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <GitPullRequest className="w-4 h-4 mr-2" />
                View PR
                <ExternalLink className="w-3 h-3 ml-1.5 opacity-60" />
              </Button>
            </a>
          )}
          {task.sessionId && (
            <Link href={`/sessions/${task.sessionId}`}>
              <Button variant="outline" size="sm">
                <Terminal className="w-4 h-4 mr-2" />
                Watch terminal
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Activity / AI log */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Activity</h2>

        {resultSummary && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                AI Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {resultSummary}
              </p>
            </CardContent>
          </Card>
        )}

        {agentLogs.length > 0 ? (
          <ol className="relative space-y-4 border-l pl-6 ml-2">
            {agentLogs.map((entry, index) => {
              const details = formatDetails(entry.details);
              return (
                <li key={index} className="relative">
                  <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full bg-muted ring-4 ring-background">
                    <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">
                      {entry.agentName}
                    </span>
                    {entry.action && (
                      <span className="text-sm text-muted-foreground">
                        {entry.action}
                      </span>
                    )}
                    {entry.timestamp && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.timestamp))}
                      </span>
                    )}
                  </div>
                  {details && (
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-xs text-muted-foreground font-mono">
                      {details}
                    </pre>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          !resultSummary && (
            <p className="text-sm text-muted-foreground italic">
              No activity yet.
            </p>
          )
        )}
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
              {deleteTask.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
