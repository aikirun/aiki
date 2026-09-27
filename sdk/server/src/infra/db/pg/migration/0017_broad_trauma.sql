-- Replaces the nullable next_publish_attempt_at timestamp with a NOT NULL next_publish_attempt_rank
-- (same units as rank: dueAtMs * 10 + priority). The flat backfill sets rank for every row;
-- the worst case is one immediate re-offer per in-flight row, absorbed by the revision CAS.
ALTER TABLE "workflow_run_outbox" DROP CONSTRAINT "chk_workflow_run_outbox_published_requires_first_published_at";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_list_pending";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_list_published";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "next_publish_attempt_rank" double precision;--> statement-breakpoint
UPDATE "workflow_run_outbox" SET "next_publish_attempt_rank" = "rank";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ALTER COLUMN "next_publish_attempt_rank" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_list_pending" ON "workflow_run_outbox" USING btree ("next_publish_attempt_rank","id") WHERE "workflow_run_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_list_published" ON "workflow_run_outbox" USING btree ("next_publish_attempt_rank","id") WHERE "workflow_run_outbox"."status" = 'published';--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" DROP COLUMN "next_publish_attempt_at";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD CONSTRAINT "chk_workflow_run_outbox_published_requires_first_published_at" CHECK ("workflow_run_outbox"."status" != 'published' OR "workflow_run_outbox"."first_published_at" IS NOT NULL);