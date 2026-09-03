ALTER TABLE "schedule" ADD COLUMN "client_codec_applied" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "client_codec_applied" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "client_codec_applied" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "workflow_run" ALTER COLUMN "client_codec_applied" DROP DEFAULT;
