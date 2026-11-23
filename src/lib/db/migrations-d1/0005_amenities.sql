CREATE TABLE `amenities` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`open_time` text NOT NULL,
	`close_time` text NOT NULL,
	`slot_minutes` integer DEFAULT 60 NOT NULL,
	`capacity` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "amenities_slot_minutes_check" CHECK(slot_minutes BETWEEN 15 AND 720),
	CONSTRAINT "amenities_hours_check" CHECK(open_time < close_time),
	CONSTRAINT "amenities_capacity_check" CHECK(capacity IS NULL OR capacity > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_amenities_org` ON `amenities` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `amenities_property_name_uniq` ON `amenities` (`property_id`,`name`);--> statement-breakpoint
CREATE TABLE `amenity_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`amenity_id` text NOT NULL,
	`tenant_id` text,
	`booked_on` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`guest_count` integer,
	`comment` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`amenity_id`) REFERENCES `amenities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "amenity_bookings_status_check" CHECK(status IN ('confirmed','cancelled')),
	CONSTRAINT "amenity_bookings_guest_count_check" CHECK(guest_count IS NULL OR guest_count BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `amenity_bookings_slot_uniq` ON `amenity_bookings` (`amenity_id`,`booked_on`,`start_time`) WHERE status = 'confirmed';--> statement-breakpoint
CREATE INDEX `idx_amenity_bookings_org_date` ON `amenity_bookings` (`org_id`,`booked_on`);--> statement-breakpoint
CREATE INDEX `idx_amenity_bookings_tenant` ON `amenity_bookings` (`tenant_id`);