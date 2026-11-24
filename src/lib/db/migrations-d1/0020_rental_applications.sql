CREATE TABLE `rental_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`listing_id` text,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`monthly_income` text NOT NULL,
	`monthly_rent` text,
	`employment_type` text NOT NULL,
	`employment_months` integer NOT NULL,
	`household_size` integer NOT NULL,
	`has_guarantor` integer DEFAULT false NOT NULL,
	`move_in_date` text,
	`message` text,
	`documents` text NOT NULL,
	`score` integer NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "rental_applications_employment_type_check" CHECK(employment_type IN ('employee', 'self_employed', 'retired', 'student', 'other')),
	CONSTRAINT "rental_applications_status_check" CHECK(status IN ('new', 'reviewing', 'approved', 'rejected')),
	CONSTRAINT "rental_applications_score_check" CHECK(score BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE INDEX `idx_rental_applications_org_created` ON `rental_applications` (`org_id`,`created_at`);