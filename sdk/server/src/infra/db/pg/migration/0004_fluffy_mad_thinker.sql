ALTER TABLE "schedule" ALTER COLUMN "conflict_policy" SET DATA TYPE text;--> statement-breakpoint
UPDATE "schedule" SET "conflict_policy" = 'error' WHERE "conflict_policy" = 'upsert';--> statement-breakpoint
DROP TYPE "public"."schedule_conflict_policy";--> statement-breakpoint
CREATE TYPE "public"."schedule_conflict_policy" AS ENUM('error', 'return_existing');--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "conflict_policy" SET DATA TYPE "public"."schedule_conflict_policy" USING "conflict_policy"::"public"."schedule_conflict_policy";