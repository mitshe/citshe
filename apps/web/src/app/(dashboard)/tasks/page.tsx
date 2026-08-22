"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  ListTodo,
  Search,
  Plus,
  Sparkles,
  ChevronRight,
  X,
  LayoutGrid,
  List as ListIcon,
} from "lucide-react";
import {
  useTasks,
  useRepositories,
  useCreateTask,
  useDeleteTask,
  useRefineTask,
} from "@/lib/api/hooks";
import { toast } from "sonner";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { Task, RefinedTask } from "@/lib/api/types";
import { isClosed } from "./components/task-shared";
import { TaskBoardView } from "./components/task-board-view";
import { TaskListView } from "./components/task-list-view";
import { TaskSheet } from "./components/task-sheet";
import { QueueStatusBar } from "./components/queue-status-bar";

type ViewMode = "board" | "list";
const VIEW_STORAGE_KEY = "citshe.tasks.view";

export default function TasksPage() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: repos = [] } = useRepositories();
  const deleteTask = useDeleteTask();

  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filterRepo, setFilterRepo] = useState<string>("all");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  // Slide-over (Jira-style). The selected task id lives here; the board/list
  // cards call `openTask`. We sync it to `?task=<id>` so the panel is
  // shareable and the back button closes it.
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Hydrate from the URL (?task=<id>) on load / when it changes externally
  // (e.g. back/forward navigation).
  useEffect(() => {
    setSelectedTaskId(searchParams.get("task"));
  }, [searchParams]);

  const openTask = useCallback(
    (id: string) => {
      setSelectedTaskId(id);
      const params = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
      );
      params.set("task", id);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router],
  );

  const closeTask = useCallback(() => {
    setSelectedTaskId(null);
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    params.delete("task");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }, [router]);

  // View toggle — persisted in localStorage, SSR-safe (default "board").
  const [view, setView] = useState<ViewMode>("board");
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "board" || saved === "list") setView(saved);
  }, []);
  const changeView = (next: ViewMode) => {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  // The Board (columns) doesn't work on a phone — force List there and hide
  // the toggle. On wider screens the user's saved choice wins.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const effectiveView: ViewMode = isMobile ? "list" : view;

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

  // Shared filtered set — used by BOTH views.
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

  const hasFilters =
    !!search || filterRepo !== "all" || !!activeLabel || showClosed;
  const isEmpty = !isLoading && tasks.length === 0;

  return (
    <div className="w-full max-w-[1400px] px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Delegate work — AI plans, workers build.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle — hidden on phones, which are List-only. */}
          <div className="hidden sm:block">
            <SegmentedControl<ViewMode>
              aria-label="View mode"
              value={view}
              onChange={changeView}
              options={[
                { value: "board", label: "Board", icon: <LayoutGrid /> },
                { value: "list", label: "List", icon: <ListIcon /> },
              ]}
            />
          </div>
          <Button size="sm" className="ml-auto sm:ml-0" onClick={() => setNewOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New task
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
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
        <label className="flex h-9 select-none items-center gap-2 rounded-md border border-border bg-surface-inset px-3 text-xs text-muted-foreground transition-linear">
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
              <Chip
                key={l}
                active={active}
                onClick={() => setActiveLabel(active ? null : l)}
              >
                {l}
              </Chip>
            );
          })}
          {activeLabel && (
            <button
              onClick={() => setActiveLabel(null)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-linear hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Views */}
      {isLoading ? (
        <ListSkeleton />
      ) : isEmpty ? (
        <EmptyState
          icon={<ListTodo />}
          title="No tasks yet"
          description="Create one and AI will help shape it."
          action={
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New task
            </Button>
          }
        />
      ) : filtered.length === 0 && hasFilters ? (
        <EmptyState
          icon={<Search />}
          title="Nothing matches your filters"
          description="Try a different search, repo, or label."
        />
      ) : (
        <>
          {/* Auto-pull / workers / queued bar shows on both views. */}
          <QueueStatusBar />
          {effectiveView === "board" ? (
            <TaskBoardView
              tasks={filtered}
              repoName={repoName}
              onDelete={setDeleteTarget}
              onLabelClick={setActiveLabel}
              onOpenTask={openTask}
              showClosed={showClosed}
            />
          ) : (
            <TaskListView
              tasks={filtered}
              repoName={repoName}
              onDelete={setDeleteTarget}
              onLabelClick={setActiveLabel}
              onOpenTask={openTask}
            />
          )}
        </>
      )}

      <TaskSheet
        taskId={selectedTaskId}
        open={!!selectedTaskId}
        onOpenChange={(o) => {
          if (!o) closeTask();
        }}
      />

      <NewTaskDialog open={newOpen} onOpenChange={setNewOpen} repos={repos} />

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

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-md border border-border bg-surface-card px-4 py-3.5"
        >
          <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
          <Skeleton className="h-4 flex-1 max-w-[40%]" />
          <Skeleton className="ml-auto h-4 w-16 shrink-0" />
        </div>
      ))}
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
              <Chip
                key={l}
                onRemove={() => setLabels(labels.filter((x) => x !== l))}
                removeLabel={`Remove ${l}`}
              >
                {l}
              </Chip>
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
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2 text-sm">
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
