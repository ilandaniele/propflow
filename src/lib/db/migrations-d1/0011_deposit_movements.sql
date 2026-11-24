CREATE TABLE `deposit_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` text NOT NULL,
	`moved_on` text NOT NULL,
	`description` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deposit_movements_kind_check" CHECK(kind IN ('collected','deduction','refund')),
	CONSTRAINT "deposit_movements_amount_check" CHECK(CAST(amount AS REAL) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_deposit_movements_org_contract` ON `deposit_movements` (`org_id`,`contract_id`);