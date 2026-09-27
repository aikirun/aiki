ALTER TABLE "schedule" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "schedule"
SET revision = transitions.count - 1
FROM (
	SELECT schedule_id, count(*)::integer AS count
	FROM "state_transition"
	WHERE schedule_id IS NOT NULL
	GROUP BY schedule_id
) AS transitions
WHERE "schedule".id = transitions.schedule_id;
