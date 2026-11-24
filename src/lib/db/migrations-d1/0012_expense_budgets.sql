CREATE TABLE `expense_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`category_id` text NOT NULL,
	`year` integer NOT NULL,
	`amount` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "expense_budgets_amount_check" CHECK(CAST(amount AS REAL) >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_budgets_org_category_year_uniq` ON `expense_budgets` (`org_id`,`category_id`,`year`);--> statement-breakpoint
CREATE INDEX `idx_expense_budgets_org_year` ON `expense_budgets` (`org_id`,`year`);