ALTER TABLE `namespace` ADD `member_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `namespace_member` ADD `membership_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_namespace_member_membership_key` ON `namespace_member` (`membership_key`);