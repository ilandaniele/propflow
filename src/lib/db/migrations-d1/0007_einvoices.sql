CREATE TABLE `einvoice_series` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`series` text NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "einvoice_series_doc_type_check" CHECK(doc_type IN ('boleta','factura')),
	CONSTRAINT "einvoice_series_next_number_check" CHECK(next_number >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `einvoice_series_org_type_series_uniq` ON `einvoice_series` (`org_id`,`doc_type`,`series`);--> statement-breakpoint
CREATE TABLE `einvoices` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`series` text NOT NULL,
	`number` integer NOT NULL,
	`customer_doc_type` text NOT NULL,
	`customer_doc_number` text,
	`customer_name` text NOT NULL,
	`total` text NOT NULL,
	`base` text NOT NULL,
	`igv` text NOT NULL,
	`currency` text DEFAULT 'PEN' NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_response` text,
	`pdf_url` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "einvoices_doc_type_check" CHECK(doc_type IN ('boleta','factura')),
	CONSTRAINT "einvoices_customer_doc_type_check" CHECK(customer_doc_type IN ('dni','ruc','none')),
	CONSTRAINT "einvoices_provider_check" CHECK(provider IN ('sandbox','nubefact')),
	CONSTRAINT "einvoices_status_check" CHECK(status IN ('pending','accepted_sandbox','sent','accepted','rejected','error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `einvoices_org_series_number_uniq` ON `einvoices` (`org_id`,`series`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `einvoices_charge_uniq` ON `einvoices` (`charge_id`);--> statement-breakpoint
CREATE INDEX `idx_einvoices_org_created` ON `einvoices` (`org_id`,`created_at`);