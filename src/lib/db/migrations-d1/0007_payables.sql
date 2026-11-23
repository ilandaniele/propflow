CREATE TABLE `payable_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`payable_id` text NOT NULL,
	`org_id` text NOT NULL,
	`amount` text NOT NULL,
	`paid_on` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payable_id`) REFERENCES `payables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payable_payments_amount_check" CHECK(CAST(amount AS REAL) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_payable_payments_payable` ON `payable_payments` (`payable_id`);--> statement-breakpoint
CREATE INDEX `idx_payable_payments_org_paid` ON `payable_payments` (`org_id`,`paid_on`);--> statement-breakpoint
CREATE TABLE `payables` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text,
	`category_id` text,
	`supplier_name` text NOT NULL,
	`description` text,
	`document_ref` text,
	`amount` text NOT NULL,
	`issued_on` text NOT NULL,
	`due_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payables_amount_check" CHECK(CAST(amount AS REAL) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_payables_org_due` ON `payables` (`org_id`,`due_on`);--> statement-breakpoint
CREATE TRIGGER `payable_payments_no_overpay`
BEFORE INSERT ON `payable_payments`
BEGIN
  SELECT RAISE(ABORT, 'payable_overpaid')
  WHERE ROUND(CAST(NEW.amount AS REAL) * 100) > (
    SELECT ROUND(CAST(p.amount AS REAL) * 100)
      - COALESCE((SELECT SUM(ROUND(CAST(pp.amount AS REAL) * 100)) FROM `payable_payments` pp WHERE pp.payable_id = p.id), 0)
    FROM `payables` p
    WHERE p.id = NEW.payable_id
  );
END;