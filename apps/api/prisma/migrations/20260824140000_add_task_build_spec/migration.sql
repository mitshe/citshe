-- Build-from-scratch / refresh spec for tasks created by the "New project" wizard.
ALTER TABLE "tasks" ADD COLUMN "build_spec" JSONB;
