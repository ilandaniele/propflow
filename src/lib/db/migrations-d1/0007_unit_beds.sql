CREATE TABLE `unit_beds` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`label` text NOT NULL,
	`monthly_rent` text,
	`tenant_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_beds_unit_label_uidx` ON `unit_beds` (`unit_id`,`label`);--> statement-breakpoint
CREATE UNIQUE INDEX `unit_beds_tenant_uidx` ON `unit_beds` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_unit_beds_org_unit` ON `unit_beds` (`org_id`,`unit_id`);