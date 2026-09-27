DROP INDEX "idx_schedule_status_next_run_at_id";--> statement-breakpoint
DROP INDEX "idx_task_status_next_attempt_at_workflow_run";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_scheduled_at_id";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_wakeup_at_id";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_timeout_at_id";--> statement-breakpoint
DROP INDEX "idx_workflow_run_status_next_attempt_at_id";--> statement-breakpoint
DROP INDEX "uqidx_workflow_run_workflow_reference";--> statement-breakpoint
DROP INDEX "idx_workflow_run_schedule_namespace";--> statement-breakpoint
DROP INDEX "idx_workflow_run_parent_workflow_run_status";--> statement-breakpoint
CREATE INDEX "idx_schedule_due_active" ON "schedule" USING btree ("next_run_at","id") WHERE "schedule"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_task_due_awaiting_retry" ON "task" USING btree ("next_attempt_at","workflow_run_id") WHERE "task"."status" = 'awaiting_retry';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_due_scheduled" ON "workflow_run" USING btree ("scheduled_at","id") WHERE "workflow_run"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_due_sleeping" ON "workflow_run" USING btree ("wakeup_at","id") WHERE "workflow_run"."status" = 'sleeping';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_due_awaiting_event" ON "workflow_run" USING btree ("timeout_at","id") WHERE "workflow_run"."status" = 'awaiting_event';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_due_awaiting_child_workflow" ON "workflow_run" USING btree ("timeout_at","id") WHERE "workflow_run"."status" = 'awaiting_child_workflow';--> statement-breakpoint
CREATE INDEX "idx_workflow_run_due_awaiting_retry" ON "workflow_run" USING btree ("next_attempt_at","id") WHERE "workflow_run"."status" = 'awaiting_retry';--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_workflow_run_workflow_reference" ON "workflow_run" USING btree ("workflow_id","reference_id") WHERE "workflow_run"."reference_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_schedule_namespace" ON "workflow_run" USING btree ("schedule_id","namespace_id") WHERE "workflow_run"."schedule_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_parent_workflow_run_status" ON "workflow_run" USING btree ("parent_workflow_run_id","status") WHERE "workflow_run"."parent_workflow_run_id" IS NOT NULL;