DROP INDEX "idx_workflow_run_outbox_pending";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_published";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_claimed";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ALTER COLUMN "published_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_workflow_rank_id" ON "workflow_run_outbox" USING btree ("namespace_id","status","workflow_name","workflow_version_id","shard","rank","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_workflow_claimed_rank_id" ON "workflow_run_outbox" USING btree ("namespace_id","status","workflow_name","workflow_version_id","shard","claimed_at","rank","id");--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD CONSTRAINT "chk_workflow_run_outbox_published_requires_published_at" CHECK ("workflow_run_outbox"."status" != 'published' OR "workflow_run_outbox"."published_at" IS NOT NULL);