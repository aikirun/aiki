ALTER TABLE "namespace" ADD COLUMN "member_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "namespace_member" ADD COLUMN "membership_key" text;--> statement-breakpoint
ALTER TABLE "namespace_member" ADD CONSTRAINT "uq_namespace_member_membership_key" UNIQUE("membership_key");