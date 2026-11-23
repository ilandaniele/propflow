CREATE TABLE `period_closes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`period` text NOT NULL,
	`note` text,
	`closed_by` text,
	`closed_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`closed_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `period_closes_org_period_uniq` ON `period_closes` (`org_id`,`period`);--> statement-breakpoint
CREATE INDEX `idx_period_closes_org` ON `period_closes` (`org_id`);