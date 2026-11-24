CREATE TABLE `handover_acts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`kind` text NOT NULL,
	`items` text NOT NULL,
	`notes` text,
	`document_path` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`signed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "handover_acts_kind_check" CHECK(kind IN ('check_in','check_out')),
	CONSTRAINT "handover_acts_status_check" CHECK(status IN ('draft','pending_signature','signed'))
);
--> statement-breakpoint
CREATE INDEX `idx_handover_acts_contract` ON `handover_acts` (`org_id`,`contract_id`);--> statement-breakpoint
CREATE TABLE `unit_inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`condition` text DEFAULT 'good' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_inventory_items_condition_check" CHECK(condition IN ('new','good','fair','poor','broken'))
);
--> statement-breakpoint
CREATE INDEX `idx_unit_inventory_items_unit` ON `unit_inventory_items` (`org_id`,`unit_id`);--> statement-breakpoint
ALTER TABLE `signature_requests` ADD `handover_act_id` text REFERENCES handover_acts(id) ON DELETE cascade;