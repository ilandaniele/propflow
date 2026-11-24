CREATE TABLE `staff_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "staff_roles_role_check" CHECK(role IN ('finance', 'operations', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_roles_profile_uniq` ON `staff_roles` (`profile_id`);--> statement-breakpoint
CREATE INDEX `idx_staff_roles_org` ON `staff_roles` (`org_id`);