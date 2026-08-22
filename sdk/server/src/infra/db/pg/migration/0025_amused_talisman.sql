ALTER TABLE "schedule" ADD COLUMN "client_codec" "client_codec";--> statement-breakpoint
UPDATE "schedule" SET "client_codec" = 'none';--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "client_codec" SET NOT NULL;
