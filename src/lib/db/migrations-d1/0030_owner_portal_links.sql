CREATE TABLE `owner_portal_links` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_viewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_portal_links_token_hash_uniq` ON `owner_portal_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_owner_portal_links_org_owner` ON `owner_portal_links` (`org_id`,`owner_id`);