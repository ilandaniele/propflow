CREATE TABLE `utility_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text NOT NULL,
	`unit_id` text,
	`utility_type` text NOT NULL,
	`provider` text NOT NULL,
	`supply_number` text,
	`holder_kind` text NOT NULL,
	`holder_name` text NOT NULL,
	`monthly_estimate` text,
	`start_date` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "utility_contracts_type_check" CHECK(utility_type IN ('luz','agua','gas','internet','otro')),
	CONSTRAINT "utility_contracts_holder_kind_check" CHECK(holder_kind IN ('owner','tenant','other'))
);
--> statement-breakpoint
CREATE INDEX `idx_utility_contracts_org_property` ON `utility_contracts` (`org_id`,`property_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `utility_holder_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`changed_on` text NOT NULL,
	`from_holder` text NOT NULL,
	`to_holder` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `utility_contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_utility_holder_changes_contract` ON `utility_holder_changes` (`contract_id`,`changed_on`);