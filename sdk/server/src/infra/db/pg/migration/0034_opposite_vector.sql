CREATE TYPE "public"."client_codec" AS ENUM('applied', 'none');--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "client_codec" "client_codec";--> statement-breakpoint
UPDATE "schedule" SET "client_codec" = 'none';--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "client_codec" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "client_codec" "client_codec";--> statement-breakpoint
UPDATE "task" SET "client_codec" = 'none';--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "client_codec" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "client_codec" "client_codec";--> statement-breakpoint
UPDATE "workflow_run" SET "client_codec" = 'none';--> statement-breakpoint
ALTER TABLE "workflow_run" ALTER COLUMN "client_codec" SET NOT NULL;
