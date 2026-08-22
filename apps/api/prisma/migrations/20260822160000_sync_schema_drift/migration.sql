-- AlterEnum
BEGIN;
CREATE TYPE "AIProvider_new" AS ENUM ('CLAUDE', 'CLAUDE_CODE_LOCAL', 'OPENROUTER');
ALTER TABLE "ai_credentials" ALTER COLUMN "provider" TYPE "AIProvider_new" USING ("provider"::text::"AIProvider_new");
ALTER TYPE "AIProvider" RENAME TO "AIProvider_old";
ALTER TYPE "AIProvider_new" RENAME TO "AIProvider";
DROP TYPE "public"."AIProvider_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "GitProvider_new" AS ENUM ('GITHUB');
ALTER TABLE "repositories" ALTER COLUMN "provider" TYPE "GitProvider_new" USING ("provider"::text::"GitProvider_new");
ALTER TYPE "GitProvider" RENAME TO "GitProvider_old";
ALTER TYPE "GitProvider_new" RENAME TO "GitProvider";
DROP TYPE "public"."GitProvider_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "IntegrationType_new" AS ENUM ('GITHUB');
ALTER TABLE "integrations" ALTER COLUMN "type" TYPE "IntegrationType_new" USING ("type"::text::"IntegrationType_new");
ALTER TYPE "IntegrationType" RENAME TO "IntegrationType_old";
ALTER TYPE "IntegrationType_new" RENAME TO "IntegrationType";
DROP TYPE "public"."IntegrationType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'QUEUED';

-- DropForeignKey
ALTER TABLE "agent_definitions" DROP CONSTRAINT "agent_definitions_default_project_id_fkey";

-- DropForeignKey
ALTER TABLE "agent_sessions" DROP CONSTRAINT "agent_sessions_base_image_id_fkey";

-- DropForeignKey
ALTER TABLE "agent_sessions" DROP CONSTRAINT "agent_sessions_project_id_fkey";

-- DropForeignKey
ALTER TABLE "base_images" DROP CONSTRAINT "base_images_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "base_images" DROP CONSTRAINT "base_images_parent_image_id_fkey";

-- DropForeignKey
ALTER TABLE "base_images" DROP CONSTRAINT "base_images_source_session_id_fkey";

-- DropForeignKey
ALTER TABLE "node_executions" DROP CONSTRAINT "node_executions_execution_id_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_repository_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_project_id_fkey";

-- DropForeignKey
ALTER TABLE "workflow_executions" DROP CONSTRAINT "workflow_executions_workflow_id_fkey";

-- DropForeignKey
ALTER TABLE "workflows" DROP CONSTRAINT "workflows_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "workflows" DROP CONSTRAINT "workflows_project_id_fkey";

-- DropIndex
DROP INDEX "tasks_project_id_idx";

-- AlterTable
ALTER TABLE "agent_definitions" DROP COLUMN "default_project_id";

-- AlterTable
ALTER TABLE "agent_sessions" DROP COLUMN "base_image_id",
DROP COLUMN "project_id",
ADD COLUMN     "branch" TEXT;

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "gitlab_webhook_secret",
DROP COLUMN "gitlab_webhook_secret_iv",
DROP COLUMN "jira_webhook_secret",
DROP COLUMN "jira_webhook_secret_iv",
DROP COLUMN "trello_webhook_secret",
DROP COLUMN "trello_webhook_secret_iv",
ADD COLUMN     "queue_paused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "analysis_status" TEXT,
ADD COLUMN     "analyzed_at" TIMESTAMP(3),
ADD COLUMN     "ci_summary" JSONB,
ADD COLUMN     "stack" JSONB,
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "project_id",
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "repository_id" TEXT,
ADD COLUMN     "session_id" TEXT;

-- DropTable
DROP TABLE "base_images";

-- DropTable
DROP TABLE "node_executions";

-- DropTable
DROP TABLE "projects";

-- DropTable
DROP TABLE "workflow_executions";

-- DropTable
DROP TABLE "workflows";

-- DropEnum
DROP TYPE "SnapshotStatus";

-- CreateIndex
CREATE INDEX "tasks_repository_id_idx" ON "tasks"("repository_id");

-- CreateIndex
CREATE INDEX "tasks_session_id_idx" ON "tasks"("session_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

