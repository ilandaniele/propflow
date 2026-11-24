CREATE TABLE `bank_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`file_name` text NOT NULL,
	`line_count` integer NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_bank_imports_org` ON `bank_imports` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bank_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`import_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`posted_on` text NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`amount` text NOT NULL,
	`status` text DEFAULT 'unmatched' NOT NULL,
	`payment_id` text,
	`resolved_by` text,
	`resolved_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `bank_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "bank_lines_status_check" CHECK("bank_lines"."status" in ('unmatched', 'matched', 'ignored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_lines_org_fingerprint_uniq` ON `bank_lines` (`org_id`,`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_lines_payment_uniq` ON `bank_lines` (`payment_id`) WHERE "bank_lines"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX `idx_bank_lines_org_status` ON `bank_lines` (`org_id`,`status`,`posted_on`);