"use client";

import { useState, useMemo, useEffect, useCallback, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FilterSearch,
  parseFilterQuery,
  type FilterField,
} from "@/components/ui/filter-search";
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
  LayoutGrid,
  List as ListIcon,
  GitPullRequest,
  GitBranch as GitBranchIcon,
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
import type { Task, RefinedTask, DeliveryMode } from "@/lib/api/types";
import { LabelEditor } from "./components/label-editor";
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
  // One query string drives all filtering: free text + `status:` `repo:`
  // `label:` tokens (parsed below). Replaces the old repo dropdown + closed
  // toggle + label chips.
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 250);
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

  const repoName = (id: string | null | undefined) =>
    id ? repos.find((r) => r.id === id)?.name ?? "—" : "—";

  // Union of all labels across tasks, for suggestions + the New task dialog.
  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks as Task[]) {
      for (const l of t.labels ?? []) set.add(l);
    }
    return [...set].sort();
  }, [tasks]);

  // Filter dimensions the search box understands. `status` maps friendly
  // values to the board's columns (open = the 3 working columns; closed = the
  // terminal states); `repo` + `label` are dynamic from live data.
  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        key: "status",
        description: "Filter by column",
        values: [
          { value: "open", hint: "not closed" },
          { value: "queue" },
          { value: "todo" },
          { value: "in-progress" },
          { value: "review" },
          { value: "closed" },
          { value: "all" },
        ],
      },
      {
        key: "repo",
        description: "Filter by repository",
        values: () => repos.map((r) => ({ value: r.name, label: r.name })),
      },
      {
        key: "label",
        description: "Filter by label",
        multiple: true,
        values: () => allLabels.map((l) => ({ value: l })),
      },
    ],
    [repos, allLabels],
  );

  // Shared filtered set — used by BOTH views. Derived entirely from `query`.
  const parsed = useMemo(
    () => parseFilterQuery(debouncedQuery, filterFields),
    [debouncedQuery, filterFields],
  );

  const statusToken =
    parsed.tokens.find((t) => t.key === "status")?.value ?? "open";
  const showClosed = statusToken === "closed" || statusToken === "all";

  const filtered = useMemo(() => {
    let result = tasks as Task[];

    // status: — column/open/closed/all
    if (statusToken !== "all") {
      result = result.filter((t) => {
        const closed = isClosed(t);
        switch (statusToken) {
          case "closed":
            return closed;
          case "open":
            return !closed;
          case "queue":
            return !closed && t.status === "QUEUED";
          case "todo":
            return !closed && t.status === "PENDING";
          case "in-progress":
            return (
              !closed &&
              (t.status === "ANALYZING" || t.status === "IN_PROGRESS")
            );
          case "review":
            return !closed && t.status === "REVIEW";
          default:
            return !closed;
        }
      });
    }

    // repo: — match by name (case-insensitive)
    const repoTokens = parsed.tokens
      .filter((t) => t.key === "repo")
      .map((t) => t.value.toLowerCase());
    if (repoTokens.length) {
      result = result.filter((t) => {
        const name = repos.find((r) => r.id === t.repositoryId)?.name;
        return name ? repoTokens.includes(name.toLowerCase()) : false;
      });
    }

    // label: — every label token must be present (AND).
    const labelTokens = parsed.tokens
      .filter((t) => t.key === "label")
      .map((t) => t.value.toLowerCase());
    if (labelTokens.length) {
      result = result.filter((t) => {
        const labels = (t.labels ?? []).map((l) => l.toLowerCase());
        return labelTokens.every((l) => labels.includes(l));
      });
    }

    // free text — title / description / labels
    if (parsed.text) {
      const q = parsed.text.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          (t.labels ?? []).some((l) => l.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [tasks, parsed, statusToken, repos]);

  const hasFilters = !!query.trim();
  const isEmpty = !isLoading && tasks.length === 0;

  // Board/list still need a plain label-click to add a `label:` token.
  const addLabelToken = useCallback((label: string) => {
    setQuery((q) => {
      const token = `label:${/\s/.test(label) ? `"${label}"` : label}`;
      return q.includes(token) ? q : `${q} ${token}`.trim();
    });
  }, []);

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
          {/* View toggle (segmented control) — Board works on mobile too
              (columns stack vertically there). */}
          <SegmentedControl<ViewMode>
            aria-label="View mode"
            value={view}
            onChange={changeView}
            options={[
              { value: "board", label: "Board", icon: <LayoutGrid /> },
              { value: "list", label: "List", icon: <ListIcon /> },
            ]}
          />
          <Button size="sm" className="ml-auto sm:ml-0" onClick={() => setNewOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New task
          </Button>
        </div>
      </div>

      {/* One search box: free text + status:/repo:/label: tokens. */}
      <FilterSearch
        value={query}
        onChange={setQuery}
        fields={filterFields}
        placeholder="Search tasks…  try status:review or label:research"
      />

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
          title="Nothing matches your search"
          description="Try a different term, or status:/repo:/label: filter."
        />
      ) : (
        <>
          {/* Auto-pull / workers / queued bar shows on both views. */}
          <QueueStatusBar />
          {view === "board" ? (
            <TaskBoardView
              tasks={filtered}
              repoName={repoName}
              onDelete={setDeleteTarget}
              onLabelClick={addLabelToken}
              onOpenTask={openTask}
              showClosed={showClosed}
            />
          ) : (
            <TaskListView
              tasks={filtered}
              repoName={repoName}
              onDelete={setDeleteTarget}
              onLabelClick={addLabelToken}
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

      <NewTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        repos={repos}
        allLabels={allLabels}
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

/** Small uppercase field label used inside the New task dialog. */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
      {children}
    </p>
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
  allLabels,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  repos: { id: string; name: string }[];
  allLabels: string[];
}) {
  const createTask = useCreateTask();
  const refine = useRefineTask();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("PR");
  const [suggestion, setSuggestion] = useState<RefinedTask | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setLabels([]);
    setRepositoryId("");
    setDeliveryMode("PR");
    setSuggestion(null);
  };

  const addLabel = (raw: string) => {
    const clean = raw.trim().toLowerCase().replace(/^#/, "");
    if (clean && !labels.includes(clean) && labels.length < 20) {
      setLabels([...labels, clean]);
    }
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
        deliveryMode,
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

          {/* Labels — pick from existing or create a new one */}
          <div className="space-y-1.5">
            <FieldLabel>Labels</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {labels.map((l) => (
                <Chip
                  key={l}
                  onRemove={() => setLabels(labels.filter((x) => x !== l))}
                  removeLabel={`Remove ${l}`}
                >
                  {l}
                </Chip>
              ))}
              <LabelEditor
                selected={labels}
                suggestions={allLabels}
                onAdd={addLabel}
              />
            </div>
          </div>

          {/* Repo + delivery share a row on desktop so the dialog reads as a
              compact form, not a sparse stack. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {repos.length > 0 && (
              <div className="space-y-1.5">
                <FieldLabel>Repository</FieldLabel>
                <Select
                  value={repositoryId || "none"}
                  onValueChange={(v) => setRepositoryId(v === "none" ? "" : v)}
                >
                  <SelectTrigger className="w-full">
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
              </div>
            )}

            <div className="space-y-1.5">
              <FieldLabel>When the worker finishes</FieldLabel>
              <SegmentedControl<DeliveryMode>
                aria-label="Delivery mode"
                value={deliveryMode}
                onChange={setDeliveryMode}
                className="w-full"
                options={[
                  { value: "PR", label: "Open a PR", icon: <GitPullRequest /> },
                  {
                    value: "DIRECT_PUSH",
                    label: "Push",
                    icon: <GitBranchIcon />,
                  },
                ]}
              />
            </div>
          </div>

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
        {/* Improve-with-AI on the left, the commit action on the right — fills
            the width so the footer doesn't read as a lopsided cluster. */}
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefine}
            disabled={!title.trim() || refine.isPending}
            className="text-muted-foreground hover:text-foreground"
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
