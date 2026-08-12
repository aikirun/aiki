-- Adds workflow_source to the outbox so the claim path matches the full workflow identity
-- (source, name, version) rather than name and version alone, and moves source into the claim
-- index right after namespace_id to mirror uqidx_workflow_namespace_source_name_version.
-- Both source columns lose their default so every insert site has to name the source it means.
-- The backfill reads each row's true source through its run; rows whose run is already gone are
-- undeliverable either way and settle as 'user'.
DROP INDEX "idx_workflow_run_outbox_claim_pending";--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ADD COLUMN "workflow_source" "workflow_source";--> statement-breakpoint
UPDATE "workflow_run_outbox" AS "o" SET "workflow_source" = "w"."source" FROM "workflow_run" AS "r" JOIN "workflow" AS "w" ON "w"."id" = "r"."workflow_id" WHERE "r"."id" = "o"."workflow_run_id";--> statement-breakpoint
UPDATE "workflow_run_outbox" SET "workflow_source" = 'user' WHERE "workflow_source" IS NULL;--> statement-breakpoint
ALTER TABLE "workflow_run_outbox" ALTER COLUMN "workflow_source" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_claim_pending" ON "workflow_run_outbox" USING btree ("namespace_id","workflow_source","workflow_name","workflow_version_id","pool","rank","id") WHERE "workflow_run_outbox"."status" = 'pending';
