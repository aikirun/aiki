ALTER TABLE "child_workflow_run_wait" ALTER COLUMN "child_workflow_run_status" DROP NOT NULL;--> statement-breakpoint
DELETE FROM "child_workflow_run_wait" WHERE "status" = 'completed';--> statement-breakpoint
INSERT INTO "child_workflow_run_wait" ("id", "parent_workflow_run_id", "child_workflow_run_id", "child_workflow_run_status", "status", "completed_at", "child_workflow_run_state_transition_id")
SELECT
	wr."id",
	wr."parent_workflow_run_id",
	wr."id",
	wr."status"::text::"terminal_workflow_run_status",
	'completed',
	st."created_at",
	wr."latest_state_transition_id"
FROM "workflow_run" wr
JOIN "state_transition" st ON st."id" = wr."latest_state_transition_id"
WHERE wr."status" IN ('completed', 'cancelled', 'failed') AND wr."parent_workflow_run_id" IS NOT NULL;