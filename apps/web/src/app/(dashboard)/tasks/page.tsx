"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  X,
  Terminal,
  Sparkles,
  Send,
  Trash2,
  ChevronRight,
} from "lucide-react";
import {
  useTasks,
  useProjects,
  useCreateTask,
  useDeleteTask,
  useProcessTask,
  useRefineTask,
} from "@/lib/api/hooks";
import { formatDistanceToNow, cn } from "@/lib/utils";
import { toast } from "sonner";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { Task, TaskStatus, RefinedTask } from "@/lib/api/types";
import { ImportTaskDialog } from "./components/import-task-dialog";

// The four buckets a task moves through, in order. "Closed" collapses every
// terminal state (completed/failed/cancelled) — closed threads, closed work.
type Bucket = "open" | "working" | "review" | "closed";

const BUCKET_OF: Record<TaskStatus, Bucket> = {
  PENDING: "open",
  QUEUED: "open",
  ANALYZING: "working",
  IN_PROGRESS: "working",
  REVIEW: "review",
  COMPLETED: "closed",
  FAILED: "closed",
  CANCELLED: "closed",
};

const BUCKETS: { key: Bucket; label: string; dot: string }[] = [
  { key: "working", label: "Working", dot: "bg-emerald-500" },
  { key: "review", label: "Review", dot: "bg-indigo-500" },
  { key: "open", label: "Open", dot: "bg-muted-foreground" },
  { key: "closed", label: "Closed", dot: "bg-muted-foreground/40" },
];

const LIVE_WORKER_STATUSES: TaskStatus[] = ["ANALYZING", "IN_PROGRESS"];

export default function TasksPage() {
  const searchParams = useSearchParams();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: projects = [] } = useProjects();
  const deleteTask = useDeleteTask();

  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filterProjectId, setFilterProjectId] = useState<string>(
    searchParams.get("projectId") || "all",
  );
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  const filtered = useMemo(() => {
    let result = tasks as Task[];
    if (filterProjectId !== "all") {
      result = result.filter((t) => t.projectId === filterProjectId);
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
  }, [tasks, filterProjectId, debouncedSearch]);

  const byBucket = useMemo(() => {
    const map: Record<Bucket, Task[]> = {
      open: [],
      working: [],
      review: [],
      closed: [],
    };
    for (const t of filtered) map[BUCKET_OF[t.status]].push(t);
    for (const key of Object.keys(map) as Bucket[]) {
      map[key].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    }
    // Closed can grow unbounded — only show the most recent.
    map.closed = map.closed.slice(0, 15);
    return map;
  }, [filtered]);

  const hasFilters = !!search || filterProjectId !== "all";
  const isEmpty = !isLoading && filtered.length === 0 && !hasFilters;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Delegate work — AI plans, workers build.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setImportOpen(true)}
          className="shrink-0"
        >
          <Download className="mr-1.5 h-4 w-4" />
          Import
        </Button>
      </div>

      {/* AI-assisted composer — this is where "chat" went: help while you write. */}
      <TaskComposer projects={projects} />

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tasks or labels…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {projects.length > 0 && (
          <Select value={filterProjectId} onValueChange={setFilterProjectId}>
            <SelectTrigger className="w-36 shrink-0">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Sectioned list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isEmpty ? (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center">
          <ListTodo className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No tasks yet. Write one above and AI will help shape it.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing matches your filters.
        </p>
      ) : (
        <div className="space-y-6">
          {BUCKETS.map(({ key, label, dot }) => {
            const items = byBucket[key];
            if (items.length === 0) return null;
            return (
              <section key={key} className="space-y-2">
                <div className="flex items-center gap-2 px-0.5">
                  <span className={cn("h-2 w-2 rounded-full", dot)} />
                  <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {label}
                  </h2>
                  <span className="text-xs text-muted-foreground/60">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onDelete={() => setDeleteTarget(task)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ImportTaskDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projects={projects}
      />

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
// Composer — write a rough task, let AI tighten it, then delegate.
// ============================================================================

function TaskComposer({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const createTask = useCreateTask();
  const processTask = useProcessTask();
  const refine = useRefineTask();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [suggestion, setSuggestion] = useState<RefinedTask | null>(null);

  const busy = createTask.isPending || processTask.isPending;
  const canSubmit = title.trim().length > 0 && !busy;

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

  const reset = () => {
    setTitle("");
    setDescription("");
    setLabels([]);
    setSuggestion(null);
  };

  const handleDelegate = async () => {
    if (!canSubmit) return;
    try {
      const task = await createTask.mutateAsync({
        title: title.trim().slice(0, 200),
        description: description.trim() || undefined,
        labels: labels.length ? labels : undefined,
        projectId: projectId || undefined,
      });
      await processTask.mutateAsync(task.id);
      toast.success("Task delegated — AI is on it");
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delegate");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3 space-y-3">
      <Input
        placeholder="What should get done?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="border-0 bg-transparent px-1 text-base font-medium shadow-none focus-visible:ring-0"
      />
      <Textarea
        placeholder="Details, acceptance criteria… (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      />

      <LabelEditor labels={labels} onChange={setLabels} />

      {/* AI suggestion card — accept to fill the form, or dismiss. */}
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
          {suggestion.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestion.labels.map((l) => (
                <LabelChip key={l} label={l} />
              ))}
            </div>
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

      <div className="flex items-center gap-2">
        {projects.length > 0 && (
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-8 w-auto min-w-28 text-xs">
              <SelectValue placeholder="No project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">No project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefine}
          disabled={!title.trim() || refine.isPending}
          className="h-8"
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
          onClick={handleDelegate}
          disabled={!canSubmit}
          className="h-8"
        >
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          Delegate
        </Button>
      </div>
    </div>
  );
}

function LabelEditor({
  labels,
  onChange,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const clean = raw.trim().toLowerCase().replace(/^#/, "");
    if (clean && !labels.includes(clean) && labels.length < 20) {
      onChange([...labels, clean]);
    }
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      {labels.map((l) => (
        <LabelChip key={l} label={l} onRemove={() => onChange(labels.filter((x) => x !== l))} />
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && labels.length) {
            onChange(labels.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={labels.length ? "" : "+ label"}
        className="min-w-16 flex-1 bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

function LabelChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-foreground">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

// ============================================================================
// Task row
// ============================================================================

function TaskRow({ task, onDelete }: { task: Task; onDelete: () => void }) {
  const liveWorker =
    !!task.sessionId && LIVE_WORKER_STATUSES.includes(task.status);
  const href = liveWorker ? `/sessions/${task.sessionId}` : `/tasks/${task.id}`;

  return (
    <div className="group flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-3 transition-colors hover:bg-muted/40">
      <Link href={href} className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm">{task.title}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {(task.labels ?? []).map((l) => (
            <LabelChip key={l} label={l} />
          ))}
          <span className="text-[11px] text-muted-foreground/60">
            {formatDistanceToNow(new Date(task.updatedAt))}
          </span>
        </div>
      </Link>

      {liveWorker && (
        <Link
          href={`/sessions/${task.sessionId}`}
          className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-500"
        >
          <Terminal className="h-3.5 w-3.5" />
          Watch
        </Link>
      )}

      <button
        onClick={onDelete}
        className="shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-destructive"
        aria-label="Delete task"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
