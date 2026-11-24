CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`tenant_id` text,
	`contract_id` text,
	`property_id` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`expires_on` text,
	`visible_to_tenant` integer DEFAULT false NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "documents_one_entity_check" CHECK((tenant_id IS NOT NULL) + (contract_id IS NOT NULL) + (property_id IS NOT NULL) = 1),
	CONSTRAINT "documents_category_check" CHECK(category IN ('identity','contract','insurance','certificate','invoice','other'))
);
--> statement-breakpoint
CREATE INDEX `idx_documents_org_created` ON `documents` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_tenant` ON `documents` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_contract` ON `documents` (`contract_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_property` ON `documents` (`property_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_org_expires` ON `documents` (`org_id`,`expires_on`);