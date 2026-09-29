PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_state_transition` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text,
	`type` text NOT NULL,
	`task_id` text,
	`schedule_id` text,
	`status` text GENERATED ALWAYS AS (json_extract("state", '$.status')) STORED NOT NULL,
	`attempt` integer,
	`revision` integer NOT NULL,
	`task_sequence` integer,
	`state` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_state_transition_type" CHECK("__new_state_transition"."type" IN ('workflow_run', 'task', 'schedule')),
	CONSTRAINT "chk_state_transition_columns_match_type" CHECK(("__new_state_transition"."type" = 'workflow_run' AND "__new_state_transition"."workflow_run_id" IS NOT NULL AND "__new_state_transition"."attempt" IS NOT NULL AND "__new_state_transition"."task_id" IS NULL AND "__new_state_transition"."schedule_id" IS NULL AND "__new_state_transition"."task_sequence" IS NULL) OR ("__new_state_transition"."type" = 'task' AND "__new_state_transition"."workflow_run_id" IS NOT NULL AND "__new_state_transition"."attempt" IS NOT NULL AND "__new_state_transition"."task_id" IS NOT NULL AND "__new_state_transition"."schedule_id" IS NULL AND "__new_state_transition"."task_sequence" IS NOT NULL AND "__new_state_transition"."task_sequence" >= 0) OR ("__new_state_transition"."type" = 'schedule' AND "__new_state_transition"."schedule_id" IS NOT NULL AND "__new_state_transition"."workflow_run_id" IS NULL AND "__new_state_transition"."attempt" IS NULL AND "__new_state_transition"."task_id" IS NULL AND "__new_state_transition"."task_sequence" IS NULL)),
	CONSTRAINT "chk_state_transition_status_matches_type" CHECK(("__new_state_transition"."type" = 'workflow_run' AND "__new_state_transition"."status" IN ('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_task_retry', 'awaiting_child_workflow', 'stalled', 'cancelled', 'completed', 'failed')) OR ("__new_state_transition"."type" = 'task' AND "__new_state_transition"."status" IN ('running', 'awaiting_retry', 'completed', 'failed', 'discarded')) OR ("__new_state_transition"."type" = 'schedule' AND "__new_state_transition"."status" IN ('active', 'paused', 'inactive')))
);
--> statement-breakpoint
INSERT INTO `__new_state_transition`("id", "workflow_run_id", "type", "task_id", "schedule_id", "attempt", "revision", "task_sequence", "state", "created_at")
SELECT "id", "workflow_run_id", "type", "task_id", "schedule_id", "attempt", "revision",
	CASE WHEN "type" = 'task' THEN row_number() OVER (PARTITION BY "workflow_run_id", "revision", "type" ORDER BY "id") END,
	"state", "created_at"
FROM `state_transition`;--> statement-breakpoint
DROP TABLE `state_transition`;--> statement-breakpoint
ALTER TABLE `__new_state_transition` RENAME TO `state_transition`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_state_transition_workflow_run_id` ON `state_transition` (`workflow_run_id`,`revision`,(CASE "type" WHEN 'workflow_run' THEN 0 WHEN 'task' THEN 1 WHEN 'schedule' THEN 2 END),`task_sequence`,`id`) WHERE "state_transition"."workflow_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_state_transition_schedule_id` ON `state_transition` (`schedule_id`,`revision`,`id`) WHERE "state_transition"."schedule_id" IS NOT NULL;