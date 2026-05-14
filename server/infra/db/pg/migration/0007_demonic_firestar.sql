ALTER TYPE "public"."workflow_run_outbox_status" ADD VALUE 'claimed';--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_publish";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_claim_stale";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_status_updated_id";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "published_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_pending" ON "workflow_run_outbox" USING btree ("namespace_id","status","workflow_name","workflow_version_id","shard","rank","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_published" ON "workflow_run_outbox" USING btree ("namespace_id","status","workflow_name","workflow_version_id","shard","published_at","rank","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_claimed" ON "workflow_run_outbox" USING btree ("namespace_id","status","workflow_name","workflow_version_id","shard","claimed_at","rank","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_published_id" ON "workflow_run_outbox" USING btree ("status","published_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_claimed_id" ON "workflow_run_outbox" USING btree ("status","claimed_at","id");--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD CONSTRAINT "chk_workflow_run_outbox_claimed_requires_claimed_at" CHECK ("workflow_run_outbox"."status" != 'claimed' OR "workflow_run_outbox"."claimed_at" IS NOT NULL);