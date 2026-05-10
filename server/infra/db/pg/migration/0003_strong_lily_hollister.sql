DROP INDEX "idx_schedule_status_next_run_at";--> statement-breakpoint
DROP INDEX "idx_task_status_workflow_run_next_attempt_at";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_scheduled_at";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_awake_at";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_timeout_at";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_next_attempt_at";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_status_created";--> statement-breakpoint
DROP INDEX "idx_workflow_run_outbox_status_updated";--> statement-breakpoint
CREATE INDEX "idx_schedule_status_next_run_at_id" ON "schedule" USING btree ("status","next_run_at","id");--> statement-breakpoint
CREATE INDEX "idx_task_status_next_attempt_at_workflow_run" ON "task" USING btree ("status","next_attempt_at","workflow_run_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_scheduled_at_id" ON "workflow_run" USING btree ("status","scheduled_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_awake_at_id" ON "workflow_run" USING btree ("status","awake_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_timeout_at_id" ON "workflow_run" USING btree ("status","timeout_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_next_attempt_at_id" ON "workflow_run" USING btree ("status","next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_created_id" ON "workflow_run_outbox" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_updated_id" ON "workflow_run_outbox" USING btree ("status","updated_at","id");