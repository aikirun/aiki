ALTER TABLE `schedule` ADD `definition_codec_applied` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_run` ADD `definition_codec_applied` integer DEFAULT false NOT NULL;
