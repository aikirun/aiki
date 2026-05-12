DROP INDEX "idx_workflow_run_outbox_status_created_id";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_publish";--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "rank" double precision NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_rank_id" ON "workflow_run_outbox" USING btree ("status","rank","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_publish" ON "workflow_run_outbox" USING btree ("namespace_id","status","rank","workflow_name","workflow_version_id","shard");