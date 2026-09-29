CREATE TABLE `child_workflow_run_wait` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_workflow_run_id` text NOT NULL,
	`child_workflow_run_id` text NOT NULL,
	`child_workflow_run_status` text,
	`status` text NOT NULL,
	`completed_at` integer,
	`timed_out_at` integer,
	`child_workflow_run_state_transition_id` text,
	`signal_sequence` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`parent_workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_workflow_run_state_transition_id`) REFERENCES `state_transition`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_child_workflow_run_wait_status" CHECK("child_workflow_run_wait"."status" IN ('completed', 'timeout')),
	CONSTRAINT "chk_child_workflow_run_wait_child_workflow_run_status" CHECK("child_workflow_run_wait"."child_workflow_run_status" IS NULL OR "child_workflow_run_wait"."child_workflow_run_status" IN ('cancelled', 'completed', 'failed')),
	CONSTRAINT "chk_child_workflow_run_wait_completed_invariants" CHECK("child_workflow_run_wait"."status" != 'completed' OR ("child_workflow_run_wait"."completed_at" IS NOT NULL AND "child_workflow_run_wait"."child_workflow_run_state_transition_id" IS NOT NULL AND "child_workflow_run_wait"."child_workflow_run_status" IS NOT NULL AND "child_workflow_run_wait"."signal_sequence" IS NOT NULL)),
	CONSTRAINT "chk_child_workflow_run_wait_timeout_invariants" CHECK("child_workflow_run_wait"."status" != 'timeout' OR ("child_workflow_run_wait"."timed_out_at" IS NOT NULL AND "child_workflow_run_wait"."child_workflow_run_status" IS NULL AND "child_workflow_run_wait"."child_workflow_run_state_transition_id" IS NULL AND "child_workflow_run_wait"."signal_sequence" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_child_workflow_run_wait_parent_id` ON `child_workflow_run_wait` (`parent_workflow_run_id`,`id`);--> statement-breakpoint
CREATE TABLE `event_wait` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`reference_id` text,
	`signal_sequence` integer NOT NULL,
	`data` text,
	`client_codec_applied` integer NOT NULL,
	`timed_out_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_event_wait_status" CHECK("event_wait"."status" IN ('received', 'timeout')),
	CONSTRAINT "chk_event_wait_timeout_requires_timed_out_at" CHECK("event_wait"."status" != 'timeout' OR "event_wait"."timed_out_at" IS NOT NULL),
	CONSTRAINT "chk_event_wait_timeout_not_codec_applied" CHECK("event_wait"."status" != 'timeout' OR "event_wait"."client_codec_applied" = false)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_event_wait_workflow_run_name_reference` ON `event_wait` (`workflow_run_id`,`name`,`reference_id`);--> statement-breakpoint
