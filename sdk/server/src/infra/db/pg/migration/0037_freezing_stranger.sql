ALTER TABLE "schedule" ADD COLUMN "client_hasher_applied" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "client_hasher_applied" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "client_hasher_applied" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "workflow_run" ALTER COLUMN "client_hasher_applied" DROP DEFAULT;
