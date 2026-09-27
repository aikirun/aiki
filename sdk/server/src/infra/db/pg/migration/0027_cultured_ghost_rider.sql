DROP INDEX "idx_event_wait_workflow_run_id";--> statement-breakpoint
ALTER TABLE "event_wait" ADD COLUMN "signal_sequence" integer;--> statement-breakpoint

-- Backfill: number each run's existing rows in id order — the only order recorded so
-- far — so in-flight runs replay their waits in the order they always have.
UPDATE "event_wait"
   SET "signal_sequence" = "numbered"."rn"
  FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "workflow_run_id" ORDER BY "id") AS "rn"
      FROM "event_wait"
  ) AS "numbered"
 WHERE "event_wait"."id" = "numbered"."id";--> statement-breakpoint

-- Raise each run's sequence to at least its row count, so the next delivery stamps
-- above every backfilled row. Never lowered: child terminal deliveries also bump this
-- counter, and lowering it could make a stale park's expected sequence match again.
UPDATE "workflow_run"
   SET "signal_sequence" = GREATEST("workflow_run"."signal_sequence", "counts"."n")
  FROM (
    SELECT "workflow_run_id", COUNT(*)::integer AS "n"
      FROM "event_wait"
     GROUP BY "workflow_run_id"
  ) AS "counts"
 WHERE "workflow_run"."id" = "counts"."workflow_run_id";--> statement-breakpoint

ALTER TABLE "event_wait" ALTER COLUMN "signal_sequence" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_event_wait_workflow_run_signal_sequence_id" ON "event_wait" USING btree ("workflow_run_id","signal_sequence","id");
