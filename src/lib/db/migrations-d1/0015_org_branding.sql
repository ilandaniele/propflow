CREATE TABLE `org_branding` (
	`org_id` text PRIMARY KEY NOT NULL,
	`logo_key` text,
	`accent_color` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
