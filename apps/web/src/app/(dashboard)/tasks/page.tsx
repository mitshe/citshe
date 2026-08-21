"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Loader2,
  ListTodo,
  Download,
  Search,
  Plus,
  Sparkles,
  Terminal,
  Play,
  MoreHorizontal,
  Trash2,
  ChevronRight,
  ArrowRight,
  GitPullRequest,
  CheckCircle2,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useTasks,
  useRepositories,
  useCreateTask,
  useDeleteTask,
  useProcessTask,
  useRefineTask,
  useUpdateTask,
  useCloseTask,
  useReopenTask,
} from "@/lib/api/hooks";
import { formatDistanceToNow, cn } from "@/lib/utils";
import { getTaskStatus } from "@/lib/status-config";
import { toast } from "sonner";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { Task, TaskStatus, RefinedTask } from "@/lib/api/types";
import { ImportTaskDialog } from "./components/import-task-dialog";

const LIVE_WORKER_STATUSES: TaskStatus[] = ["ANALYZING", "IN_PROGRESS"];
const OPEN_STATUSES: TaskStatus[] = ["PENDING", "QUEUED"];

// ============================================================================
// Board columns — a display layer over the machine TaskStatus.
// ============================================================================

type ColumnId = "todo" | "in_progress" | "review" | "done" | "closed";

const COLUMNS: {
  id: ColumnId;
  name: string;
  statuses: TaskStatus[];
  // The status a card moves to when dropped into this column.
  moveTo?: TaskStatus;
}[] = [
  { id: "todo", name: "Todo", statuses: ["PENDING", "QUEUED"], moveTo: "PENDING" },
  {
    id: "in_progress",
    name: "In Progress",
    statuses: ["ANALYZING", "IN_PROGRESS"],
    moveTo: "IN_PROGRESS",
  },
  { id: "review", name: "Review", statuses: ["REVIEW"], moveTo: "REVIEW" },
  { id: "done", name: "Done", statuses: ["COMPLETED"], moveTo: "COMPLETED" },
];

// Extra section for terminal/closed tasks, shown only when "Show closed" is on.
const CLOSED_COLUMN: { id: ColumnId; name: string; statuses: TaskStatus[] } = {
  id: "closed",
  name: "Closed",
  statuses: ["COMPLETED", "FAILED", "CANCELLED"],
};

const STATUS_TO_COLUMN: Record<TaskStatus, ColumnId> = {
  PENDING: "todo",
  QUEUED: "todo",
  ANALYZING: "in_progress",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  COMPLETED: "done",
  FAILED: "closed",
  CANCELLED: "closed",
};

// Terminal statuses that are hidden unless "Show closed" is on.
const TERMINAL_STATUSES: TaskStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

function isClosed(task: Task): boolean {
  return !!task.closedAt || TERMINAL_STATUSES.includes(task.status);
}

/** Pull a PR/MR url off task.result if present. */
function prUrl(task: Task): string | null {
  const r = task.result as Record<string, unknown> | null | undefined;
  if (!r) return null;
  const candidate =
    r.mergeRequestUrl ?? r.pullRequestUrl ?? r.prUrl ?? r.pull_request_url;
  return typeof candidate === "string" && candidate ? candidate : null;
}

