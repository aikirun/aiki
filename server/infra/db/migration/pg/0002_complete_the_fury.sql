CREATE TYPE "public"."workflow_source" AS ENUM('user', 'system');--> statement-breakpoint
DROP INDEX "uqidx_workflow_namespace_name_version";--> statement-breakpoint
DROP INDEX "idx_workflow_run_parent_workflow_run";--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "source" "workflow_source" DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_workflow_namespace_source_name_version" ON "workflow" USING btree ("namespace_id","source","name","version_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_parent_workflow_run_status" ON "workflow_run" USING btree ("parent_workflow_run_id","status");