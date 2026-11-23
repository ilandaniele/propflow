CREATE TABLE `org_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "org_memberships_role_check" CHECK(role IN ('admin', 'tenant'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_org_memberships_user_org` ON `org_memberships` (`user_id`,`org_id`);--> statement-breakpoint
CREATE INDEX `idx_org_memberships_org` ON `org_memberships` (`org_id`);