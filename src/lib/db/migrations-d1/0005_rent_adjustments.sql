CREATE TABLE `rent_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`previous_rent` text NOT NULL,
	`new_rent` text NOT NULL,
	`percent` text NOT NULL,
	`effective_on` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "rent_adjustments_new_rent_check" CHECK(CAST(new_rent AS REAL) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_rent_adjustments_org_contract` ON `rent_adjustments` (`org_id`,`contract_id`);