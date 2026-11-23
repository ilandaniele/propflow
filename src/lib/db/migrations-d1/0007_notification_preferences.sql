CREATE TABLE `notification_preferences` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`lease_renewal_email` integer DEFAULT true NOT NULL,
	`payment_due_email` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notification_preferences_org` ON `notification_preferences` (`org_id`);