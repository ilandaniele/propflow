CREATE INDEX `idx_units_org_status` ON `units` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_account_statements_org_send_status` ON `account_statements` (`org_id`,`send_status`);--> statement-breakpoint
CREATE INDEX `idx_additional_charges_org_anio` ON `additional_charges` (`org_id`,`anio`);--> statement-breakpoint
CREATE INDEX `idx_payments_org_status_paid` ON `payments` (`org_id`,`status`,`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_trash_compliance_org_fecha` ON `trash_compliance` (`org_id`,`fecha`);