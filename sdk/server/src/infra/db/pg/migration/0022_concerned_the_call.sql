-- The free-form field on the cancelled run state moved from `reason` to `explanation`,
-- leaving `reason` to mean only the closed scheduled/queued transition vocabulary.
-- Runs cancelled before the rename still carry the old key, so move it across in place.
UPDATE "state_transition"
SET "state" = ("state" - 'reason') || jsonb_build_object('explanation', "state" -> 'reason')
WHERE "type" = 'workflow_run'
	AND "status" = 'cancelled'
	AND jsonb_exists("state", 'reason');
