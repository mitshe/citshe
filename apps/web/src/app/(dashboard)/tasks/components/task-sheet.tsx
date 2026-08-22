"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/sheet";
import { TaskDetail } from "./task-detail";

/**
 * Jira/GitLab-style slide-over. Renders <TaskDetail variant="panel"/> in a
 * right-side sheet — full-width on mobile, 640px on desktop. Deleting the task
 * or clicking the deep-link closes the sheet.
 */
export function TaskSheet({
  taskId,
  open,
  onOpenChange,
}: {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[640px] sm:max-w-[640px]"
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="text-sm text-muted-foreground">
            Task
          </SheetTitle>
        </SheetHeader>
        <SheetBody className="pb-10">
          {taskId && (
            <TaskDetail
              taskId={taskId}
              variant="panel"
              onDeleted={() => onOpenChange(false)}
              fullPageHref={`/tasks/${taskId}`}
            />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
