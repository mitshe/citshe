-- Task queue ordering + per-portal auto-pull.
-- Task.queueOrder: gap-based ordering within the Queue column (lower = pulled first).
ALTER TABLE "tasks" ADD COLUMN "queue_order" DOUBLE PRECISION;
CREATE INDEX "tasks_queue_order_idx" ON "tasks"("queue_order");

-- Organization.autoPull: when true, QUEUED tasks are actively pulled by workers.
ALTER TABLE "organizations" ADD COLUMN "auto_pull" BOOLEAN NOT NULL DEFAULT false;
