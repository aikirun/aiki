ALTER TABLE "state_transition" DROP CONSTRAINT "chk_state_transition_columns_match_type";--> statement-breakpoint
DROP INDEX "idx_state_transition_workflow_run_id";--> statement-breakpoint
ALTER TABLE "state_transition" ADD COLUMN "task_sequence" integer;--> statement-breakpoint
UPDATE "state_transition" SET "task_sequence" = "numbered"."task_sequence"
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "workflow_run_id", "revision" ORDER BY "id") AS "task_sequence"
	FROM "state_transition"
	WHERE "type" = 'task'
) AS "numbered"
WHERE "state_transition"."id" = "numbered"."id";--> statement-breakpoint
CREATE INDEX "idx_state_transition_workflow_run_id" ON "state_transition" USING btree ("workflow_run_id","revision","type","task_sequence","id") WHERE "state_transition"."workflow_run_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "state_transition" ADD CONSTRAINT "chk_state_transition_columns_match_type" CHECK (("state_transition"."type" = 'workflow_run' AND "state_transition"."workflow_run_id" IS NOT NULL AND "state_transition"."attempt" IS NOT NULL AND "state_transition"."task_id" IS NULL AND "state_transition"."schedule_id" IS NULL AND "state_transition"."task_sequence" IS NULL) OR ("state_transition"."type" = 'task' AND "state_transition"."workflow_run_id" IS NOT NULL AND "state_transition"."attempt" IS NOT NULL AND "state_transition"."task_id" IS NOT NULL AND "state_transition"."schedule_id" IS NULL AND "state_transition"."task_sequence" IS NOT NULL AND "state_transition"."task_sequence" >= 0) OR ("state_transition"."type" = 'schedule' AND "state_transition"."schedule_id" IS NOT NULL AND "state_transition"."workflow_run_id" IS NULL AND "state_transition"."attempt" IS NULL AND "state_transition"."task_id" IS NULL AND "state_transition"."task_sequence" IS NULL));