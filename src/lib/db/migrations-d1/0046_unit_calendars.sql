CREATE TABLE `unit_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`export_token` text NOT NULL,
	`import_url` text,
	`last_synced_at` integer,
	`last_sync_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_calendars_unit_uidx` ON `unit_calendars` (`unit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unit_calendars_token_uidx` ON `unit_calendars` (`export_token`);--> statement-breakpoint
CREATE INDEX `idx_unit_calendars_synced` ON `unit_calendars` (`last_synced_at`);--> statement-breakpoint
CREATE TABLE `unit_external_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`uid` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `unit_calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_external_blocks_calendar_uid_uidx` ON `unit_external_blocks` (`calendar_id`,`uid`);--> statement-breakpoint
CREATE INDEX `idx_unit_external_blocks_unit_start` ON `unit_external_blocks` (`org_id`,`unit_id`,`starts_on`);