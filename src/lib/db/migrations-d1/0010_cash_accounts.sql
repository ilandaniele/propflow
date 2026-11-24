CREATE TABLE `cash_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`bank_name` text,
	`account_number` text,
	`opening_balance` text DEFAULT '0' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cash_accounts_kind_check" CHECK(kind IN ('cash', 'bank'))
);
--> statement-breakpoint
CREATE INDEX `idx_cash_accounts_org` ON `cash_accounts` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cash_accounts_org_name_uniq` ON `cash_accounts` (`org_id`,`name`);--> statement-breakpoint
CREATE TABLE `cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`account_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`concept` text NOT NULL,
	`document` text,
	`direction` text NOT NULL,
	`amount` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `cash_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cash_movements_direction_check" CHECK(direction IN ('in', 'out')),
	CONSTRAINT "cash_movements_amount_check" CHECK(CAST(amount AS REAL) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_cash_movements_org_account_date` ON `cash_movements` (`org_id`,`account_id`,`occurred_on`);