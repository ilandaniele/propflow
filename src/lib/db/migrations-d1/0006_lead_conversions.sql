CREATE TABLE `lead_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_conversions_lead_uniq` ON `lead_conversions` (`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_lead_conversions_org` ON `lead_conversions` (`org_id`);