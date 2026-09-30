ALTER TABLE "workflow" ADD COLUMN "name_lowercase" text;--> statement-breakpoint
UPDATE "workflow" SET "name_lowercase" = lower("name");--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "name_lowercase" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_workflow_namespace_source_name_lowercase" ON "workflow" USING btree ("namespace_id","source","name_lowercase" COLLATE "C","name");
