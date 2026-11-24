CREATE TABLE `property_owner_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`commission_pct` text DEFAULT '0' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "property_owner_terms_commission_check" CHECK(CAST(commission_pct AS REAL) >= 0 AND CAST(commission_pct AS REAL) <= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_owner_terms_property_uniq` ON `property_owner_terms` (`property_id`);--> statement-breakpoint
CREATE INDEX `idx_property_owner_terms_org_owner` ON `property_owner_terms` (`org_id`,`owner_id`);