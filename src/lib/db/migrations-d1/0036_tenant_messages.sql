CREATE TABLE `tenant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reply` text,
	`replied_by` text,
	`replied_at` integer,
	`created_at` integer NOT NULL,
	`attachment_key` text,
	`attachment_name` text,
	`attachment_mime` text,
	`attachment_size` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replied_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tenant_messages_org_status` ON `tenant_messages` (`org_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tenant_messages_sender` ON `tenant_messages` (`sender_id`,`created_at`);