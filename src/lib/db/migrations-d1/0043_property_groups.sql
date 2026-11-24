CREATE TABLE `property_group_members` (
	`group_id` text NOT NULL,
	`property_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `property_id`),
	FOREIGN KEY (`group_id`) REFERENCES `property_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_property_group_members_property` ON `property_group_members` (`property_id`);--> statement-breakpoint
CREATE TABLE `property_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_groups_org_name_uidx` ON `property_groups` (`org_id`,`name`);