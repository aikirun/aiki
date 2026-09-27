ALTER TABLE "schedule" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "schedule" SET "status" = 'inactive' WHERE "status" = 'deleted';--> statement-breakpoint
DROP TYPE "public"."schedule_status";--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('active', 'paused', 'inactive');--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "status" SET DATA TYPE "public"."schedule_status" USING "status"::"public"."schedule_status";