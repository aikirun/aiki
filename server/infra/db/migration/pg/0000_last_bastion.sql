CREATE TYPE "public"."event_wait_status" AS ENUM('received', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."schedule_conflict_policy" AS ENUM('upsert', 'error');--> statement-breakpoint
CREATE TYPE "public"."schedule_overlap_policy" AS ENUM('allow', 'skip', 'cancel_previous');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('active', 'paused', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('cron', 'interval');--> statement-breakpoint
CREATE TYPE "public"."sleep_status" AS ENUM('sleeping', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."state_transition_type" AS ENUM('workflow_run', 'task');--> statement-breakpoint
CREATE TYPE "public"."task_conflict_policy" AS ENUM('error', 'return_existing');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('running', 'awaiting_retry', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."terminal_workflow_run_status" AS ENUM('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_child_workflow', 'cancelled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_conflict_policy" AS ENUM('error', 'return_existing');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_failure_cause" AS ENUM('task', 'child_workflow', 'self');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_scheduled_reason" AS ENUM('new', 'retry', 'task_retry', 'awake', 'awake_early', 'resume', 'event', 'child_workflow');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_child_workflow', 'cancelled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."api_key_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."namespace_role" AS ENUM('admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."namespace_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."organization_invitation_status" AS ENUM('pending', 'accepted', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('personal', 'team');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "event_wait_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "event_wait_status" NOT NULL,
	"reference_id" text,
	"data" jsonb,
	"timeout_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"status" "schedule_status" NOT NULL,
	"type" "schedule_type" NOT NULL,
	"cron_expression" text,
	"interval_ms" integer,
	"overlap_policy" "schedule_overlap_policy",
	"workflow_run_input" jsonb,
	"definition_hash" text NOT NULL,
	"reference_id" text,
	"conflict_policy" "schedule_conflict_policy",
	"last_occurrence" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sleep_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "sleep_status" NOT NULL,
	"awake_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_transition" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"type" "state_transition_type" NOT NULL,
	"task_id" text,
	"status" text NOT NULL,
	"attempt" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_task_state_transition_requires_task_id" CHECK (("state_transition"."type" = 'task' AND "state_transition"."task_id" IS NOT NULL) OR ("state_transition"."type" = 'workflow_run' AND "state_transition"."task_id" IS NULL)),
	CONSTRAINT "chk_state_transition_status_matches_type" CHECK (("state_transition"."type" = 'workflow_run' AND "state_transition"."status" = ANY(enum_range(NULL::workflow_run_status)::text[])) OR ("state_transition"."type" = 'task' AND "state_transition"."status" = ANY(enum_range(NULL::task_status)::text[])))
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workflow_run_id" text,
	"status" "task_status" NOT NULL,
	"attempts" integer NOT NULL,
	"input" jsonb,
	"input_hash" text NOT NULL,
	"options" jsonb,
	"reference_id" text,
	"conflict_policy" "task_conflict_policy",
	"latest_state_transition_id" text NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"schedule_id" text,
	"parent_workflow_run_id" text,
	"status" "workflow_run_status" NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"attempts" integer NOT NULL,
	"input" jsonb,
	"input_hash" text NOT NULL,
	"options" jsonb,
	"reference_id" text,
	"conflict_policy" "workflow_run_conflict_policy",
	"latest_state_transition_id" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"awake_at" timestamp with time zone,
	"timeout_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"status" "api_key_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_api_key_key_hash" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "namespace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"status" "namespace_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "namespace_member" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "namespace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" jsonb,
	"type" "organization_type" NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_organization_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organization_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"inviter_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" "organization_role" NOT NULL,
	"status" "organization_invitation_status" NOT NULL,
	"namespace_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_member" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" "organization_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" text,
	"active_namespace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_token" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_email" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_wait_queue" ADD CONSTRAINT "fk_event_wait_queue_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_namespace_id" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_workflow_id" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_queue" ADD CONSTRAINT "fk_sleep_queue_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transition" ADD CONSTRAINT "fk_state_transition_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transition" ADD CONSTRAINT "fk_state_transition_task" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "fk_task_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "fk_workflow_namespace_id" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "fk_workflow_run_workflow_id" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "fk_workflow_run_schedule_id" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "fk_workflow_run_parent_workflow_run" FOREIGN KEY ("parent_workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "fk_account_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "fk_api_key_namespace_id" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "fk_api_key_organization_id" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "fk_api_key_created_by_user_id" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace" ADD CONSTRAINT "fk_namespace_org_id" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_member" ADD CONSTRAINT "fk_namespace_member_namespace_id" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_member" ADD CONSTRAINT "fk_namespace_member_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD CONSTRAINT "fk_org_invitation_inviter_id" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitation" ADD CONSTRAINT "fk_org_invitation_organization_id" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "fk_org_member_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "fk_org_member_org_id" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "fk_session_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_event_wait_queue_workflow_run_name_reference" ON "event_wait_queue" USING btree ("workflow_run_id","name","reference_id");--> statement-breakpoint
CREATE INDEX "idx_event_wait_queue_workflow_run_name_id" ON "event_wait_queue" USING btree ("workflow_run_id","name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_schedule_namespace_definition" ON "schedule" USING btree ("namespace_id","definition_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_schedule_namespace_reference" ON "schedule" USING btree ("namespace_id","reference_id");--> statement-breakpoint
CREATE INDEX "idx_schedule_namespace_workflow" ON "schedule" USING btree ("namespace_id","workflow_id");--> statement-breakpoint
CREATE INDEX "idx_schedule_status_next_run_at" ON "schedule" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "idx_sleep_queue_workflow_run_name_id" ON "sleep_queue" USING btree ("workflow_run_id","name","id");--> statement-breakpoint
CREATE INDEX "idx_state_transition_workflow_run_id" ON "state_transition" USING btree ("workflow_run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_task_workflow_run_reference" ON "task" USING btree ("workflow_run_id","reference_id");--> statement-breakpoint
CREATE INDEX "idx_task_status_next_attempt_at" ON "task" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_workflow_namespace_name_version" ON "workflow" USING btree ("namespace_id","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_workflow_run_workflow_reference" ON "workflow_run" USING btree ("workflow_id","reference_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_schedule" ON "workflow_run" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_parent_workflow_run" ON "workflow_run" USING btree ("parent_workflow_run_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_scheduled_at" ON "workflow_run" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_awake_at" ON "workflow_run" USING btree ("status","awake_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_timeout_at" ON "workflow_run" USING btree ("status","timeout_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_next_attempt_at" ON "workflow_run" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_account_user_provider" ON "account" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_api_key_org_namespace_created_by_user_name" ON "api_key" USING btree ("organization_id","namespace_id","created_by_user_id","name");--> statement-breakpoint
CREATE INDEX "idx_api_key_org_namespace_name" ON "api_key" USING btree ("organization_id","namespace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_namespace_org_name" ON "namespace" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_namespace_member_namespace_user" ON "namespace_member" USING btree ("namespace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_namespace_member_user_id" ON "namespace_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_org_invitation_pending_email_org_namespace" ON "organization_invitation" USING btree ("email","organization_id","namespace_id") WHERE "organization_invitation"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_org_member_org_user" ON "organization_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_org_member_user_id" ON "organization_member" USING btree ("user_id");