DROP INDEX "idx_workflow_run_schedule";--> statement-breakpoint
CREATE INDEX "idx_workflow_run_schedule_namespace" ON "workflow_run" USING btree ("schedule_id","namespace_id");