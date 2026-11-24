CREATE TABLE `incident_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`changed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "incident_status_events_to_check" CHECK(to_status IN ('pending','in_progress','solved'))
);
--> statement-breakpoint
CREATE INDEX `idx_incident_status_events_incident_time` ON `incident_status_events` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_incident_status_events_org` ON `incident_status_events` (`org_id`);