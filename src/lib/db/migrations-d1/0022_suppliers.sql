CREATE TABLE `incident_supplier_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`status` text DEFAULT 'assigned' NOT NULL,
	`quote_amount` text,
	`final_cost` text,
	`notes` text,
	`assigned_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "incident_supplier_assignments_status_check" CHECK(status IN ('assigned','quoted','approved','done','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_supplier_assignments_incident_uniq` ON `incident_supplier_assignments` (`incident_id`);--> statement-breakpoint
CREATE INDEX `idx_incident_supplier_assignments_org_supplier` ON `incident_supplier_assignments` (`org_id`,`supplier_id`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`trade` text NOT NULL,
	`phone` text,
	`email` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "suppliers_trade_check" CHECK(trade IN ('plumbing','electrical','appliance','structural','cleaning','locksmith','painting','general')),
	CONSTRAINT "suppliers_name_check" CHECK(length(name) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_suppliers_org_trade` ON `suppliers` (`org_id`,`trade`);