export default function TasksPage() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: repos = [] } = useRepositories();
  const deleteTask = useDeleteTask();

  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filterRepo, setFilterRepo] = useState<string>("all");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  const repoName = (id: string | null | undefined) =>
    id ? repos.find((r) => r.id === id)?.name ?? "—" : "—";

  // Union of all labels across tasks, for the chip filter.
  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks as Task[]) {
      for (const l of t.labels ?? []) set.add(l);
    }
    return [...set].sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    let result = tasks as Task[];
    if (!showClosed) {
      result = result.filter((t) => !isClosed(t));
    }
    if (filterRepo !== "all") {
      result = result.filter((t) => t.repositoryId === filterRepo);
    }
    if (activeLabel) {
      result = result.filter((t) => (t.labels ?? []).includes(activeLabel));
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          (t.labels ?? []).some((l) => l.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [tasks, showClosed, filterRepo, activeLabel, debouncedSearch]);

  // Bucket tasks per column. Closed tasks only land in the Closed column.
  const byColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = {
      todo: [],
      in_progress: [],
      review: [],
      done: [],
      closed: [],
    };
    for (const t of filtered) {
      if (showClosed && isClosed(t)) {
        map.closed.push(t);
      } else {
        map[STATUS_TO_COLUMN[t.status]].push(t);
      }
    }
    for (const key of Object.keys(map) as ColumnId[]) {
      map[key].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    }
    return map;
  }, [filtered, showClosed]);

  const columns = showClosed ? [...COLUMNS, CLOSED_COLUMN] : COLUMNS;

  const hasFilters =
    !!search || filterRepo !== "all" || !!activeLabel || showClosed;
  const isEmpty = !isLoading && tasks.length === 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:py-8 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Delegate work — AI plans, workers build.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Import
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New task
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tasks or labels…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {repos.length > 0 && (
          <Select value={filterRepo} onValueChange={setFilterRepo}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Repo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All repos</SelectItem>
              {repos.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <label className="flex select-none items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
          <Switch checked={showClosed} onCheckedChange={setShowClosed} />
          Show closed
        </label>
      </div>

      {/* Label chip filter */}
      {allLabels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {allLabels.map((l) => {
            const active = activeLabel === l;
            return (
              <button
                key={l}
                onClick={() => setActiveLabel(active ? null : l)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                )}
              >
                {l}
              </button>
            );
          })}
          {activeLabel && (
            <button
              onClick={() => setActiveLabel(null)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Board */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isEmpty ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <ListTodo className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No tasks yet. Create one and AI will help shape it.
          </p>
          <Button size="sm" className="mt-4" onClick={() => setNewOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New task
          </Button>
        </div>
      ) : filtered.length === 0 && hasFilters ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing matches your filters.
        </p>
      ) : (
        <>
          {/* Desktop: kanban columns */}
          <div
            className={cn(
              "hidden gap-4 md:grid",
              showClosed ? "md:grid-cols-5" : "md:grid-cols-4",
            )}
          >
            {columns.map((col) => (
              <BoardColumn
                key={col.id}
                name={col.name}
                tasks={byColumn[col.id]}
                repoName={repoName}
                onDelete={setDeleteTarget}
                onLabelClick={setActiveLabel}
              />
            ))}
          </div>

          {/* Mobile: sectioned vertical list */}
          <div className="space-y-6 md:hidden">
            {columns.map((col) => (
              <section key={col.id} className="space-y-2">
                <div className="flex items-center gap-2 px-0.5">
                  <h2 className="text-sm font-semibold">{col.name}</h2>
                  <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                    {byColumn[col.id].length}
                  </span>
                </div>
                {byColumn[col.id].length === 0 ? (
                  <p className="px-0.5 text-xs text-muted-foreground/60">
                    Nothing here.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {byColumn[col.id].map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        repoName={repoName(task.repositoryId)}
                        onDelete={() => setDeleteTarget(task)}
                        onLabelClick={setActiveLabel}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <NewTaskDialog open={newOpen} onOpenChange={setNewOpen} repos={repos} />
      <ImportTaskDialog open={importOpen} onOpenChange={setImportOpen} />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await deleteTask.mutateAsync(deleteTarget.id);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Failed to delete",
                  );
                } finally {
                  setDeleteTarget(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// Board column (desktop)
// ============================================================================

function BoardColumn({
  name,
  tasks,
  repoName,
  onDelete,
  onLabelClick,
}: {
  name: string;
  tasks: Task[];
  repoName: (id: string | null | undefined) => string;
  onDelete: (task: Task) => void;
  onLabelClick: (label: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-border bg-muted/20">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{name}</h2>
        <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div className="flex max-h-[calc(100vh-16rem)] flex-col gap-2 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground/50">
            Nothing here.
          </p>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              repoName={repoName(task.repositoryId)}
              onDelete={() => onDelete(task)}
              onLabelClick={onLabelClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Task card
// ============================================================================

function TaskCard({
  task,
  repoName,
  onDelete,
  onLabelClick,
}: {
  task: Task;
  repoName: string;
  onDelete: () => void;
  onLabelClick: (label: string) => void;
}) {
  const processTask = useProcessTask();
  const updateTask = useUpdateTask();
  const closeTask = useCloseTask();
  const reopenTask = useReopenTask();

  const status = getTaskStatus(task.status);
  const liveWorker =
    !!task.sessionId && LIVE_WORKER_STATUSES.includes(task.status);
  const isOpen = OPEN_STATUSES.includes(task.status);
  const closed = isClosed(task);
  const currentColumn = STATUS_TO_COLUMN[task.status];
  const link = prUrl(task);

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

  const moveTo = async (col: (typeof COLUMNS)[number]) => {
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

  return (
    <div className="group rounded-xl border border-border bg-background p-3 shadow-sm transition-colors hover:border-foreground/20">
      {/* Status + menu */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] font-medium",
            status.color.split(" ")[1],
          )}
        >
          {status.icon}
          {status.label}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
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
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Move to
            </DropdownMenuLabel>
            {COLUMNS.filter((c) => c.id !== currentColumn).map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => moveTo(c)}>
                <ArrowRight className="mr-2 h-3.5 w-3.5" />
                {c.name}
              </DropdownMenuItem>
            ))}
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
              onClick={onDelete}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Title */}
      <Link
        href={`/tasks/${task.id}`}
        className="block text-sm font-medium leading-snug hover:underline"
      >
        {task.title}
      </Link>

      {/* Labels */}
      {(task.labels ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(task.labels ?? []).map((l) => (
            <button
              key={l}
              onClick={() => onLabelClick(l)}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted-foreground/20"
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Footer: repo · updated · PR */}
      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{repoName}</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="whitespace-nowrap">
          {formatDistanceToNow(new Date(task.updatedAt))}
        </span>
        {link && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <GitPullRequest className="h-3 w-3" />
              PR
            </a>
          </>
        )}
      </div>

      {/* Quick actions */}
      {(isOpen || liveWorker) && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {isOpen && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 px-2 text-xs"
              disabled={processTask.isPending}
              title="Delegate to a worker (Claude Code)"
              onClick={run}
            >
              {processTask.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1 h-3.5 w-3.5" />
              )}
              Run
            </Button>
          )}
          {liveWorker && task.sessionId && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-7 flex-1 px-2 text-xs text-emerald-600"
            >
              <Link href={`/sessions/${task.sessionId}`}>
                <Terminal className="mr-1 h-3.5 w-3.5" />
                Watch
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// New task dialog — write a draft, let AI refine, create as Open.
// ============================================================================

function NewTaskDialog({
  open,
  onOpenChange,
  repos,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  repos: { id: string; name: string }[];
}) {
  const createTask = useCreateTask();
  const refine = useRefineTask();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [suggestion, setSuggestion] = useState<RefinedTask | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setLabels([]);
    setLabelDraft("");
    setRepositoryId("");
    setSuggestion(null);
  };

  const addLabel = (raw: string) => {
    const clean = raw.trim().toLowerCase().replace(/^#/, "");
    if (clean && !labels.includes(clean) && labels.length < 20) {
      setLabels([...labels, clean]);
    }
    setLabelDraft("");
  };

  const handleRefine = async () => {
    if (!title.trim()) return;
    try {
      const result = await refine.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setSuggestion(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI refine failed");
    }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    setTitle(suggestion.title);
    setDescription(suggestion.description);
    setLabels(suggestion.labels);
    setSuggestion(null);
  };

  // Create the task as Open — it does NOT auto-run. Running is a deliberate
  // action from the board (Run).
  const handleCreate = async () => {
    if (!title.trim()) return;
    try {
      await createTask.mutateAsync({
        title: title.trim().slice(0, 200),
        description: description.trim() || undefined,
        labels: labels.length ? labels : undefined,
        repositoryId: repositoryId || undefined,
      });
      toast.success("Task created");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create task");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Input
            placeholder="What should get done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <Textarea
            placeholder="Details, acceptance criteria… (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />

          {/* Labels */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border px-2 py-1.5">
            {labels.map((l) => (
              <span
                key={l}
                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {l}
                <button onClick={() => setLabels(labels.filter((x) => x !== l))}>
                  ×
                </button>
              </span>
            ))}
            <input
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && labelDraft.trim()) {
                  e.preventDefault();
                  addLabel(labelDraft);
                }
              }}
              onBlur={() => labelDraft.trim() && addLabel(labelDraft)}
              placeholder={labels.length ? "" : "+ label"}
              className="min-w-16 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          {/* Repo */}
          {repos.length > 0 && (
            <Select
              value={repositoryId || "none"}
              onValueChange={(v) => setRepositoryId(v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No repository" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No repository</SelectItem>
                {repos.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* AI suggestion */}
          {suggestion && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2 text-sm">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                AI suggestion
              </div>
              <p className="font-medium">{suggestion.title}</p>
              {suggestion.description && (
                <p className="text-muted-foreground">{suggestion.description}</p>
              )}
              {suggestion.subtasks.length > 0 && (
                <div className="space-y-1 border-t border-primary/10 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Could be split into {suggestion.subtasks.length}:
                  </p>
                  {suggestion.subtasks.map((s, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-xs">
                      <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                      {s.title}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={applySuggestion} className="h-7">
                  Use this
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSuggestion(null)}
                  className="h-7"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefine}
            disabled={!title.trim() || refine.isPending}
          >
            {refine.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Improve with AI
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!title.trim() || createTask.isPending}
          >
            {createTask.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
