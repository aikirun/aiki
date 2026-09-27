ALTER TABLE "state_transition" DROP CONSTRAINT "chk_task_state_transition_requires_task_id";--> statement-breakpoint
ALTER TABLE "state_transition" DROP CONSTRAINT "chk_state_transition_status_matches_type";--> statement-breakpoint
DROP INDEX "idx_state_transition_workflow_run_id";--> statement-breakpoint
ALTER TABLE "state_transition" ALTER COLUMN "workflow_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "state_transition" drop column "status";--> statement-breakpoint
ALTER TABLE "state_transition" ADD COLUMN "status" text GENERATED ALWAYS AS ("state_transition"."state"->>'status') STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "state_transition" ALTER COLUMN "attempt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "latest_state_transition_id" text;--> statement-breakpoint
ALTER TABLE "state_transition" ADD COLUMN "schedule_id" text;--> statement-breakpoint
ALTER TABLE "state_transition" ADD CONSTRAINT "fk_state_transition_schedule" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_state_transition_schedule_id" ON "state_transition" USING btree ("schedule_id","id") WHERE "state_transition"."schedule_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_state_transition_workflow_run_id" ON "state_transition" USING btree ("workflow_run_id","id") WHERE "state_transition"."workflow_run_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "state_transition" ADD CONSTRAINT "chk_state_transition_columns_match_type" CHECK (("state_transition"."type" = 'workflow_run' AND "state_transition"."workflow_run_id" IS NOT NULL AND "state_transition"."attempt" IS NOT NULL AND "state_transition"."task_id" IS NULL AND "state_transition"."schedule_id" IS NULL) OR ("state_transition"."type" = 'task' AND "state_transition"."workflow_run_id" IS NOT NULL AND "state_transition"."attempt" IS NOT NULL AND "state_transition"."task_id" IS NOT NULL AND "state_transition"."schedule_id" IS NULL) OR ("state_transition"."type" = 'schedule' AND "state_transition"."schedule_id" IS NOT NULL AND "state_transition"."workflow_run_id" IS NULL AND "state_transition"."attempt" IS NULL AND "state_transition"."task_id" IS NULL));--> statement-breakpoint
ALTER TABLE "state_transition" ADD CONSTRAINT "chk_state_transition_status_matches_type" CHECK (("state_transition"."type" = 'workflow_run' AND "state_transition"."status" = ANY(enum_range(NULL::workflow_run_status)::text[])) OR ("state_transition"."type" = 'task' AND "state_transition"."status" = ANY(enum_range(NULL::task_status)::text[])) OR ("state_transition"."type" = 'schedule' AND "state_transition"."status" = ANY(enum_range(NULL::schedule_status)::text[])));--> statement-breakpoint
CREATE FUNCTION pg_temp.ulid_at(ts timestamptz) RETURNS text AS $$
DECLARE
	alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
	ms bigint := floor(extract(epoch from ts) * 1000)::bigint;
	result text := '';
	i int;
BEGIN
	FOR i IN REVERSE 9..0 LOOP
		result := result || substr(alphabet, ((ms >> (5 * i)) & 31)::int + 1, 1);
	END LOOP;
	FOR i IN 1..16 LOOP
		result := result || substr(alphabet, floor(random() * 32)::int + 1, 1);
	END LOOP;
	RETURN result;
END $$ LANGUAGE plpgsql VOLATILE;--> statement-breakpoint
WITH minted AS (
	SELECT id AS schedule_id, status, updated_at, pg_temp.ulid_at(updated_at) AS transition_id
	FROM "schedule"
	WHERE latest_state_transition_id IS NULL
), inserted AS (
	INSERT INTO "state_transition" (id, type, schedule_id, state, created_at)
	SELECT
		transition_id,
		'schedule',
		schedule_id,
		CASE status
			WHEN 'active' THEN jsonb_build_object('status', 'active', 'reason', 'activated')
			ELSE jsonb_build_object('status', status::text)
		END,
		updated_at
	FROM minted
	RETURNING id
)
UPDATE "schedule" SET latest_state_transition_id = minted.transition_id FROM minted WHERE "schedule".id = minted.schedule_id;--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "latest_state_transition_id" SET NOT NULL;
