CREATE TABLE `asset_task_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`task_id` text NOT NULL,
	`done_on` text NOT NULL,
	`cost` text,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `asset_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_asset_task_logs_task` ON `asset_task_logs` (`task_id`,`done_on`);--> statement-breakpoint
CREATE INDEX `idx_asset_task_logs_org` ON `asset_task_logs` (`org_id`,`done_on`);--> statement-breakpoint
CREATE TABLE `asset_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`title` text NOT NULL,
	`frequency_months` integer NOT NULL,
	`starts_on` text NOT NULL,
	`responsible` text,
	`supplier` text,
	`estimated_cost` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_tasks_frequency_check" CHECK("asset_tasks"."frequency_months" between 1 and 120)
);
--> statement-breakpoint
CREATE INDEX `idx_asset_tasks_org` ON `asset_tasks` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_tasks_asset` ON `asset_tasks` (`asset_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`location` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assets_org` ON `assets` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_property_name_uniq` ON `assets` (`property_id`,`name`);