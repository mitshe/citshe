-- Add closed_at to tasks (open/closed board model). Column already applied in dev via db push.
ALTER TABLE "tasks" ADD COLUMN "closed_at" TIMESTAMP(3);
