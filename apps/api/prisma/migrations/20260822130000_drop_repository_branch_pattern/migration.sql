-- Remove the unused branch pattern setting from repositories
ALTER TABLE "repositories" DROP COLUMN IF EXISTS "branch_pattern";
