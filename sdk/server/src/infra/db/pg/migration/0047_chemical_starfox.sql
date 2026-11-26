ALTER TABLE "schedule" ADD COLUMN "definition_input_codec_applied" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "definition_input_codec_applied" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "definition_input_codec_applied" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "workflow_run" ALTER COLUMN "definition_input_codec_applied" DROP DEFAULT;
