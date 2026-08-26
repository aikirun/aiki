ALTER TABLE "child_workflow_run_wait" DROP CONSTRAINT "chk_child_workflow_run_wait_completed_invariants";--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait" DROP CONSTRAINT "chk_child_workflow_run_wait_timeout_invariants";--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait" ADD COLUMN "signal_sequence" integer;--> statement-breakpoint

-- Backfill: rows delivered before stamps existed carry stamp 0 — below every worker's
-- cursor, so no delta read ever returns them, and every record load includes them.
-- Timeout rows stay null. Child rows are not ordered by the stamp, so nothing renumbers.
UPDATE "child_workflow_run_wait" SET "signal_sequence" = 0 WHERE "status" = 'completed';--> statement-breakpoint

ALTER TABLE "child_workflow_run_wait" ADD CONSTRAINT "chk_child_workflow_run_wait_completed_invariants" CHECK ("child_workflow_run_wait"."status" != 'completed' OR ("child_workflow_run_wait"."completed_at" IS NOT NULL AND "child_workflow_run_wait"."child_workflow_run_state_transition_id" IS NOT NULL AND "child_workflow_run_wait"."child_workflow_run_status" IS NOT NULL AND "child_workflow_run_wait"."signal_sequence" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait" ADD CONSTRAINT "chk_child_workflow_run_wait_timeout_invariants" CHECK ("child_workflow_run_wait"."status" != 'timeout' OR ("child_workflow_run_wait"."timed_out_at" IS NOT NULL AND "child_workflow_run_wait"."child_workflow_run_status" IS NULL AND "child_workflow_run_wait"."child_workflow_run_state_transition_id" IS NULL AND "child_workflow_run_wait"."signal_sequence" IS NULL));