CREATE INDEX `idx_event_wait_workflow_run_signal_sequence_id` ON `event_wait` (`workflow_run_id`,`signal_sequence`,`id`);--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`status` text NOT NULL,
	`client_hasher_applied` integer NOT NULL,
	`client_codec_applied` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`cron_expression` text,
	`cron_timezone` text,
	`interval_ms` integer,
	`overlap_policy` text,
	`workflow_run_input` text,
	`workflow_run_input_hash` text NOT NULL,
	`definition_hash` text NOT NULL,
	`reference_id` text,
	`workflow_run_options` text,
	`last_occurrence` integer,
	`next_run_at` integer NOT NULL,
	`latest_state_transition_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_schedule_status" CHECK("schedule"."status" IN ('active', 'paused', 'inactive')),
	CONSTRAINT "chk_schedule_type" CHECK("schedule"."type" IN ('cron', 'interval')),
	CONSTRAINT "chk_schedule_overlap_policy" CHECK("schedule"."overlap_policy" IS NULL OR "schedule"."overlap_policy" IN ('allow', 'skip', 'cancel_previous')),
	CONSTRAINT "chk_schedule_spec_matches_type" CHECK(("schedule"."type" = 'cron' AND "schedule"."cron_expression" IS NOT NULL AND "schedule"."interval_ms" IS NULL) OR ("schedule"."type" = 'interval' AND "schedule"."interval_ms" > 0 AND "schedule"."cron_expression" IS NULL AND "schedule"."cron_timezone" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_schedule_namespace_definition` ON `schedule` (`namespace_id`,`definition_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_schedule_namespace_reference` ON `schedule` (`namespace_id`,`reference_id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_namespace_workflow` ON `schedule` (`namespace_id`,`workflow_id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_due_active` ON `schedule` (`next_run_at`,`id`) WHERE "schedule"."status" = 'active';--> statement-breakpoint
CREATE TABLE `sleep` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`wakeup_at` integer NOT NULL,
	`completed_at` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sleep_status" CHECK("sleep"."status" IN ('sleeping', 'completed', 'cancelled')),
	CONSTRAINT "chk_sleep_completed_requires_completed_at" CHECK("sleep"."status" != 'completed' OR "sleep"."completed_at" IS NOT NULL),
	CONSTRAINT "chk_sleep_cancelled_requires_cancelled_at" CHECK("sleep"."status" != 'cancelled' OR "sleep"."cancelled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_sleep_one_active_per_run` ON `sleep` (`workflow_run_id`) WHERE "sleep"."status" = 'sleeping';--> statement-breakpoint
CREATE INDEX `idx_sleep_workflow_run_id` ON `sleep` (`workflow_run_id`,`id`);--> statement-breakpoint
CREATE TABLE `state_transition` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text,
	`type` text NOT NULL,
	`task_id` text,
	`schedule_id` text,
	`status` text GENERATED ALWAYS AS (json_extract("state", '$.status')) STORED NOT NULL,
	`attempt` integer,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_state_transition_type" CHECK("state_transition"."type" IN ('workflow_run', 'task', 'schedule')),
	CONSTRAINT "chk_state_transition_columns_match_type" CHECK(("state_transition"."type" = 'workflow_run' AND "state_transition"."workflow_run_id" IS NOT NULL AND "state_transition"."attempt" IS NOT NULL AND "state_transition"."task_id" IS NULL AND "state_transition"."schedule_id" IS NULL) OR ("state_transition"."type" = 'task' AND "state_transition"."workflow_run_id" IS NOT NULL AND "state_transition"."attempt" IS NOT NULL AND "state_transition"."task_id" IS NOT NULL AND "state_transition"."schedule_id" IS NULL) OR ("state_transition"."type" = 'schedule' AND "state_transition"."schedule_id" IS NOT NULL AND "state_transition"."workflow_run_id" IS NULL AND "state_transition"."attempt" IS NULL AND "state_transition"."task_id" IS NULL)),
	CONSTRAINT "chk_state_transition_status_matches_type" CHECK(("state_transition"."type" = 'workflow_run' AND "state_transition"."status" IN ('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_task_retry', 'awaiting_child_workflow', 'stalled', 'cancelled', 'completed', 'failed')) OR ("state_transition"."type" = 'task' AND "state_transition"."status" IN ('running', 'awaiting_retry', 'completed', 'failed', 'discarded')) OR ("state_transition"."type" = 'schedule' AND "state_transition"."status" IN ('active', 'paused', 'inactive')))
);
--> statement-breakpoint
CREATE INDEX `idx_state_transition_workflow_run_id` ON `state_transition` (`workflow_run_id`,`revision`,(CASE "type" WHEN 'workflow_run' THEN 0 WHEN 'task' THEN 1 WHEN 'schedule' THEN 2 END),`id`) WHERE "state_transition"."workflow_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_state_transition_schedule_id` ON `state_transition` (`schedule_id`,`revision`,`id`) WHERE "state_transition"."schedule_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`workflow_run_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`input` text,
	`input_hash` text NOT NULL,
	`options` text,
	`latest_state_transition_id` text NOT NULL,
	`next_attempt_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_task_status" CHECK("task"."status" IN ('running', 'awaiting_retry', 'completed', 'failed', 'discarded'))
);
--> statement-breakpoint
CREATE INDEX `idx_task_workflow_run_id` ON `task` (`workflow_run_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_task_workflow_run_status` ON `task` (`workflow_run_id`,`status`);--> statement-breakpoint
CREATE TABLE `workflow` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`source` text NOT NULL,
	`name` text NOT NULL,
	`version_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "chk_workflow_source" CHECK("workflow"."source" IN ('user', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_workflow_namespace_source_name_version` ON `workflow` (`namespace_id`,`source`,`name`,`version_id`);--> statement-breakpoint
CREATE TABLE `workflow_run` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`schedule_id` text,
	`parent_workflow_run_id` text,
	`status` text NOT NULL,
	`client_hasher_applied` integer NOT NULL,
	`client_codec_applied` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`signal_sequence` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`input` text,
	`input_hash` text NOT NULL,
	`options` text,
	`reference_id` text,
	`latest_state_transition_id` text NOT NULL,
	`scheduled_at` integer,
	`wakeup_at` integer,
	`timeout_at` integer,
	`next_attempt_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_workflow_run_status" CHECK("workflow_run"."status" IN ('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_task_retry', 'awaiting_child_workflow', 'stalled', 'cancelled', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_workflow_run_workflow_reference` ON `workflow_run` (`workflow_id`,`reference_id`) WHERE "workflow_run"."reference_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_workflow_run_namespace_id` ON `workflow_run` (`namespace_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_namespace_status_id` ON `workflow_run` (`namespace_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_workflow_id` ON `workflow_run` (`workflow_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_workflow_status_id` ON `workflow_run` (`workflow_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_schedule_namespace` ON `workflow_run` (`schedule_id`,`namespace_id`) WHERE "workflow_run"."schedule_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_workflow_run_parent_workflow_run_status` ON `workflow_run` (`parent_workflow_run_id`,`status`) WHERE "workflow_run"."parent_workflow_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_workflow_run_due_scheduled` ON `workflow_run` (`scheduled_at`,`id`) WHERE "workflow_run"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_due_sleeping` ON `workflow_run` (`wakeup_at`,`id`) WHERE "workflow_run"."status" = 'sleeping';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_due_awaiting_event` ON `workflow_run` (`timeout_at`,`id`) WHERE "workflow_run"."status" = 'awaiting_event';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_due_awaiting_child_workflow` ON `workflow_run` (`timeout_at`,`id`) WHERE "workflow_run"."status" = 'awaiting_child_workflow';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_due_awaiting_retry` ON `workflow_run` (`next_attempt_at`,`id`) WHERE "workflow_run"."status" = 'awaiting_retry';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_due_awaiting_task_retry` ON `workflow_run` (`next_attempt_at`,`id`) WHERE "workflow_run"."status" = 'awaiting_task_retry';--> statement-breakpoint
CREATE TABLE `workflow_run_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`workflow_run_id` text NOT NULL,
	`workflow_source` text NOT NULL,
	`workflow_name` text NOT NULL,
	`workflow_version_id` text NOT NULL,
	`pool` text,
	`rank` real NOT NULL,
	`status` text NOT NULL,
	`claimed_at` integer,
	`first_published_at` integer,
	`last_published_at` integer,
	`next_publish_attempt_rank` real NOT NULL,
	`dispatch_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "chk_workflow_run_outbox_workflow_source" CHECK("workflow_run_outbox"."workflow_source" IN ('user', 'system')),
	CONSTRAINT "chk_workflow_run_outbox_status" CHECK("workflow_run_outbox"."status" IN ('pending', 'published', 'claimed')),
	CONSTRAINT "chk_workflow_run_outbox_published_requires_first_published_at" CHECK("workflow_run_outbox"."status" != 'published' OR "workflow_run_outbox"."first_published_at" IS NOT NULL),
	CONSTRAINT "chk_workflow_run_outbox_claimed_requires_claimed_at" CHECK("workflow_run_outbox"."status" != 'claimed' OR "workflow_run_outbox"."claimed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_workflow_run_outbox_workflow_run_id` ON `workflow_run_outbox` (`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_claim_pending` ON `workflow_run_outbox` (`namespace_id`,`workflow_source`,`workflow_name`,`workflow_version_id`,`pool`,`rank`,`id`) WHERE "workflow_run_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_list_pending` ON `workflow_run_outbox` (`next_publish_attempt_rank`,`id`) WHERE "workflow_run_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_list_published` ON `workflow_run_outbox` (`next_publish_attempt_rank`,`id`) WHERE "workflow_run_outbox"."status" = 'published';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_list_claimed` ON `workflow_run_outbox` (`claimed_at`,`id`) WHERE "workflow_run_outbox"."status" = 'claimed';--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_stall_undeliverable` ON `workflow_run_outbox` (`id`) WHERE "workflow_run_outbox"."status" IN ('pending', 'published');
