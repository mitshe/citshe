"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUpdateTask } from "@/lib/api/hooks";
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnId | null>(null);

  const columns: Column[] = showClosed ? [...COLUMNS, CLOSED_COLUMN] : COLUMNS;

  const byColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = {
      todo: [],
      in_progress: [],
      review: [],
      closed: [],
    };
    for (const t of tasks) {
      map[columnForTask(t)].push(t);
    }
    for (const key of Object.keys(map) as ColumnId[]) {
      map[key].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    }
    return map;
  }, [tasks]);

  const handleDrop = async (col: Column) => {
    setDropTarget(null);
    const id = draggingId;
    setDraggingId(null);
    if (!id || !col.moveTo) return;
    const task = tasks.find((t) => t.id === id);
    // No-op if already in this column.
    if (task && columnForTask(task) === col.id) return;
    try {
      await updateTask.mutateAsync({ id, data: { status: col.moveTo } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move task");
    }
  };

  return (
    <div
      className={cn(
        "grid gap-4",
        showClosed
          ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      {columns.map((col) => {
        const droppable = !!col.moveTo; // Closed column is not a drop target.
        const isTarget = dropTarget === col.id;
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
                    }
                  }
                : undefined
            }
            onDrop={droppable ? () => handleDrop(col) : undefined}
            className={cn(
              "flex min-h-0 flex-col rounded-lg border bg-surface-card transition-linear",
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
            <div className="flex max-h-[calc(100vh-16rem)] flex-col gap-2 overflow-y-auto p-2">
              {byColumn[col.id].length === 0 ? (
                <p className="px-1 py-3 text-left text-[11px] text-text-subtle">
                  {isTarget ? "Drop here" : "Nothing here"}
                </p>
              ) : (
                byColumn[col.id].map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    repoName={repoName(task.repositoryId)}
                    onDelete={onDelete}
                    onLabelClick={onLabelClick}
                    onOpenTask={onOpenTask}
                    draggable={col.id !== "closed"}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_TASK_ID, task.id);
                      e.dataTransfer.setData("text/plain", task.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(task.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTarget(null);
                    }}
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
