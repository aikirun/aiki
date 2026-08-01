UPDATE "state_transition"
SET "state" = jsonb_set("state", '{reason}', to_jsonb(
	CASE "state"->>'reason'
		WHEN 'resume' THEN 'resumption'
		WHEN 'recovered' THEN 'recovery'
		WHEN 'awake' THEN 'wakeup'
		WHEN 'awake_early' THEN 'wakeup_early'
	END))
WHERE "type" = 'workflow_run'
	AND "status" IN ('scheduled', 'queued')
	AND "state"->>'reason' IN ('resume', 'recovered', 'awake', 'awake_early');--> statement-breakpoint
UPDATE "state_transition"
SET "state" = ("state" - 'awakeAt') || jsonb_build_object('wakeupAt', "state"->'awakeAt')
WHERE "type" = 'workflow_run'
	AND "status" = 'sleeping'
	AND "state" ? 'awakeAt';
