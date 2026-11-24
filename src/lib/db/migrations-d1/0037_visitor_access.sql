CREATE TABLE `authorized_visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`full_name` text NOT NULL,
	`document_number` text,
	`relationship` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_authorized_visitors_org` ON `authorized_visitors` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_authorized_visitors_unit` ON `authorized_visitors` (`unit_id`);--> statement-breakpoint
ALTER TABLE `visitor_logs` ADD `passphrase` text;