CREATE TABLE `recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text,
	`category_id` text,
	`amount` text NOT NULL,
	`description` text NOT NULL,
	`day_of_month` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_period` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_expenses_amount_check" CHECK(CAST(amount AS REAL) > 0),
	CONSTRAINT "recurring_expenses_day_check" CHECK(day_of_month BETWEEN 1 AND 28)
);
--> statement-breakpoint
CREATE INDEX `idx_recurring_expenses_org` ON `recurring_expenses` (`org_id`);