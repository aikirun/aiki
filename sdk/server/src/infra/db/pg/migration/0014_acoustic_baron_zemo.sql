ALTER TABLE "workflow_run_outbox" RENAME COLUMN "shard" TO "pool";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_claim_pending";--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_claim_pending" ON "workflow_run_outbox" USING btree ("namespace_id","workflow_name","workflow_version_id","pool","rank","id") WHERE "workflow_run_outbox"."status" = 'pending';--> statement-breakpoint
UPDATE "workflow_run" SET "options" = ("options" - 'shard') || jsonb_build_object('pool', "options" -> 'shard') WHERE "options" ? 'shard';--> statement-breakpoint
UPDATE "schedule" SET "workflow_run_options" = ("workflow_run_options" - 'shard') || jsonb_build_object('pool', "workflow_run_options" -> 'shard') WHERE "workflow_run_options" ? 'shard';