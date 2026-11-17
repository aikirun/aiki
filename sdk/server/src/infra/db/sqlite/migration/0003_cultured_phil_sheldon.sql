PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workflow_run` (
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
	CONSTRAINT "chk_workflow_run_status" CHECK("status" IN ('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_task_retry', 'awaiting_child_workflow', 'stalled', 'cancelled', 'completed', 'failed')),
	CONSTRAINT "chk_workflow_run_sleeping_requires_wakeup_at" CHECK("status" != 'sleeping' OR "wakeup_at" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_workflow_run`("id", "namespace_id", "workflow_id", "schedule_id", "parent_workflow_run_id", "status", "client_hasher_applied", "client_codec_applied", "revision", "signal_sequence", "attempts", "input", "input_hash", "options", "reference_id", "latest_state_transition_id", "scheduled_at", "wakeup_at", "timeout_at", "next_attempt_at", "created_at", "updated_at") SELECT "id", "namespace_id", "workflow_id", "schedule_id", "parent_workflow_run_id", "status", "client_hasher_applied", "client_codec_applied", "revision", "signal_sequence", "attempts", "input", "input_hash", "options", "reference_id", "latest_state_transition_id", "scheduled_at", "wakeup_at", "timeout_at", "next_attempt_at", "created_at", "updated_at" FROM `workflow_run`;--> statement-breakpoint
DROP TABLE `workflow_run`;--> statement-breakpoint
ALTER TABLE `__new_workflow_run` RENAME TO `workflow_run`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
CREATE INDEX `idx_workflow_run_due_awaiting_task_retry` ON `workflow_run` (`next_attempt_at`,`id`) WHERE "workflow_run"."status" = 'awaiting_task_retry';