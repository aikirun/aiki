ALTER TABLE "schedule" DROP COLUMN "conflict_policy";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "conflict_policy";--> statement-breakpoint
DROP TYPE "public"."schedule_conflict_policy";--> statement-breakpoint
DROP TYPE "public"."workflow_run_conflict_policy";--> statement-breakpoint
UPDATE "workflow_run" SET "options" = "options" - 'reference' - 'trigger' WHERE "options" IS NOT NULL AND ("options" ? 'reference' OR "options" ? 'trigger');--> statement-breakpoint
UPDATE "workflow_run" SET "options" = NULL WHERE "options" = '{}'::jsonb;
