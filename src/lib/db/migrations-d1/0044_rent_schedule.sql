CREATE TABLE `rent_schedule_settings` (
	`org_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `charges` ADD `kind` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_charges_rent_contract_period` ON `charges` (`contract_id`,`period`) WHERE kind = 'rent';