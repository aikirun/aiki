-- Backfill: park runs that were waiting on task retries the pre-awaiting_task_retry way.
-- Such a run is `running` with at least one `awaiting_retry` task and no outbox row, and
-- nothing scans tasks anymore, so without this rewrite it would never be requeued.
-- The revision bump fences any worker still holding a stale claim on the run.
-- One-time rewrite: no state-transition rows are recorded for these parks.
UPDATE "workflow_run" wr
SET "status" = 'awaiting_task_retry',
    "next_attempt_at" = due."min_next_attempt_at",
    "revision" = wr."revision" + 1
FROM (
  SELECT "workflow_run_id", min("next_attempt_at") AS "min_next_attempt_at"
  FROM "task"
  WHERE "status" = 'awaiting_retry'
  GROUP BY "workflow_run_id"
) due
WHERE wr."id" = due."workflow_run_id"
  AND wr."status" = 'running'
  AND NOT EXISTS (
    SELECT 1 FROM "workflow_run_outbox" o WHERE o."workflow_run_id" = wr."id"
  );
