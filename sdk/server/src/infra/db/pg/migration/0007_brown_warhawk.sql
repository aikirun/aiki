ALTER TYPE "public"."workflow_run_status" ADD VALUE 'stalled' BEFORE 'cancelled';--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_status_workflow_rank_id";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_status_workflow_claimed_rank_id";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_status_rank_id";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_status_published_id";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_status_claimed_id";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "next_publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_claim_pending" ON "workflow_run_outbox" USING btree ("namespace_id","workflow_name","workflow_version_id","shard","rank","id") WHERE "workflow_run_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_claim_published" ON "workflow_run_outbox" USING btree ("namespace_id","workflow_name","workflow_version_id","shard","rank","id") WHERE "workflow_run_outbox"."status" = 'published';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_steal_claim" ON "workflow_run_outbox" USING btree ("namespace_id","workflow_name","workflow_version_id","shard","claimed_at","rank","id") WHERE "workflow_run_outbox"."status" = 'claimed';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_list_pending" ON "workflow_run_outbox" USING btree ("rank","id") WHERE "workflow_run_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_list_published" ON "workflow_run_outbox" USING btree ("published_at","id") WHERE "workflow_run_outbox"."status" = 'published';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_list_claimed" ON "workflow_run_outbox" USING btree ("claimed_at","id") WHERE "workflow_run_outbox"."status" = 'claimed';