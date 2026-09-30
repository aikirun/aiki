PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workflow` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`source` text NOT NULL,
	`name` text NOT NULL,
	`name_lowercase` text NOT NULL,
	`version_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "chk_workflow_source" CHECK("__new_workflow"."source" IN ('user', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_workflow`("id", "namespace_id", "source", "name", "name_lowercase", "version_id", "created_at")
SELECT "id", "namespace_id", "source", "name", lower("name"), "version_id", "created_at" FROM `workflow`;--> statement-breakpoint
DROP TABLE `workflow`;--> statement-breakpoint
ALTER TABLE `__new_workflow` RENAME TO `workflow`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uqidx_workflow_namespace_source_name_version` ON `workflow` (`namespace_id`,`source`,`name`,`version_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_namespace_source_name_lowercase` ON `workflow` (`namespace_id`,`source`,`name_lowercase`,`name`);
