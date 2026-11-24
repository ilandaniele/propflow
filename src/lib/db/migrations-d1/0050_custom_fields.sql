CREATE TABLE `custom_field_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`field_type` text NOT NULL,
	`options` text,
	`required` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "custom_field_definitions_entity_type_check" CHECK(entity_type IN ('property','unit','tenant','contract')),
	CONSTRAINT "custom_field_definitions_field_type_check" CHECK(field_type IN ('text','number','date','boolean','select'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_definitions_org_entity_key_uidx` ON `custom_field_definitions` (`org_id`,`entity_type`,`key`);--> statement-breakpoint
CREATE INDEX `idx_custom_field_definitions_org_entity_sort` ON `custom_field_definitions` (`org_id`,`entity_type`,`sort_order`);--> statement-breakpoint
CREATE TABLE `custom_field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`definition_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`definition_id`) REFERENCES `custom_field_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_values_definition_entity_uidx` ON `custom_field_values` (`definition_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_custom_field_values_org_entity` ON `custom_field_values` (`org_id`,`entity_id`);--> statement-breakpoint
CREATE TRIGGER `custom_field_values_cleanup_properties` AFTER DELETE ON `properties` BEGIN DELETE FROM `custom_field_values` WHERE `org_id` = OLD.`org_id` AND `entity_id` = OLD.`id`; END;--> statement-breakpoint
CREATE TRIGGER `custom_field_values_cleanup_units` AFTER DELETE ON `units` BEGIN DELETE FROM `custom_field_values` WHERE `org_id` = OLD.`org_id` AND `entity_id` = OLD.`id`; END;--> statement-breakpoint
CREATE TRIGGER `custom_field_values_cleanup_tenants` AFTER DELETE ON `tenants` BEGIN DELETE FROM `custom_field_values` WHERE `org_id` = OLD.`org_id` AND `entity_id` = OLD.`id`; END;--> statement-breakpoint
CREATE TRIGGER `custom_field_values_cleanup_contracts` AFTER DELETE ON `contracts` BEGIN DELETE FROM `custom_field_values` WHERE `org_id` = OLD.`org_id` AND `entity_id` = OLD.`id`; END;