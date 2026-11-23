CREATE TABLE `expiring_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`tenant_id` text,
	`property_id` text,
	`expires_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "expiring_documents_kind_check" CHECK(kind IN ('dni','insurance','certificate','other'))
);
--> statement-breakpoint
CREATE INDEX `idx_expiring_documents_org_expires` ON `expiring_documents` (`org_id`,`expires_on`);