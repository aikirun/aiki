ALTER TABLE "event_wait" ADD COLUMN "client_codec_applied" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "event_wait" ALTER COLUMN "client_codec_applied" DROP DEFAULT;
