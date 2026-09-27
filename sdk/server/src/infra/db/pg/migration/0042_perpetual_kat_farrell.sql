ALTER TABLE "state_transition" ADD COLUMN "revision" integer;--> statement-breakpoint
UPDATE "state_transition"
SET revision = numbered.revision
FROM (
	SELECT id, (row_number() OVER (PARTITION BY workflow_run_id ORDER BY id) - 1)::integer AS revision
	FROM "state_transition"
	WHERE type = 'workflow_run'
) AS numbered
WHERE "state_transition".id = numbered.id;--> statement-breakpoint
UPDATE "state_transition" AS task_transition
SET revision = COALESCE(
	(
		SELECT run_transition.revision
		FROM "state_transition" AS run_transition
		WHERE run_transition.workflow_run_id = task_transition.workflow_run_id
			AND run_transition.type = 'workflow_run'
			AND run_transition.id < task_transition.id
		ORDER BY run_transition.id DESC
		LIMIT 1
	),
	0
)
WHERE task_transition.type = 'task';--> statement-breakpoint
UPDATE "state_transition"
SET revision = numbered.revision
FROM (
	SELECT id, (row_number() OVER (PARTITION BY schedule_id ORDER BY id) - 1)::integer AS revision
	FROM "state_transition"
	WHERE type = 'schedule'
) AS numbered
WHERE "state_transition".id = numbered.id;--> statement-breakpoint
ALTER TABLE "state_transition" ALTER COLUMN "revision" SET NOT NULL;--> statement-breakpoint
DROP INDEX "idx_state_transition_workflow_run_id";--> statement-breakpoint
DROP INDEX "idx_state_transition_schedule_id";--> statement-breakpoint
CREATE INDEX "idx_state_transition_workflow_run_id" ON "state_transition" USING btree ("workflow_run_id","revision","type","id") WHERE "state_transition"."workflow_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_state_transition_schedule_id" ON "state_transition" USING btree ("schedule_id","revision","id") WHERE "state_transition"."schedule_id" IS NOT NULL;
