ALTER TABLE "sleep_queue" RENAME COLUMN "awake_at" TO "wakeup_at";--> statement-breakpoint
ALTER TABLE "workflow_run" RENAME COLUMN "awake_at" TO "wakeup_at";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_awake_at_id";--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_wakeup_at_id" ON "workflow_run" USING btree ("status","wakeup_at","id");