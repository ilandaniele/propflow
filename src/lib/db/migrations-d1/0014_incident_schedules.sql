CREATE TABLE `incident_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`estimated_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_schedules_incident_uniq` ON `incident_schedules` (`incident_id`);--> statement-breakpoint
CREATE INDEX `idx_incident_schedules_org_estimated` ON `incident_schedules` (`org_id`,`estimated_on`);