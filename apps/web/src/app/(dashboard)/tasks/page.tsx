"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";
import {
  useTasks,
  useRepositories,
  useCreateTask,
  useDeleteTask,
  useProcessTask,
  useRefineTask,
} from "@/lib/api/hooks";
import { formatDistanceToNow, cn } from "@/lib/utils";
import { getTaskStatus } from "@/lib/status-config";
import { toast } from "sonner";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { Task, TaskStatus, RefinedTask } from "@/lib/api/types";
import { ImportTaskDialog } from "./components/import-task-dialog";

const LIVE_WORKER_STATUSES: TaskStatus[] = ["ANALYZING", "IN_PROGRESS"];
const OPEN_STATUSES: TaskStatus[] = ["PENDING", "QUEUED"];

// Order for the status column sort (active first, closed last).
const STATUS_ORDER: Record<TaskStatus, number> = {
  IN_PROGRESS: 0,
  ANALYZING: 1,
  QUEUED: 2,
  PENDING: 3,
  REVIEW: 4,
  COMPLETED: 5,
  FAILED: 6,
  CANCELLED: 7,
};

export default function TasksPage() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: repos = [] } = useRepositories();
  const deleteTask = useDeleteTask();

  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterRepo, setFilterRepo] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  const repoName = (id: string | null | undefined) =>
    id ? repos.find((r) => r.id === id)?.name ?? "—" : "—";

  const filtered = useMemo(() => {
    let result = tasks as Task[];
    if (filterStatus !== "all") {
      result = result.filter((t) => t.status === filterStatus);
    }
    if (filterRepo !== "all") {
      result = result.filter((t) => t.repositoryId === filterRepo);
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
    return [...result].sort((a, b) => {
      const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (s !== 0) return s;
      return +new Date(b.updatedAt) - +new Date(a.updatedAt);
    });
  }, [tasks, filterStatus, filterRepo, debouncedSearch]);

  const hasFilters = !!search || filterStatus !== "all" || filterRepo !== "all";
  const isEmpty = !isLoading && tasks.length === 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8 space-y-5">
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
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="PENDING">Open</SelectItem>
            <SelectItem value="IN_PROGRESS">Working</SelectItem>
            <SelectItem value="REVIEW">Review</SelectItem>
            <SelectItem value="COMPLETED">Closed</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
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
      </div>

      {/* Table */}
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
        <div className="overflow-hidden rounded-xl border border-border">
          {/* Header row (hidden on mobile) */}
          <div className="hidden grid-cols-[130px_1fr_140px_110px_90px] items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Status</span>
            <span>Title</span>
            <span>Repo</span>
            <span>Updated</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-border">
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                repoName={repoName(task.repositoryId)}
                onDelete={() => setDeleteTarget(task)}
              />
            ))}
          </div>
        </div>
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
// Table row
// ============================================================================

function TaskRow({
  task,
  repoName,
  onDelete,
}: {
  task: Task;
  repoName: string;
  onDelete: () => void;
}) {
  const processTask = useProcessTask();

  const status = getTaskStatus(task.status);
  const liveWorker =
    !!task.sessionId && LIVE_WORKER_STATUSES.includes(task.status);
  const isOpen = OPEN_STATUSES.includes(task.status);

  const run = async () => {
    try {
      await processTask.mutateAsync(task.id);
      toast.success("Delegated to a worker");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run task");
    }
  };

  return (
    <div className="grid grid-cols-1 items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/30 sm:grid-cols-[130px_1fr_140px_110px_90px] sm:gap-3">
      {/* Status */}
      <div className={cn("flex items-center gap-1.5 text-xs font-medium", status.color.split(" ")[1])}>
        {status.icon}
        <span>{status.label}</span>
      </div>

      {/* Title + labels */}
      <div className="min-w-0">
        <Link
          href={`/tasks/${task.id}`}
          className="block truncate text-sm hover:underline"
        >
          {task.title}
        </Link>
        {(task.labels ?? []).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {(task.labels ?? []).map((l) => (
              <span
                key={l}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Repo */}
      <span className="truncate text-xs text-muted-foreground">{repoName}</span>

      {/* Updated */}
      <span className="text-xs text-muted-foreground">
        {formatDistanceToNow(new Date(task.updatedAt))}
      </span>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1">
        {liveWorker && task.sessionId && (
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-emerald-500">
            <Link href={`/sessions/${task.sessionId}`}>
              <Terminal className="mr-1 h-3.5 w-3.5" />
              Watch
            </Link>
          </Button>
        )}
        {isOpen && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            disabled={processTask.isPending}
            title="Delegate to a worker (Claude Code)"
            onClick={run}
          >
            {processTask.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/tasks/${task.id}`}>Open</Link>
            </DropdownMenuItem>
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
  // action from the table (Play), gated on an AI key being present.
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
