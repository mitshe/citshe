ALTER TABLE "tasks" DROP COLUMN IF EXISTS "external_source";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "external_issue_id";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "external_issue_url";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "external_data";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "external_status";
DROP INDEX IF EXISTS "tasks_external_issue_id_idx";
