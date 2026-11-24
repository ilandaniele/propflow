CREATE TABLE `owner_assistant_links` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`phone_e164` text NOT NULL,
	`code_hash` text,
	`code_expires_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "owner_assistant_links_attempts_check" CHECK(attempts >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_assistant_links_profile_uniq` ON `owner_assistant_links` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `owner_assistant_links_org_phone_uniq` ON `owner_assistant_links` (`org_id`,`phone_e164`);--> statement-breakpoint
CREATE TABLE `owner_assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`link_id` text,
	`provider_message_id` text NOT NULL,
	`kind` text NOT NULL,
	`outcome` text DEFAULT 'received' NOT NULL,
	`record_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`link_id`) REFERENCES `owner_assistant_links`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_assistant_messages_provider_uniq` ON `owner_assistant_messages` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `idx_owner_assistant_messages_org` ON `owner_assistant_messages` (`org_id`,`created_at`);