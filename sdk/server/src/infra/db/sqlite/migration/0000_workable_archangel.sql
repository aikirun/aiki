CREATE TABLE `child_workflow_run_wait_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_workflow_run_id` text NOT NULL,
	`child_workflow_run_id` text NOT NULL,
	`child_workflow_run_status` text NOT NULL,
	`status` text NOT NULL,
	`completed_at` text,
	`timed_out_at` text,
	`child_workflow_run_state_transition_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`parent_workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_workflow_run_state_transition_id`) REFERENCES `state_transition`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_child_workflow_run_wait_completed_invariants" CHECK("child_workflow_run_wait_queue"."status" != 'completed' OR ("child_workflow_run_wait_queue"."completed_at" IS NOT NULL AND "child_workflow_run_wait_queue"."child_workflow_run_state_transition_id" IS NOT NULL)),
	CONSTRAINT "chk_child_workflow_run_wait_timeout_requires_timed_out_at" CHECK("child_workflow_run_wait_queue"."status" != 'timeout' OR "child_workflow_run_wait_queue"."timed_out_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_child_workflow_run_wait_queue_parent_id` ON `child_workflow_run_wait_queue` (`parent_workflow_run_id`,`id`);--> statement-breakpoint
CREATE TABLE `event_wait_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`reference_id` text,
	`data` text,
	`timed_out_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_event_wait_queue_timeout_requires_timed_out_at" CHECK("event_wait_queue"."status" != 'timeout' OR "event_wait_queue"."timed_out_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_event_wait_queue_workflow_run_name_reference` ON `event_wait_queue` (`workflow_run_id`,`name`,`reference_id`);--> statement-breakpoint
CREATE INDEX `idx_event_wait_queue_workflow_run_id` ON `event_wait_queue` (`workflow_run_id`,`id`);--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`status` text NOT NULL,
	`type` text NOT NULL,
	`cron_expression` text,
	`interval_ms` integer,
	`overlap_policy` text,
	`workflow_run_input` text,
	`workflow_run_input_hash` text NOT NULL,
	`definition_hash` text NOT NULL,
	`reference_id` text,
	`conflict_policy` text,
	`last_occurrence` text,
	`next_run_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_schedule_namespace_definition` ON `schedule` (`namespace_id`,`definition_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_schedule_namespace_reference` ON `schedule` (`namespace_id`,`reference_id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_namespace_workflow` ON `schedule` (`namespace_id`,`workflow_id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_status_next_run_at_id` ON `schedule` (`status`,`next_run_at`,`id`);--> statement-breakpoint
CREATE TABLE `sleep_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`awake_at` text NOT NULL,
	`completed_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sleep_queue_completed_requires_completed_at" CHECK("sleep_queue"."status" != 'completed' OR "sleep_queue"."completed_at" IS NOT NULL),
	CONSTRAINT "chk_sleep_queue_cancelled_requires_cancelled_at" CHECK("sleep_queue"."status" != 'cancelled' OR "sleep_queue"."cancelled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_sleep_queue_one_active_per_run` ON `sleep_queue` (`workflow_run_id`) WHERE "sleep_queue"."status" = 'sleeping';--> statement-breakpoint
CREATE INDEX `idx_sleep_queue_workflow_run_id` ON `sleep_queue` (`workflow_run_id`,`id`);--> statement-breakpoint
CREATE TABLE `state_transition` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`type` text NOT NULL,
	`task_id` text,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_task_state_transition_requires_task_id" CHECK(("state_transition"."type" = 'task' AND "state_transition"."task_id" IS NOT NULL) OR ("state_transition"."type" = 'workflow_run' AND "state_transition"."task_id" IS NULL)),
	CONSTRAINT "chk_state_transition_status_matches_type" CHECK((type = 'workflow_run' AND status IN ('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_child_workflow', 'cancelled', 'completed', 'failed')) OR (type = 'task' AND status IN ('running', 'awaiting_retry', 'completed', 'failed', 'discarded')))
);
--> statement-breakpoint
CREATE INDEX `idx_state_transition_workflow_run_id` ON `state_transition` (`workflow_run_id`,`id`);--> statement-breakpoint
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
	`next_attempt_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_task_workflow_run_id` ON `task` (`workflow_run_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_task_workflow_run_status` ON `task` (`workflow_run_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_task_status_next_attempt_at_workflow_run` ON `task` (`status`,`next_attempt_at`,`workflow_run_id`);--> statement-breakpoint
CREATE TABLE `workflow` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`name` text NOT NULL,
	`version_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
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
	`revision` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`input` text,
	`input_hash` text NOT NULL,
	`options` text,
	`reference_id` text,
	`conflict_policy` text,
	`latest_state_transition_id` text NOT NULL,
	`scheduled_at` text,
	`awake_at` text,
	`timeout_at` text,
	`next_attempt_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_workflow_run_workflow_reference` ON `workflow_run` (`workflow_id`,`reference_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_namespace_id` ON `workflow_run` (`namespace_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_namespace_status_id` ON `workflow_run` (`namespace_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_workflow_id` ON `workflow_run` (`workflow_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_workflow_status_id` ON `workflow_run` (`workflow_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_schedule` ON `workflow_run` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_parent_workflow_run_status` ON `workflow_run` (`parent_workflow_run_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_status_scheduled_at_id` ON `workflow_run` (`status`,`scheduled_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_status_awake_at_id` ON `workflow_run` (`status`,`awake_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_status_timeout_at_id` ON `workflow_run` (`status`,`timeout_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_status_next_attempt_at_id` ON `workflow_run` (`status`,`next_attempt_at`,`id`);--> statement-breakpoint
CREATE TABLE `workflow_run_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`workflow_run_id` text NOT NULL,
	`workflow_name` text NOT NULL,
	`workflow_version_id` text NOT NULL,
	`shard` text,
	`rank` real NOT NULL,
	`status` text NOT NULL,
	`published_at` text,
	`claimed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "chk_workflow_run_outbox_published_requires_published_at" CHECK("workflow_run_outbox"."status" != 'published' OR "workflow_run_outbox"."published_at" IS NOT NULL),
	CONSTRAINT "chk_workflow_run_outbox_claimed_requires_claimed_at" CHECK("workflow_run_outbox"."status" != 'claimed' OR "workflow_run_outbox"."claimed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_workflow_run_outbox_workflow_run_id` ON `workflow_run_outbox` (`workflow_run_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_status_workflow_rank_id` ON `workflow_run_outbox` (`namespace_id`,`status`,`workflow_name`,`workflow_version_id`,`shard`,`rank`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_status_workflow_claimed_rank_id` ON `workflow_run_outbox` (`namespace_id`,`status`,`workflow_name`,`workflow_version_id`,`shard`,`claimed_at`,`rank`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_status_rank_id` ON `workflow_run_outbox` (`status`,`rank`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_status_published_id` ON `workflow_run_outbox` (`status`,`published_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_outbox_status_claimed_id` ON `workflow_run_outbox` (`status`,`claimed_at`,`id`);