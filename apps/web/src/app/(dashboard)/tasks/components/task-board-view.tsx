"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useUpdateTask,
  useEnqueueTask,
  useReorderQueue,
} from "@/lib/api/hooks";
import type { Task } from "@/lib/api/types";
import { SectionHeader } from "@/components/ui/section-header";
import {
  COLUMNS,
  CLOSED_COLUMN,
  type Column,
  type ColumnId,
  columnForTask,
  DND_TASK_ID,
  TaskCard,
} from "./task-shared";

/** queueOrder used as a stable fallback when a card has none yet. */
function orderOf(task: Task): number {
  return typeof task.queueOrder === "number" ? task.queueOrder : 0;
}

export function TaskBoardView({
  tasks,
  repoName,
  onDelete,
  onLabelClick,
  onOpenTask,
  showClosed,
}: {
  tasks: Task[];
  repoName: (id: string | null | undefined) => string;
  onDelete: (task: Task) => void;
  onLabelClick: (label: string) => void;
  onOpenTask?: (id: string) => void;
  showClosed: boolean;
}) {
  const updateTask = useUpdateTask();
  const enqueueTask = useEnqueueTask();
  const reorderQueue = useReorderQueue();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnId | null>(null);
  // Id of the queue card we're currently hovering above (insert-before target).
  const [queueDropBeforeId, setQueueDropBeforeId] = useState<string | null>(
    null,
  );

  const columns: Column[] = showClosed ? [...COLUMNS, CLOSED_COLUMN] : COLUMNS;

  const byColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = {
      queue: [],
      todo: [],
      in_progress: [],
      review: [],
      closed: [],
    };
    for (const t of tasks) {
      map[columnForTask(t)].push(t);
    }
    // Queue sorts by pull order (ASC); everything else by most-recent.
    map.queue.sort((a, b) => orderOf(a) - orderOf(b));
    for (const key of ["todo", "in_progress", "review", "closed"] as ColumnId[]) {
      map[key].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    }
    return map;
  }, [tasks]);

  const clearDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
    setQueueDropBeforeId(null);
  };

  // Cross-column drop (onto the column body).
  const handleColumnDrop = async (col: Column) => {
    const id = draggingId;
    const beforeId = queueDropBeforeId;
    clearDrag();
    if (!id || !col.moveTo) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const from = columnForTask(task);

    // Dropped inside the Queue column → reorder rather than status change.
    if (col.id === "queue" && from === "queue") {
      await reorderWithin(id, beforeId);
      return;
    }
    // No-op if already in this column (and not a queue reorder).
    if (from === col.id) return;

    try {
      if (col.id === "queue") {
        await enqueueTask.mutateAsync(id);
      } else {
        await updateTask.mutateAsync({ id, data: { status: col.moveTo } });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move task");
    }
  };

  // Compute a fractional queueOrder that inserts `id` before `beforeId`
  // (or at the end when beforeId is null) and persist it.
  const reorderWithin = async (id: string, beforeId: string | null) => {
    const queue = byColumn.queue;
    if (queue.length === 0) return;
    if (beforeId === id) return; // dropped on itself

    const target = beforeId ? queue.findIndex((t) => t.id === beforeId) : -1;

    let newOrder: number;
    if (target === -1) {
      // Append to the end.
      const last = queue[queue.length - 1];
      if (last.id === id) return; // already last
      newOrder = orderOf(last) + 1;
    } else {
      const beforeCard = queue[target];
      const prevCard = target > 0 ? queue[target - 1] : null;
      // Dropping onto its current neighbours is a no-op.
      if (beforeCard.id === id || prevCard?.id === id) return;
      newOrder = prevCard
        ? (orderOf(prevCard) + orderOf(beforeCard)) / 2
        : orderOf(beforeCard) - 1;
    }

    try {
      await reorderQueue.mutateAsync({ taskId: id, queueOrder: newOrder });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reorder");
    }
  };

  return (
    // Mobile: columns stack vertically, one under another (1-wide). Desktop:
    // columns sit side by side and scroll horizontally — never a 2×2 grid.
    <div className="flex flex-col gap-4 lg:flex-row lg:overflow-x-auto lg:pb-2">
      {columns.map((col) => {
        const droppable = !!col.moveTo; // Closed column is not a drop target.
        const isTarget = dropTarget === col.id;
        const isQueue = col.id === "queue";
        return (
          <div
            key={col.id}
            onDragOver={
              droppable
                ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropTarget !== col.id) setDropTarget(col.id);
                  }
                : undefined
            }
            onDragLeave={
              droppable
                ? (e) => {
                    // Only clear when actually leaving the column bounds.
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropTarget((prev) => (prev === col.id ? null : prev));
                      if (isQueue) setQueueDropBeforeId(null);
                    }
                  }
                : undefined
            }
            onDrop={droppable ? () => handleColumnDrop(col) : undefined}
            className={cn(
              "flex min-h-0 w-full shrink-0 flex-col rounded-lg border bg-surface-card transition-linear lg:w-[300px]",
              isTarget
                ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/25"
                : "border-border",
            )}
          >
            <SectionHeader
              label={col.name}
              count={byColumn[col.id].length}
              className="justify-start rounded-t-lg border-b border-border px-3 py-2"
            />
            <div className="flex max-h-[calc(100vh-16rem)] min-h-24 flex-col gap-2 overflow-y-auto p-2">
              {byColumn[col.id].length === 0 ? (
                <p className="px-1 py-3 text-left text-[11px] text-text-subtle">
                  {isTarget
                    ? "Drop here"
                    : isQueue
                      ? "Drop tasks here to queue them"
                      : "Nothing here"}
                </p>
              ) : (
                byColumn[col.id].map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    repoName={repoName(task.repositoryId)}
                    onDelete={onDelete}
                    onLabelClick={onLabelClick}
                    onOpenTask={onOpenTask}
                    draggable={col.id !== "closed"}
                    // Pull-order only means something when several tasks are
                    // queued — a lone "1" is just noise, so hide it then.
                    queueOrderIndex={
                      isQueue && byColumn[col.id].length > 1 ? i + 1 : undefined
                    }
                    dropHint={
                      isQueue &&
                      queueDropBeforeId === task.id &&
                      draggingId &&
                      draggingId !== task.id
                        ? "above"
                        : null
                    }
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_TASK_ID, task.id);
                      e.dataTransfer.setData("text/plain", task.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(task.id);
                    }}
                    onDragEnd={clearDrag}
                    onDragOver={
                      isQueue
                        ? (e) => {
                            // Track which card we'd insert BEFORE so the drop
                            // computes a fractional order. Hovering the top
                            // half → insert before this card; bottom half →
                            // before the next card (null = append at end).
                            e.preventDefault();
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            const above =
                              e.clientY < rect.top + rect.height / 2;
                            const beforeId = above
                              ? task.id
                              : byColumn.queue[i + 1]?.id ?? null;
                            if (queueDropBeforeId !== beforeId) {
                              setQueueDropBeforeId(beforeId);
                            }
                          }
                        : undefined
                    }
                    onDrop={
                      isQueue
                        ? (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleColumnDrop(col);
                          }
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
