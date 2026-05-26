CREATE TYPE "public"."child_workflow_run_wait_status" AS ENUM('completed', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."event_wait_status" AS ENUM('received', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."schedule_conflict_policy" AS ENUM('upsert', 'error');--> statement-breakpoint
CREATE TYPE "public"."schedule_overlap_policy" AS ENUM('allow', 'skip', 'cancel_previous');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('active', 'paused', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('cron', 'interval');--> statement-breakpoint
CREATE TYPE "public"."sleep_status" AS ENUM('sleeping', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."state_transition_type" AS ENUM('workflow_run', 'task');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('running', 'awaiting_retry', 'completed', 'failed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."terminal_workflow_run_status" AS ENUM('cancelled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_conflict_policy" AS ENUM('error', 'return_existing');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_failure_cause" AS ENUM('task', 'child_workflow', 'self');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_outbox_status" AS ENUM('pending', 'published', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_scheduled_reason" AS ENUM('new', 'retry', 'task_retry', 'awake', 'awake_early', 'resume', 'event', 'child_workflow');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_child_workflow', 'cancelled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_source" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TABLE "child_workflow_run_wait_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_workflow_run_id" text NOT NULL,
	"child_workflow_run_id" text NOT NULL,
	"child_workflow_run_status" "terminal_workflow_run_status" NOT NULL,
	"status" "child_workflow_run_wait_status" NOT NULL,
	"completed_at" timestamp with time zone,
	"timed_out_at" timestamp with time zone,
	"child_workflow_run_state_transition_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_wait_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "event_wait_status" NOT NULL,
	"reference_id" text,
	"data" jsonb,
	"timed_out_at" timestamp with time zone,
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
	"workflow_run_input_hash" text NOT NULL,
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
	"awake_at" timestamp with time zone NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"status" "task_status" NOT NULL,
	"attempts" integer NOT NULL,
	"input" jsonb,
	"input_hash" text NOT NULL,
	"options" jsonb,
	"latest_state_transition_id" text NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"source" "workflow_source" DEFAULT 'user' NOT NULL,
	"name" text NOT NULL,
	"version_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"schedule_id" text,
	"parent_workflow_run_id" text,
	"status" "workflow_run_status" NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
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
CREATE TABLE "workflow_run_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"workflow_name" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"shard" text,
	"rank" double precision NOT NULL,
	"status" "workflow_run_outbox_status" NOT NULL,
	"published_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait_queue" ADD CONSTRAINT "fk_child_workflow_run_wait_queue_parent" FOREIGN KEY ("parent_workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait_queue" ADD CONSTRAINT "fk_child_workflow_run_wait_queue_child" FOREIGN KEY ("child_workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_workflow_run_wait_queue" ADD CONSTRAINT "fk_child_workflow_run_wait_queue_state_transition" FOREIGN KEY ("child_workflow_run_state_transition_id") REFERENCES "public"."state_transition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_wait_queue" ADD CONSTRAINT "fk_event_wait_queue_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_workflow_id" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_queue" ADD CONSTRAINT "fk_sleep_queue_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transition" ADD CONSTRAINT "fk_state_transition_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transition" ADD CONSTRAINT "fk_state_transition_task" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "fk_task_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "fk_workflow_run_workflow_id" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "fk_workflow_run_schedule_id" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "fk_workflow_run_parent_workflow_run" FOREIGN KEY ("parent_workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_child_workflow_run_wait_queue_parent_id" ON "child_workflow_run_wait_queue" USING btree ("parent_workflow_run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_event_wait_queue_workflow_run_name_reference" ON "event_wait_queue" USING btree ("workflow_run_id","name","reference_id");--> statement-breakpoint
CREATE INDEX "idx_event_wait_queue_workflow_run_id" ON "event_wait_queue" USING btree ("workflow_run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_schedule_namespace_definition" ON "schedule" USING btree ("namespace_id","definition_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_schedule_namespace_reference" ON "schedule" USING btree ("namespace_id","reference_id");--> statement-breakpoint
CREATE INDEX "idx_schedule_namespace_workflow" ON "schedule" USING btree ("namespace_id","workflow_id");--> statement-breakpoint
CREATE INDEX "idx_schedule_status_next_run_at_id" ON "schedule" USING btree ("status","next_run_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_sleep_queue_one_active_per_run" ON "sleep_queue" USING btree ("workflow_run_id") WHERE "sleep_queue"."status" = 'sleeping';--> statement-breakpoint
CREATE INDEX "idx_sleep_queue_workflow_run_id" ON "sleep_queue" USING btree ("workflow_run_id","id");--> statement-breakpoint
CREATE INDEX "idx_state_transition_workflow_run_id" ON "state_transition" USING btree ("workflow_run_id","id");--> statement-breakpoint
CREATE INDEX "idx_task_workflow_run_id" ON "task" USING btree ("workflow_run_id","id");--> statement-breakpoint
CREATE INDEX "idx_task_workflow_run_status" ON "task" USING btree ("workflow_run_id","status");--> statement-breakpoint
CREATE INDEX "idx_task_status_next_attempt_at_workflow_run" ON "task" USING btree ("status","next_attempt_at","workflow_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_workflow_namespace_source_name_version" ON "workflow" USING btree ("namespace_id","source","name","version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_workflow_run_workflow_reference" ON "workflow_run" USING btree ("workflow_id","reference_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_namespace_id" ON "workflow_run" USING btree ("namespace_id","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_namespace_status_id" ON "workflow_run" USING btree ("namespace_id","status","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_workflow_id" ON "workflow_run" USING btree ("workflow_id","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_workflow_status_id" ON "workflow_run" USING btree ("workflow_id","status","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_schedule" ON "workflow_run" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_parent_workflow_run_status" ON "workflow_run" USING btree ("parent_workflow_run_id","status");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_scheduled_at_id" ON "workflow_run" USING btree ("status","scheduled_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_awake_at_id" ON "workflow_run" USING btree ("status","awake_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_timeout_at_id" ON "workflow_run" USING btree ("status","timeout_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_status_next_attempt_at_id" ON "workflow_run" USING btree ("status","next_attempt_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uqidx_workflow_run_outbox_workflow_run_id" ON "workflow_run_outbox" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_workflow_rank_id" ON "workflow_run_outbox" USING btree ("namespace_id","status","workflow_name","workflow_version_id","shard","rank","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_workflow_claimed_rank_id" ON "workflow_run_outbox" USING btree ("namespace_id","status","workflow_name","workflow_version_id","shard","claimed_at","rank","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_rank_id" ON "workflow_run_outbox" USING btree ("status","rank","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_published_id" ON "workflow_run_outbox" USING btree ("status","published_at","id");--> statement-breakpoint
CREATE INDEX "idx_workflow_run_outbox_status_claimed_id" ON "workflow_run_outbox" USING btree ("status","claimed_at","id");