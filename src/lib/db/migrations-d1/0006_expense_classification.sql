ALTER TABLE `expense_categories` ADD `parent_id` text REFERENCES expense_categories(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_expense_categories_parent` ON `expense_categories` (`parent_id`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `kind` text DEFAULT 'ordinary' NOT NULL;