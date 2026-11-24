CREATE TABLE `org_signatures` (
	`org_id` text PRIMARY KEY NOT NULL,
	`signer_name` text NOT NULL,
	`signer_document` text,
	`image_data_url` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
