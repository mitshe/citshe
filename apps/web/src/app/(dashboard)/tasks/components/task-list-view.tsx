"use client";

import { useMemo } from "react";
import type { Task } from "@/lib/api/types";
import { TaskRow, TaskCard } from "./task-shared";

export function TaskListView({
  tasks,
  repoName,
  onDelete,
  onLabelClick,
  onOpenTask,
}: {
  tasks: Task[];
  repoName: (id: string | null | undefined) => string;
  onDelete: (task: Task) => void;
  onLabelClick: (label: string) => void;
  onOpenTask?: (id: string) => void;
}) {
  const sorted = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
      ),
    [tasks],
  );

  return (
    <>
      {/* Mobile: a stack of cards — no horizontal scroll on narrow screens. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {sorted.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            repoName={repoName(task.repositoryId)}
            onDelete={onDelete}
            onLabelClick={onLabelClick}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>

      {/* Desktop: the dense table. */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-surface-card sm:block">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-surface-inset/60 text-[11px] uppercase tracking-wide text-text-subtle">
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Repo</th>
              <th className="px-3 py-2 font-medium">Labels</th>
              <th className="px-3 py-2 font-medium">Updated</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                repoName={repoName(task.repositoryId)}
                onDelete={onDelete}
                onLabelClick={onLabelClick}
                onOpenTask={onOpenTask}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
