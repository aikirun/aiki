ALTER TABLE "sleep_queue" RENAME TO "sleep";--> statement-breakpoint
ALTER TABLE "sleep" RENAME CONSTRAINT "fk_sleep_queue_workflow_run" TO "fk_sleep_workflow_run";--> statement-breakpoint
ALTER TABLE "sleep" RENAME CONSTRAINT "chk_sleep_queue_completed_requires_completed_at" TO "chk_sleep_completed_requires_completed_at";--> statement-breakpoint
ALTER TABLE "sleep" RENAME CONSTRAINT "chk_sleep_queue_cancelled_requires_cancelled_at" TO "chk_sleep_cancelled_requires_cancelled_at";--> statement-breakpoint
ALTER INDEX "uqidx_sleep_queue_one_active_per_run" RENAME TO "uqidx_sleep_one_active_per_run";--> statement-breakpoint
ALTER INDEX "idx_sleep_queue_workflow_run_id" RENAME TO "idx_sleep_workflow_run_id";--> statement-breakpoint
ALTER TABLE "event_wait_queue" RENAME TO "event_wait";--> statement-breakpoint
ALTER TABLE "event_wait" RENAME CONSTRAINT "fk_event_wait_queue_workflow_run" TO "fk_event_wait_workflow_run";--> statement-breakpoint
ALTER TABLE "event_wait" RENAME CONSTRAINT "chk_event_wait_queue_timeout_requires_timed_out_at" TO "chk_event_wait_timeout_requires_timed_out_at";--> statement-breakpoint
ALTER INDEX "uqidx_event_wait_queue_workflow_run_name_reference" RENAME TO "uqidx_event_wait_workflow_run_name_reference";--> statement-breakpoint
ALTER INDEX "idx_event_wait_queue_workflow_run_id" RENAME TO "idx_event_wait_workflow_run_id";--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait_queue" RENAME TO "child_workflow_run_wait";--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait" RENAME CONSTRAINT "fk_child_workflow_run_wait_queue_parent" TO "fk_child_workflow_run_wait_parent";--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait" RENAME CONSTRAINT "fk_child_workflow_run_wait_queue_child" TO "fk_child_workflow_run_wait_child";--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait" RENAME CONSTRAINT "fk_child_workflow_run_wait_queue_state_transition" TO "fk_child_workflow_run_wait_state_transition";--> statement-breakpoint
ALTER INDEX "idx_child_workflow_run_wait_queue_parent_id" RENAME TO "idx_child_workflow_run_wait_parent_id";
