CREATE TABLE `payment_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`token` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount` text NOT NULL,
	`currency` text DEFAULT 'PEN' NOT NULL,
	`provider_ref` text,
	`checkout_url` text,
	`provider_payment_id` text,
	`amount_paid` text,
	`paid_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_intents_status_check" CHECK(status IN ('pending','paid','expired','failed')),
	CONSTRAINT "payment_intents_provider_check" CHECK(provider IN ('sandbox','mercadopago')),
	CONSTRAINT "payment_intents_token_check" CHECK(length(token) = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_intents_token_uidx` ON `payment_intents` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_intents_provider_payment_uidx` ON `payment_intents` (`provider_payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_intents_one_pending_per_charge` ON `payment_intents` (`charge_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `idx_payment_intents_org_status` ON `payment_intents` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_payment_intents_org_created` ON `payment_intents` (`org_id`,`created_at`);