CREATE TABLE `announcement_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`announcement_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "announcement_deliveries_channel_check" CHECK(channel IN ('email','whatsapp')),
	CONSTRAINT "announcement_deliveries_status_check" CHECK(status IN ('pending','sent','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_deliveries_uniq` ON `announcement_deliveries` (`announcement_id`,`tenant_id`,`channel`);--> statement-breakpoint
CREATE INDEX `idx_announcement_deliveries_org_ann_status` ON `announcement_deliveries` (`org_id`,`announcement_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_announcement_deliveries_tenant` ON `announcement_deliveries` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `announcements_email` integer DEFAULT true NOT NULL;