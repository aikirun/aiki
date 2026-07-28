ALTER TABLE "workflow_run_outbox" DROP CONSTRAINT "chk_workflow_run_outbox_published_requires_published_at";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_list_published";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "first_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "last_published_at" timestamp with time zone;--> statement-breakpoint
UPDATE "workflow_run_outbox" SET "first_published_at" = "published_at", "last_published_at" = "published_at" WHERE "published_at" IS NOT NULL;--> statement-breakpoint
UPDATE "workflow_run_outbox" SET "next_publish_attempt_at" = "published_at" WHERE "status" = 'published' AND "next_publish_attempt_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_list_published" ON "workflow_run_outbox" USING btree ("next_publish_attempt_at","id") WHERE "workflow_run_outbox"."status" = 'published';--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" DROP COLUMN "published_at";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD CONSTRAINT "chk_workflow_run_outbox_published_requires_first_published_at" CHECK ("workflow_run_outbox"."status" != 'published' OR ("workflow_run_outbox"."first_published_at" IS NOT NULL AND "workflow_run_outbox"."next_publish_attempt_at" IS NOT NULL));