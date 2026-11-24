CREATE TABLE `building_staff` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text,
	`full_name` text NOT NULL,
	`position` text NOT NULL,
	`shift` text,
	`phone` text,
	`document_number` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_building_staff_org` ON `building_staff` (`org_id`);