ALTER TABLE "task" ADD COLUMN "client_codec" "client_codec";--> statement-breakpoint
UPDATE "task" SET "client_codec" = 'none';--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "client_codec" SET NOT NULL;
