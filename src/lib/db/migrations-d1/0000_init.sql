CREATE TABLE `accounts` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `provider_account_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`monthly_rent` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`deposit` text,
	`document_url` text,
	`signed_at` integer,
	`signature_status` text,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contracts_monthly_rent_check" CHECK(CAST(monthly_rent AS REAL) > 0),
	CONSTRAINT "contracts_status_check" CHECK(status IN ('active', 'expired', 'terminated')),
	CONSTRAINT "contracts_deposit_check" CHECK(CAST(deposit AS REAL) >= 0),
	CONSTRAINT "contracts_signature_status_check" CHECK(signature_status IS NULL OR signature_status IN ('pending_signature','signed','declined')),
	CONSTRAINT "contracts_date_order_nullable" CHECK(end_date IS NULL OR end_date > start_date)
);
--> statement-breakpoint
CREATE INDEX `idx_contracts_org_id` ON `contracts` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_contracts_tenant_id` ON `contracts` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_contracts_unit_id` ON `contracts` (`unit_id`);--> statement-breakpoint
CREATE INDEX `idx_contracts_org_status` ON `contracts` (`org_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_org_airtable_uniq` ON `contracts` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `crm_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`full_name` text NOT NULL,
	`email` text,
	`phone` text,
	`property_interest` text,
	`source` text,
	`status` text DEFAULT 'new' NOT NULL,
	`notes` text,
	`operation_type` text,
	`pipeline` text DEFAULT 'demand' NOT NULL,
	`budget_min` text,
	`budget_max` text,
	`currency` text DEFAULT 'PEN' NOT NULL,
	`zones` text DEFAULT '[]' NOT NULL,
	`bedrooms_min` integer,
	`move_in_date` text,
	`timeline` text,
	`pets` integer,
	`score` integer DEFAULT 0 NOT NULL,
	`intent_tag` text,
	`assigned_profile_id` text,
	`stage` text DEFAULT 'new' NOT NULL,
	`next_followup_at` integer,
	`do_not_contact` integer DEFAULT false NOT NULL,
	`source_channel` text,
	`source_ref` text,
	`source_meta` text DEFAULT '{}' NOT NULL,
	`assigned_at` integer,
	`stage_changed_at` integer,
	`followup_state` text DEFAULT 'idle' NOT NULL,
	`followup_stop_reason` text,
	`last_listing_alert_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_leads_status_check" CHECK(status IN ('new','contacted','qualified','lost')),
	CONSTRAINT "crm_leads_operation_type_check" CHECK(operation_type IS NULL OR operation_type IN ('rent','buy','owner_sell','owner_rent')),
	CONSTRAINT "crm_leads_pipeline_check" CHECK(pipeline IN ('demand','supply')),
	CONSTRAINT "crm_leads_budget_min_check" CHECK(budget_min IS NULL OR CAST(budget_min AS REAL) >= 0),
	CONSTRAINT "crm_leads_budget_max_check" CHECK(budget_max IS NULL OR CAST(budget_max AS REAL) >= 0),
	CONSTRAINT "crm_leads_bedrooms_min_check" CHECK(bedrooms_min IS NULL OR bedrooms_min >= 0),
	CONSTRAINT "crm_leads_timeline_check" CHECK(timeline IS NULL OR timeline IN ('immediate','1_3_months','3_6_months','flexible')),
	CONSTRAINT "crm_leads_intent_tag_check" CHECK(intent_tag IS NULL OR intent_tag IN ('high_intent','under_analysis','qualified','cold')),
	CONSTRAINT "crm_leads_source_channel_check" CHECK(source_channel IS NULL OR source_channel IN ('whatsapp','web','voice','manual')),
	CONSTRAINT "crm_leads_stage_format" CHECK((length(stage) BETWEEN 2 AND 40 AND stage GLOB '[a-z]*' AND stage NOT GLOB '*[^a-z0-9_]*')),
	CONSTRAINT "crm_leads_followup_state_check" CHECK(followup_state IN ('idle', 'active', 'stopped', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `idx_crm_leads_org` ON `crm_leads` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_org_status` ON `crm_leads` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_org_stage` ON `crm_leads` (`org_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_org_followup` ON `crm_leads` (`org_id`,`next_followup_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_org_pipeline_stage` ON `crm_leads` (`org_id`,`pipeline`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_org_assigned` ON `crm_leads` (`org_id`,`assigned_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_org_created` ON `crm_leads` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`org_id` text NOT NULL,
	`role` text NOT NULL,
	`full_name` text,
	`email` text,
	`phone` text,
	`preferred_language` text,
	`terms_accepted_at` integer,
	`terms_version` text,
	`privacy_accepted_at` integer,
	`privacy_version` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profiles_role_check" CHECK(role IN ('admin', 'tenant')),
	CONSTRAINT "profiles_preferred_language_check" CHECK(preferred_language IN ('es', 'en', 'pt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_user_id_unique` ON `profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_profiles_org_id` ON `profiles` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_profiles_org_role` ON `profiles` (`org_id`,`role`);--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`city` text,
	`country` text,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`tope_luz` text,
	`tope_agua` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_properties_org_id` ON `properties` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `properties_org_airtable_uniq` ON `properties` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `responsables` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`full_name` text,
	`dni` text,
	`phone` text,
	`email` text,
	`employment` text,
	`company` text,
	`job_title` text,
	`industry` text,
	`status` text,
	`photo_url` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `responsables_org_airtable_uniq` ON `responsables` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text,
	`responsable_id` text,
	`full_name` text NOT NULL,
	`email` text,
	`phone` text,
	`unit_id` text,
	`notes` text,
	`preferred_language` text DEFAULT 'es' NOT NULL,
	`photo_url` text,
	`whatsapp_phone` text,
	`whatsapp_opt_in` integer DEFAULT false NOT NULL,
	`reliability_scores` text DEFAULT '{}' NOT NULL,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`last_synced_at` integer,
	`portal_access` text DEFAULT 'not_invited' NOT NULL,
	`emergency_contact_name` text,
	`emergency_contact_phone` text,
	`external_tenant_id` text,
	`document_number` text,
	`date_of_birth` text,
	`move_in_date` text,
	`import_source` text DEFAULT 'manual',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responsable_id`) REFERENCES `responsables`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tenants_preferred_language_check" CHECK(preferred_language IN ('es', 'en', 'pt')),
	CONSTRAINT "tenants_sync_status_check" CHECK(sync_status IN ('pending','synced','failed','needs_review')),
	CONSTRAINT "tenants_portal_access_check" CHECK(portal_access IN ('not_invited','invited','active'))
);
--> statement-breakpoint
CREATE INDEX `idx_tenants_org_id` ON `tenants` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_tenants_org_unit` ON `tenants` (`org_id`,`unit_id`);--> statement-breakpoint
CREATE INDEX `idx_tenants_profile_id` ON `tenants` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_org_airtable_uniq` ON `tenants` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_org_external_id_uidx` ON `tenants` (`org_id`,`external_tenant_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text NOT NULL,
	`label` text NOT NULL,
	`floor` text,
	`bedrooms` integer,
	`monthly_rent_default` text,
	`status` text DEFAULT 'vacant' NOT NULL,
	`toilet_type` text DEFAULT 'private' NOT NULL,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`area_m2` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "units_bedrooms_check" CHECK(bedrooms >= 0),
	CONSTRAINT "units_monthly_rent_default_check" CHECK(CAST(monthly_rent_default AS REAL) >= 0),
	CONSTRAINT "units_status_check" CHECK(status IN ('vacant', 'occupied')),
	CONSTRAINT "units_toilet_type_check" CHECK(toilet_type IN ('shared', 'private', 'none'))
);
--> statement-breakpoint
CREATE INDEX `idx_units_org_id` ON `units` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_units_property_id` ON `units` (`property_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `units_org_airtable_uniq` ON `units` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`email_verified` integer,
	`image` text,
	`password_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`tenant_id` text,
	`external_phone` text NOT NULL,
	`last_message_at` integer,
	`unread_count_admin` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_wa_conv_org_last` ON `whatsapp_conversations` (`org_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `idx_wa_conv_tenant` ON `whatsapp_conversations` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_conversations_phone_per_org` ON `whatsapp_conversations` (`org_id`,`external_phone`);--> statement-breakpoint
CREATE TABLE `whatsapp_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`direction` text NOT NULL,
	`provider_message_id` text,
	`body` text,
	`attachment_path` text,
	`attachment_kind` text,
	`classification` text,
	`status` text DEFAULT 'received' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`agent_status` text,
	`sender_kind` text,
	`sent_by_profile_id` text,
	`agent_claimed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `whatsapp_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sent_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "whatsapp_messages_direction_check" CHECK(direction IN ('inbound', 'outbound')),
	CONSTRAINT "whatsapp_messages_attachment_kind_check" CHECK(attachment_kind IN ('image', 'document', 'audio', 'video')),
	CONSTRAINT "whatsapp_messages_classification_check" CHECK(classification IN ('receipt', 'task-proof', 'incident-evidence', 'other')),
	CONSTRAINT "whatsapp_messages_status_check" CHECK(status IN ('queued','sent','delivered','read','failed','received')),
	CONSTRAINT "whatsapp_messages_agent_status_check" CHECK(agent_status IS NULL OR agent_status IN ('pending','processing','processed','skipped')),
	CONSTRAINT "whatsapp_messages_sender_kind_check" CHECK(sender_kind IS NULL OR sender_kind IN ('contact','agent','human','system'))
);
--> statement-breakpoint
CREATE INDEX `idx_wa_msg_conv` ON `whatsapp_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_wa_msg_org_status` ON `whatsapp_messages` (`org_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_messages_provider_id_per_org` ON `whatsapp_messages` (`org_id`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `idx_wa_msg_agent_pending` ON `whatsapp_messages` (`conversation_id`,`created_at`) WHERE agent_status IN ('pending','processing');--> statement-breakpoint
CREATE INDEX `idx_wa_msg_conv_dir_created` ON `whatsapp_messages` (`conversation_id`,`direction`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_id` text,
	`airtable_synced_at` integer,
	`contract_id` text,
	`eecc_code` text,
	`mes` text,
	`anio` integer,
	`issue_date` text,
	`due_date` text,
	`rent_amount` text,
	`additional_subtotal` text,
	`previous_rent_balance` text,
	`previous_addl_balance` text,
	`total_due` text,
	`send_status` text,
	`send_date` text,
	`pdf_url` text,
	`whatsapp_message_id` text,
	`send_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_account_statements_org` ON `account_statements` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_account_statements_contract` ON `account_statements` (`contract_id`);--> statement-breakpoint
CREATE INDEX `idx_account_statements_date` ON `account_statements` (`org_id`,`anio`,`mes`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_account_statements_airtable` ON `account_statements` (`org_id`,`airtable_id`);--> statement-breakpoint
CREATE TABLE `additional_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_id` text,
	`airtable_synced_at` integer,
	`contract_id` text,
	`concept_id` text,
	`mes` text,
	`anio` integer,
	`amount` text NOT NULL,
	`description` text,
	`numero` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`concept_id`) REFERENCES `charge_concepts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_additional_charges_org` ON `additional_charges` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_additional_charges_contract` ON `additional_charges` (`contract_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_additional_charges_airtable` ON `additional_charges` (`org_id`,`airtable_id`);--> statement-breakpoint
CREATE TABLE `ai_token_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`day` text NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`cost_usd` text DEFAULT '0' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_token_budget_tokens_used_check" CHECK(tokens_used >= 0),
	CONSTRAINT "ai_token_budget_cost_usd_check" CHECK(CAST(cost_usd AS REAL) >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ai_token_budget_org_day` ON `ai_token_budget` (`org_id`,`day`);--> statement-breakpoint
CREATE INDEX `idx_ai_token_budget_org` ON `ai_token_budget` (`org_id`,`day`);--> statement-breakpoint
CREATE TABLE `charge_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_id` text,
	`airtable_synced_at` integer,
	`code` text,
	`description` text NOT NULL,
	`tipo` text,
	`base_amount` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_charge_concepts_org` ON `charge_concepts` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_charge_concepts_airtable` ON `charge_concepts` (`org_id`,`airtable_id`);--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`period` text,
	`description` text,
	`amount` text NOT NULL,
	`due_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "charges_amount_check" CHECK(CAST(amount AS REAL) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_charges_org_id` ON `charges` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_charges_contract_id` ON `charges` (`contract_id`);--> statement-breakpoint
CREATE INDEX `idx_charges_tenant_period` ON `charges` (`tenant_id`,`period`);--> statement-breakpoint
CREATE TABLE `deposit_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`name` text,
	`banco` text,
	`tipo_cuenta` text,
	`moneda` text,
	`numero_cuenta` text,
	`cci` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deposit_accounts_org` ON `deposit_accounts` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deposit_accounts_org_airtable_uniq` ON `deposit_accounts` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_expense_categories_org` ON `expense_categories` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `expense_categories_org_name_uniq` ON `expense_categories` (`org_id`,`name`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text,
	`unit_id` text,
	`category_id` text,
	`amount` text NOT NULL,
	`description` text NOT NULL,
	`incurred_on` text NOT NULL,
	`receipt_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "expenses_amount_check" CHECK(CAST(amount AS REAL) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_expenses_org` ON `expenses` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_expenses_org_date` ON `expenses` (`org_id`,`incurred_on`);--> statement-breakpoint
CREATE INDEX `idx_expenses_property` ON `expenses` (`property_id`);--> statement-breakpoint
CREATE INDEX `idx_expenses_category` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE TABLE `import_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`import_type` text NOT NULL,
	`file_name` text,
	`imported_by` text,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`rows_received` integer DEFAULT 0,
	`rows_created` integer DEFAULT 0,
	`rows_updated` integer DEFAULT 0,
	`rows_skipped` integer DEFAULT 0,
	`rows_failed` integer DEFAULT 0,
	`validation_warnings` text DEFAULT '[]',
	`error_details` text DEFAULT '[]',
	`airtable_sync_result` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_logs_import_type_check" CHECK(import_type IN ('tenant','payment','room_performance','financial')),
	CONSTRAINT "import_logs_status_check" CHECK(status IN ('pending','completed','failed','partial'))
);
--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`source` text DEFAULT 'whatsapp' NOT NULL,
	`whatsapp_message_id` text,
	`image_path` text NOT NULL,
	`image_sha256` text NOT NULL,
	`extracted_amount` text,
	`extracted_date` text,
	`extracted_vendor` text,
	`confidence` text,
	`matched_charge_id` text,
	`matched_payment_id` text,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`rejection_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`whatsapp_message_id`) REFERENCES `whatsapp_messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payment_receipts_source_check" CHECK(source IN ('whatsapp', 'manual')),
	CONSTRAINT "payment_receipts_status_check" CHECK(status IN ('pending_review','auto_approved','admin_approved','rejected','duplicate_rejected'))
);
--> statement-breakpoint
CREATE INDEX `idx_pr_org_status` ON `payment_receipts` (`org_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pr_tenant` ON `payment_receipts` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pr_sha256` ON `payment_receipts` (`image_sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_receipts_sha256_per_org` ON `payment_receipts` (`org_id`,`image_sha256`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`amount` text NOT NULL,
	`paid_at` text NOT NULL,
	`method` text DEFAULT 'transfer' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`reference` text,
	`currency` text DEFAULT 'PEN' NOT NULL,
	`receipt_url` text,
	`movement_type` text DEFAULT 'payment' NOT NULL,
	`external_payment_id` text,
	`import_source` text DEFAULT 'manual',
	`import_id` text,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_id`) REFERENCES `import_logs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payments_amount_check" CHECK(CAST(amount AS REAL) > 0),
	CONSTRAINT "payments_method_check" CHECK(method IN ('cash', 'transfer', 'card', 'other')),
	CONSTRAINT "payments_status_check" CHECK(status IN ('pending','approved','under_review','rejected')),
	CONSTRAINT "payments_movement_type_check" CHECK(movement_type IN ('rent_charge','payment','partial_payment','deposit','sanction','discount','adjustment','refund','other')),
	CONSTRAINT "payments_import_source_check" CHECK(import_source IN ('manual','csv_import','airtable','google_onboarding'))
);
--> statement-breakpoint
CREATE INDEX `idx_payments_org_id` ON `payments` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_contract_id` ON `payments` (`contract_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_tenant_id` ON `payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_org_status` ON `payments` (`org_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_org_airtable_uniq` ON `payments` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_org_external_id_uidx` ON `payments` (`org_id`,`external_payment_id`);--> statement-breakpoint
CREATE TABLE `receipt_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`payment_id` text,
	`uploaded_by` text NOT NULL,
	`file_path` text NOT NULL,
	`ocr_status` text DEFAULT 'pending' NOT NULL,
	`extracted_amount` text,
	`extracted_date` text,
	`extracted_vendor` text,
	`confidence` text,
	`ocr_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "receipt_uploads_ocr_status_check" CHECK(ocr_status IN ('pending','processing','extracted','failed','matched')),
	CONSTRAINT "receipt_uploads_confidence_check" CHECK(CAST(confidence AS REAL) >= 0 AND CAST(confidence AS REAL) <= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_receipt_uploads_org` ON `receipt_uploads` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_receipt_uploads_org_status` ON `receipt_uploads` (`org_id`,`ocr_status`);--> statement-breakpoint
CREATE INDEX `idx_receipt_uploads_payment` ON `receipt_uploads` (`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_receipt_uploads_uploader` ON `receipt_uploads` (`uploaded_by`);--> statement-breakpoint
CREATE TABLE `sanctions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`proposed_by` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`amount` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`linked_charge_id` text,
	`approved_by` text,
	`approved_at` integer,
	`dispute_reason` text,
	`disputed_at` integer,
	`resolution_note` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`linked_charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sanctions_kind_check" CHECK(kind IN ('monetary','warning')),
	CONSTRAINT "sanctions_status_check" CHECK(status IN ('proposed','approved','rejected','disputed','resolved')),
	CONSTRAINT "sanctions_monetary_amount" CHECK(kind <> 'monetary' OR amount IS NOT NULL),
	CONSTRAINT "sanctions_warning_no_amount" CHECK(kind <> 'warning' OR amount IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sanctions_linked_charge_id_unique` ON `sanctions` (`linked_charge_id`);--> statement-breakpoint
CREATE INDEX `idx_sanctions_org_status` ON `sanctions` (`org_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sanctions_tenant` ON `sanctions` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `service_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`service_type` text NOT NULL,
	`supply_number` text,
	`tope` text,
	`monthly_data` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "service_payments_service_type_check" CHECK(service_type IN ('agua','internet','gas','luz','otro'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_payments_org_airtable_uniq` ON `service_payments` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `tax_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_id` text,
	`airtable_synced_at` integer,
	`contract_id` text,
	`receipt_code` text,
	`tipo` text,
	`numero` text,
	`mes` text,
	`anio` integer,
	`issue_date` text,
	`base_amount` text,
	`includes_igv` integer DEFAULT false,
	`igv_amount` text,
	`total_amount` text,
	`status` text,
	`file_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tax_receipts_org` ON `tax_receipts` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_tax_receipts_contract` ON `tax_receipts` (`contract_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_receipts_airtable` ON `tax_receipts` (`org_id`,`airtable_id`);--> statement-breakpoint
CREATE TABLE `absences` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`name` text,
	`tenant_id` text,
	`fecha_inicio` text,
	`fecha_fin` text,
	`estado` text,
	`registrado` integer,
	`motivo` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_absences_org` ON `absences` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `absences_org_airtable_uniq` ON `absences` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `account_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`external_account` text NOT NULL,
	`internal_category` text,
	`is_income` integer DEFAULT false NOT NULL,
	`affects_net_profit` integer DEFAULT true NOT NULL,
	`created_by` text,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_account_mappings_org` ON `account_mappings` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_mappings_org_account_uq` ON `account_mappings` (`org_id`,`external_account`);--> statement-breakpoint
CREATE TABLE `ai_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_chat_messages_role_check" CHECK(role IN ('user','assistant'))
);
--> statement-breakpoint
CREATE INDEX `idx_ai_chat_org` ON `ai_chat_messages` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_chat_session_ts` ON `ai_chat_messages` (`profile_id`,`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `airtable_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`table_name` text NOT NULL,
	`external_id` text NOT NULL,
	`data` text NOT NULL,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_airtable_snapshots_org_table` ON `airtable_snapshots` (`org_id`,`table_name`);--> statement-breakpoint
CREATE INDEX `idx_airtable_snapshots_synced_at` ON `airtable_snapshots` (`org_id`,`synced_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_snapshots_org_table_external_uq` ON `airtable_snapshots` (`org_id`,`table_name`,`external_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_by` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`property_id` text,
	`unit_id` text,
	`published_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "announcements_audience_check" CHECK(audience IN ('all','property','unit'))
);
--> statement-breakpoint
CREATE INDEX `idx_announcements_org` ON `announcements` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_announcements_org_pub` ON `announcements` (`org_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_announcements_property` ON `announcements` (`property_id`);--> statement-breakpoint
CREATE INDEX `idx_announcements_unit` ON `announcements` (`unit_id`);--> statement-breakpoint
CREATE TABLE `cleaning_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`unit_id` text,
	`assigned_to` text,
	`title` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_to`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cleaning_tasks_status_check" CHECK(status IN ('pending','in_progress','done'))
);
--> statement-breakpoint
CREATE INDEX `idx_cleaning_tasks_org` ON `cleaning_tasks` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_cleaning_tasks_org_date` ON `cleaning_tasks` (`org_id`,`scheduled_date`);--> statement-breakpoint
CREATE INDEX `idx_cleaning_tasks_unit` ON `cleaning_tasks` (`unit_id`);--> statement-breakpoint
CREATE INDEX `idx_cleaning_tasks_assignee` ON `cleaning_tasks` (`assigned_to`);--> statement-breakpoint
CREATE TABLE `community_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `community_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_community_comments_org` ON `community_comments` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_community_comments_post_ts` ON `community_comments` (`post_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `community_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "community_posts_category_check" CHECK(category IN ('general','question','marketplace','event'))
);
--> statement-breakpoint
CREATE INDEX `idx_community_posts_org` ON `community_posts` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_community_posts_org_pinned` ON `community_posts` (`org_id`,`pinned`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_community_posts_author` ON `community_posts` (`author_id`);--> statement-breakpoint
CREATE TABLE `contract_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`body_markdown` text NOT NULL,
	`variables` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contract_templates_org` ON `contract_templates` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contract_templates_org_name_uniq` ON `contract_templates` (`org_id`,`name`);--> statement-breakpoint
CREATE TABLE `csv_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`import_type` text NOT NULL,
	`original_filename` text NOT NULL,
	`period` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_summary` text DEFAULT '[]' NOT NULL,
	`committed_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "csv_imports_import_type_check" CHECK(import_type IN ('monthly_billed','monthly_collected','monthly_summary','room_performance')),
	CONSTRAINT "csv_imports_status_check" CHECK(status IN ('dry_run','committed','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_csv_imports_org_created` ON `csv_imports` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_csv_imports_org_status` ON `csv_imports` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`raw_data` text NOT NULL,
	`normalized_data` text,
	`status` text NOT NULL,
	`error_detail` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `csv_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "import_rows_status_check" CHECK(status IN ('ok','warning','error'))
);
--> statement-breakpoint
CREATE INDEX `idx_import_rows_import_id` ON `import_rows` (`import_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `idx_import_rows_status` ON `import_rows` (`import_id`,`status`);--> statement-breakpoint
CREATE TABLE `incident_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "incident_comments_body_check" CHECK(length(body) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_incident_comments_org_id` ON `incident_comments` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_incident_comments_incident_time` ON `incident_comments` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`unit_id` text,
	`property_id` text,
	`created_by` text,
	`tenant_id` text,
	`assigned_to` text,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`photo_path` text,
	`resolved_at` integer,
	`cost` text,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_to`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "incidents_category_check" CHECK(category IN ('plumbing','electrical','appliance','structural','cleaning','other','material_damage','malfunction')),
	CONSTRAINT "incidents_priority_check" CHECK(priority IN ('low','medium','high','urgent')),
	CONSTRAINT "incidents_status_check" CHECK(status IN ('pending','in_progress','solved'))
);
--> statement-breakpoint
CREATE INDEX `idx_incidents_org_id` ON `incidents` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_incidents_org_status` ON `incidents` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_incidents_created_by` ON `incidents` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_incidents_assigned_to` ON `incidents` (`assigned_to`);--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_org_airtable_uniq` ON `incidents` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `internal_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`content` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_internal_notes_tenant` ON `internal_notes` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_internal_notes_org` ON `internal_notes` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`related_type` text,
	`related_id` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notification_inbox_org` ON `notification_inbox` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_notification_inbox_profile_read` ON `notification_inbox` (`profile_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `idx_notification_inbox_profile_ts` ON `notification_inbox` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `owners` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`name` text,
	`dni` text,
	`phone` text,
	`email` text,
	`co_owner_name` text,
	`co_owner_dni` text,
	`co_owner_phone` text,
	`co_owner_email` text,
	`mancomunacion` text,
	`apoderamiento` text,
	`domicilio` text,
	`distrito` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_owners_org` ON `owners` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `owners_org_airtable_uniq` ON `owners` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `phantom_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`raw_room_label` text NOT NULL,
	`matched_unit_id` text,
	`resolution` text DEFAULT 'pending' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "phantom_rooms_resolution_check" CHECK(resolution IN ('pending','mapped','ignored'))
);
--> statement-breakpoint
CREATE INDEX `idx_phantom_rooms_org_resolution` ON `phantom_rooms` (`org_id`,`resolution`);--> statement-breakpoint
CREATE UNIQUE INDEX `phantom_rooms_org_label_uq` ON `phantom_rooms` (`org_id`,`raw_room_label`);--> statement-breakpoint
CREATE TABLE `pricing_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`property_type` text NOT NULL,
	`market_zone` text NOT NULL,
	`tiers` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pricing_tables_org` ON `pricing_tables` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_pricing_tables_org_type` ON `pricing_tables` (`org_id`,`property_type`,`market_zone`);--> statement-breakpoint
CREATE TABLE `property_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`external_name` text NOT NULL,
	`internal_property_id` text,
	`last_matched_at` integer,
	`created_by` text,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`internal_property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_property_mappings_org` ON `property_mappings` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_mappings_org_name_uq` ON `property_mappings` (`org_id`,`external_name`);--> statement-breakpoint
CREATE TABLE `property_weekly_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text NOT NULL,
	`iso_week` text NOT NULL,
	`body` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_weekly_summaries_property_week_uq` ON `property_weekly_summaries` (`property_id`,`iso_week`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`channel` text DEFAULT 'both' NOT NULL,
	`scheduled_for` text NOT NULL,
	`sent_at` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`message_preview` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reminders_type_check" CHECK(type IN ('lease_renewal','payment_due','custom')),
	CONSTRAINT "reminders_target_type_check" CHECK(target_type IN ('contract','charge','tenant')),
	CONSTRAINT "reminders_channel_check" CHECK(channel IN ('email','in_app','both')),
	CONSTRAINT "reminders_status_check" CHECK(status IN ('scheduled','sent','failed','skipped'))
);
--> statement-breakpoint
CREATE INDEX `idx_reminders_org` ON `reminders` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_reminders_org_date_status` ON `reminders` (`org_id`,`scheduled_for`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reminders_target` ON `reminders` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `signature_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`signer_profile_id` text,
	`signer_email` text NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`sent_at` integer NOT NULL,
	`viewed_at` integer,
	`signed_at` integer,
	`expires_at` integer NOT NULL,
	`signature_image_path` text,
	`signed_ip` text,
	`signed_user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signer_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "signature_requests_status_check" CHECK(status IN ('sent','viewed','signed','declined','expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signature_requests_token_unique` ON `signature_requests` (`token`);--> statement-breakpoint
CREATE INDEX `idx_signature_requests_org` ON `signature_requests` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_signature_requests_contract` ON `signature_requests` (`contract_id`);--> statement-breakpoint
CREATE TABLE `task_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`task_id` text NOT NULL,
	`whatsapp_message_id` text,
	`image_path` text NOT NULL,
	`ai_verdict` text,
	`ai_confidence` text,
	`admin_decision` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tenant_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`whatsapp_message_id`) REFERENCES `whatsapp_messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "task_proofs_ai_verdict_check" CHECK(ai_verdict IN ('valid','invalid','uncertain')),
	CONSTRAINT "task_proofs_admin_decision_check" CHECK(admin_decision IN ('accepted','rejected'))
);
--> statement-breakpoint
CREATE INDEX `idx_tp_task` ON `task_proofs` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tp_org` ON `task_proofs` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tenant_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_id` text,
	`airtable_synced_at` integer,
	`tenant_id` text,
	`fecha` text,
	`cleaning_score` integer,
	`coexistence_score` integer,
	`attention_score` integer,
	`security_score` integer,
	`value_score` integer,
	`would_recommend` integer,
	`comment` text,
	`worst_experience` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tenant_feedback_cleaning_score_check" CHECK(cleaning_score BETWEEN 1 AND 5),
	CONSTRAINT "tenant_feedback_coexistence_score_check" CHECK(coexistence_score BETWEEN 1 AND 5),
	CONSTRAINT "tenant_feedback_attention_score_check" CHECK(attention_score BETWEEN 1 AND 5),
	CONSTRAINT "tenant_feedback_security_score_check" CHECK(security_score BETWEEN 1 AND 5),
	CONSTRAINT "tenant_feedback_value_score_check" CHECK(value_score BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE INDEX `idx_tenant_feedback_org` ON `tenant_feedback` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_tenant_feedback_tenant` ON `tenant_feedback` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_feedback_airtable` ON `tenant_feedback` (`org_id`,`airtable_id`);--> statement-breakpoint
CREATE TABLE `tenant_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tenant_invitations_status_check" CHECK(status IN ('pending','accepted','expired','revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_invitations_token_hash_uidx` ON `tenant_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `tenant_invitations_tenant_idx` ON `tenant_invitations` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `tenant_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`created_by` text NOT NULL,
	`task_type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_at` integer NOT NULL,
	`reminder_sent_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tenant_tasks_task_type_check" CHECK(task_type IN ('maintenance','document','inspection','cleanup','custom')),
	CONSTRAINT "tenant_tasks_status_check" CHECK(status IN ('pending','in_progress','proof_pending_review','completed','expired','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_tt_org_status` ON `tenant_tasks` (`org_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_tt_tenant` ON `tenant_tasks` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tt_due_at` ON `tenant_tasks` (`due_at`);--> statement-breakpoint
CREATE TABLE `trash_compliance` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`name` text,
	`trash_schedule_id` text,
	`tenant_id` text,
	`fecha` text,
	`estado` text,
	`foto_url` text,
	`hora_confirmacion` integer,
	`hash_imagen` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trash_schedule_id`) REFERENCES `trash_schedules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_trash_compliance_org` ON `trash_compliance` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trash_compliance_org_airtable_uniq` ON `trash_compliance` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `trash_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`airtable_external_id` text,
	`airtable_synced_at` integer,
	`name` text,
	`tenant_id` text,
	`unit_id` text,
	`zona` text,
	`dias` text,
	`activo` integer DEFAULT true NOT NULL,
	`turnos_extra` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_trash_schedules_org` ON `trash_schedules` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trash_schedules_org_airtable_uniq` ON `trash_schedules` (`org_id`,`airtable_external_id`);--> statement-breakpoint
CREATE TABLE `unit_images` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`org_id` text NOT NULL,
	`storage_path` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_cover` integer DEFAULT false NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_unit_images_unit` ON `unit_images` (`unit_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_unit_images_org` ON `unit_images` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unit_images_cover_idx` ON `unit_images` (`unit_id`) WHERE is_cover = 1;--> statement-breakpoint
CREATE TABLE `visitor_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`property_id` text,
	`unit_id` text,
	`visitor_name` text NOT NULL,
	`host_tenant_id` text,
	`visit_date` text NOT NULL,
	`entry_time` integer,
	`exit_time` integer,
	`purpose` text,
	`created_by` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`host_tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_visitor_logs_org` ON `visitor_logs` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_visitor_logs_org_date` ON `visitor_logs` (`org_id`,`visit_date`);--> statement-breakpoint
CREATE INDEX `idx_visitor_logs_unit` ON `visitor_logs` (`unit_id`);--> statement-breakpoint
CREATE INDEX `idx_visitor_logs_host` ON `visitor_logs` (`host_tenant_id`);--> statement-breakpoint
CREATE TABLE `agent_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`persona` text DEFAULT 'Asistente inmobiliario' NOT NULL,
	`tone` text DEFAULT 'profesional' NOT NULL,
	`rules` text,
	`prohibited` text,
	`faq` text DEFAULT '[]' NOT NULL,
	`business_hours` text DEFAULT '{}' NOT NULL,
	`timezone` text DEFAULT 'America/Lima' NOT NULL,
	`qualification_fields` text DEFAULT '["operation_type","zones","budget_max","bedrooms_min","timeline"]' NOT NULL,
	`followup_policy` text DEFAULT '{}' NOT NULL,
	`routing_mode` text DEFAULT 'round_robin' NOT NULL,
	`daily_token_budget` integer DEFAULT 50000 NOT NULL,
	`widget_allowed_origins` text DEFAULT '[]' NOT NULL,
	`channels_enabled` text DEFAULT '{"whatsapp":false,"web":false,"voice":false}' NOT NULL,
	`shadow_mode` integer DEFAULT false NOT NULL,
	`max_agent_turns` integer DEFAULT 30,
	`public_pages_enabled` integer DEFAULT false NOT NULL,
	`voice_config` text DEFAULT '{}' NOT NULL,
	`max_active_visits_per_phone` integer DEFAULT 2 NOT NULL,
	`max_listing_photos` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_configs_tone_check" CHECK(tone IN ('profesional','cercano','formal')),
	CONSTRAINT "agent_configs_routing_mode_check" CHECK(routing_mode IN ('round_robin','weighted','manual')),
	CONSTRAINT "agent_configs_daily_token_budget_check" CHECK(daily_token_budget > 0),
	CONSTRAINT "agent_configs_max_agent_turns_check" CHECK(max_agent_turns IS NULL OR max_agent_turns > 0),
	CONSTRAINT "agent_configs_max_active_visits_per_phone_check" CHECK(max_active_visits_per_phone BETWEEN 1 AND 10),
	CONSTRAINT "agent_configs_max_listing_photos_check" CHECK(max_listing_photos BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_configs_org_id_unique` ON `agent_configs` (`org_id`);--> statement-breakpoint
CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`actor_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_events_session` ON `agent_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_events_org_kind_ts` ON `agent_events` (`org_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`kind` text NOT NULL,
	`run_at` integer NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_jobs_due` ON `agent_jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_jobs_org` ON `agent_jobs` (`org_id`);--> statement-breakpoint
CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` text,
	`send_status` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_messages_role_check" CHECK(role IN ('user','assistant')),
	CONSTRAINT "agent_messages_send_status_check" CHECK(send_status IS NULL OR send_status IN ('sent','shadow_pending','shadow_discarded'))
);
--> statement-breakpoint
CREATE INDEX `idx_agent_messages_session` ON `agent_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_messages_org_created` ON `agent_messages` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`lead_id` text,
	`whatsapp_conversation_id` text,
	`mode` text DEFAULT 'ai' NOT NULL,
	`summary` text,
	`window_expires_at` integer,
	`processing_locked_until` integer,
	`agent_turn_count` integer DEFAULT 0 NOT NULL,
	`language` text,
	`attribution` text,
	`handoff_reason` text,
	`last_inbound_at` integer,
	`last_agent_turn_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`whatsapp_conversation_id`) REFERENCES `whatsapp_conversations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_sessions_channel_check" CHECK(channel IN ('whatsapp','web','voice')),
	CONSTRAINT "agent_sessions_mode_check" CHECK(mode IN ('ai','human','paused')),
	CONSTRAINT "agent_sessions_language_check" CHECK(language IS NULL OR language IN ('es','en','pt')),
	CONSTRAINT "agent_sessions_handoff_reason_check" CHECK(handoff_reason IS NULL OR handoff_reason IN ('tool','budget','turn_cap','manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_sessions_channel_external` ON `agent_sessions` (`org_id`,`channel`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_org` ON `agent_sessions` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_lead` ON `agent_sessions` (`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_org_inbound` ON `agent_sessions` (`org_id`,`last_inbound_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_org_channel_created` ON `agent_sessions` (`org_id`,`channel`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`session_id` text NOT NULL,
	`whatsapp_conversation_id` text,
	`agent_message_id` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`sent_message_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`whatsapp_conversation_id`) REFERENCES `whatsapp_conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_message_id`) REFERENCES `agent_messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sent_message_id`) REFERENCES `whatsapp_messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_suggestions_status_check" CHECK(status IN ('pending','sending','sent','discarded','superseded'))
);
--> statement-breakpoint
CREATE INDEX `idx_agent_suggestions_session` ON `agent_suggestions` (`session_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_suggestions_one_pending` ON `agent_suggestions` (`session_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `listing_images` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`storage_path` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_cover` integer DEFAULT false NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_listing_images_listing` ON `listing_images` (`listing_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_listing_images_org` ON `listing_images` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `listing_images_cover_idx` ON `listing_images` (`listing_id`) WHERE is_cover = 1;--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`unit_id` text,
	`property_id` text,
	`operation` text NOT NULL,
	`price` text,
	`currency` text DEFAULT 'PEN' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`status_override` integer DEFAULT false NOT NULL,
	`title` text,
	`description` text,
	`zone` text,
	`bedrooms` integer,
	`bathrooms` integer,
	`area_m2` text,
	`parking` integer DEFAULT false NOT NULL,
	`maintenance_fee` text,
	`pets_allowed` integer,
	`public_slug` text,
	`published` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`ref_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "listings_operation_check" CHECK(operation IN ('rent','sale')),
	CONSTRAINT "listings_price_check" CHECK(price IS NULL OR CAST(price AS REAL) >= 0),
	CONSTRAINT "listings_status_check" CHECK(status IN ('available','reserved','closed')),
	CONSTRAINT "listings_bedrooms_check" CHECK(bedrooms IS NULL OR bedrooms >= 0),
	CONSTRAINT "listings_bathrooms_check" CHECK(bathrooms IS NULL OR bathrooms >= 0),
	CONSTRAINT "listings_area_m2_check" CHECK(area_m2 IS NULL OR CAST(area_m2 AS REAL) >= 0),
	CONSTRAINT "listings_maintenance_fee_check" CHECK(maintenance_fee IS NULL OR CAST(maintenance_fee AS REAL) >= 0),
	CONSTRAINT "chk_listings_has_target" CHECK(unit_id IS NOT NULL OR property_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_listings_org` ON `listings` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_listings_org_published` ON `listings` (`org_id`,`published`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `listings_org_unit_uniq` ON `listings` (`org_id`,`unit_id`) WHERE unit_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `listings_org_slug_uniq` ON `listings` (`org_id`,`public_slug`) WHERE public_slug IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `listings_org_ref_code_uniq` ON `listings` (`org_id`,`ref_code`) WHERE ref_code IS NOT NULL;--> statement-breakpoint
CREATE TABLE `org_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_channels_channel_external_id` ON `org_channels` (`channel`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_org_channels_org` ON `org_channels` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_channels_one_web_per_org` ON `org_channels` (`org_id`) WHERE channel = 'web';--> statement-breakpoint
CREATE UNIQUE INDEX `org_channels_one_whatsapp_per_org` ON `org_channels` (`org_id`) WHERE channel = 'whatsapp';--> statement-breakpoint
CREATE UNIQUE INDEX `org_channels_one_voice_per_org` ON `org_channels` (`org_id`) WHERE channel = 'voice';--> statement-breakpoint
CREATE TABLE `agent_advisor_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`accepts_visits` integer DEFAULT true NOT NULL,
	`visit_minutes` integer DEFAULT 45 NOT NULL,
	`buffer_minutes` integer DEFAULT 15 NOT NULL,
	`min_notice_minutes` integer DEFAULT 120 NOT NULL,
	`days_ahead` integer DEFAULT 14 NOT NULL,
	`slot_step_minutes` integer DEFAULT 30 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_advisor_settings_visit_minutes_check" CHECK(visit_minutes BETWEEN 10 AND 240),
	CONSTRAINT "agent_advisor_settings_buffer_minutes_check" CHECK(buffer_minutes BETWEEN 0 AND 120),
	CONSTRAINT "agent_advisor_settings_min_notice_minutes_check" CHECK(min_notice_minutes >= 0),
	CONSTRAINT "agent_advisor_settings_days_ahead_check" CHECK(days_ahead BETWEEN 1 AND 60),
	CONSTRAINT "agent_advisor_settings_slot_step_minutes_check" CHECK(slot_step_minutes IN (15, 30, 60))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_advisor_settings_org_profile_uidx` ON `agent_advisor_settings` (`org_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `agent_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_availability_weekday_check" CHECK(weekday BETWEEN 0 AND 6),
	CONSTRAINT "agent_availability_start_minute_check" CHECK(start_minute BETWEEN 0 AND 1439),
	CONSTRAINT "agent_availability_end_minute_check" CHECK(end_minute BETWEEN 1 AND 1440),
	CONSTRAINT "agent_availability_end_after_start" CHECK(end_minute > start_minute)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_availability_org_profile` ON `agent_availability` (`org_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `agent_availability_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`kind` text NOT NULL,
	`reason` text,
	`created_by_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_availability_exceptions_kind_check" CHECK(kind IN ('block', 'extra')),
	CONSTRAINT "agent_availability_exceptions_ends_after_starts" CHECK(ends_at > starts_at)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_availability_exceptions_org_profile_starts` ON `agent_availability_exceptions` (`org_id`,`profile_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `agent_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`session_id` text,
	`lead_id` text,
	`visit_id` text,
	`direction` text NOT NULL,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`block_reason` text,
	`dedupe_key` text,
	`vapi_call_id` text,
	`phone_number_id` text,
	`customer_phone` text,
	`started_at` integer,
	`ended_at` integer,
	`duration_seconds` integer,
	`ended_reason` text,
	`outcome` text,
	`transcript` text,
	`recording_url` text,
	`summary` text,
	`cost_usd` text,
	`cost_breakdown` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`visit_id`) REFERENCES `property_visits`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_calls_direction_check" CHECK(direction IN ('inbound', 'outbound')),
	CONSTRAINT "agent_calls_purpose_check" CHECK(purpose IN ('inbound', 'speed_to_lead', 'visit_confirmation', 'reactivation')),
	CONSTRAINT "agent_calls_status_check" CHECK(status IN ('queued', 'dialing', 'in_progress', 'ended', 'failed', 'skipped', 'blocked')),
	CONSTRAINT "agent_calls_duration_seconds_check" CHECK(duration_seconds IS NULL OR duration_seconds >= 0),
	CONSTRAINT "agent_calls_outcome_check" CHECK(outcome IS NULL OR outcome IN ('answered', 'no_answer', 'busy', 'voicemail', 'failed', 'abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_calls_vapi_call_id_unique` ON `agent_calls` (`vapi_call_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_calls_dedupe` ON `agent_calls` (`org_id`,`dedupe_key`) WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_agent_calls_org_created` ON `agent_calls` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_calls_org_status` ON `agent_calls` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_calls_lead` ON `agent_calls` (`lead_id`);--> statement-breakpoint
CREATE TABLE `agent_session_listings` (
	`session_id` text NOT NULL,
	`org_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `listing_id`),
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_session_listings_source_check" CHECK(source IN ('search', 'attribution', 'page'))
);
--> statement-breakpoint
CREATE TABLE `agent_web_handoff_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`web_session_id` text,
	`code` text NOT NULL,
	`kind` text NOT NULL,
	`lead_id` text,
	`listing_id` text,
	`profile_id` text,
	`starts_at` integer,
	`visit_minutes` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`redeemed_phone` text,
	`redeemed_session_id` text,
	`visit_id` text,
	`result` text,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	`created_at` integer NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`call_id` text,
	`target_phone` text,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`web_session_id`) REFERENCES `agent_web_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`redeemed_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`visit_id`) REFERENCES `property_visits`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`call_id`) REFERENCES `agent_calls`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_web_handoff_codes_kind_check" CHECK(kind IN ('visit', 'continue')),
	CONSTRAINT "agent_web_handoff_codes_status_check" CHECK(status IN ('pending', 'redeemed', 'failed', 'expired', 'superseded')),
	CONSTRAINT "chk_web_handoff_visit" CHECK(kind <> 'visit' OR (starts_at IS NOT NULL AND profile_id IS NOT NULL AND visit_minutes IS NOT NULL)),
	CONSTRAINT "agent_web_handoff_codes_source_check" CHECK(source IN ('web', 'voice')),
	CONSTRAINT "chk_handoff_source" CHECK((source = 'web' AND web_session_id IS NOT NULL) OR (source = 'voice' AND call_id IS NOT NULL AND target_phone IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_web_handoff_code` ON `agent_web_handoff_codes` (`org_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_web_handoff_session` ON `agent_web_handoff_codes` (`web_session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_handoff_voice_phone` ON `agent_web_handoff_codes` (`org_id`,`target_phone`,`status`) WHERE source = 'voice';--> statement-breakpoint
CREATE TABLE `agent_web_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`agent_session_id` text,
	`ip_hash` text,
	`origin` text,
	`page_url` text,
	`current_listing_id` text,
	`phone_e164` text,
	`phone_captured_at` integer,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`processing_until` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`current_listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_web_sessions_page_url_check" CHECK(page_url IS NULL OR length(page_url) <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_web_sessions_token_hash_unique` ON `agent_web_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_agent_web_sessions_org` ON `agent_web_sessions` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_web_usage_daily` (
	`org_id` text NOT NULL,
	`day` text NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`org_id`, `day`),
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `calendar_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`provider` text DEFAULT 'google' NOT NULL,
	`google_email` text NOT NULL,
	`calendar_id` text DEFAULT 'primary' NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`access_token_enc` text,
	`access_token_expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`last_error` text,
	`freebusy_enabled` integer DEFAULT true NOT NULL,
	`write_events` integer DEFAULT true NOT NULL,
	`sync_token` text,
	`sync_page_token` text,
	`last_synced_at` integer,
	`last_full_sync_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_connections_provider_check" CHECK(provider IN ('google')),
	CONSTRAINT "calendar_connections_status_check" CHECK(status IN ('active', 'revoked', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_connections_org_profile_uidx` ON `calendar_connections` (`org_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `idx_calendar_connections_org_status` ON `calendar_connections` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `lead_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`profile_id` text,
	`previous_profile_id` text,
	`method` text,
	`assigned_by_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`previous_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lead_assignments_method_check" CHECK(method IN ('round_robin', 'weighted', 'manual', 'visit', 'reassign'))
);
--> statement-breakpoint
CREATE INDEX `idx_lead_assignments_org_created` ON `lead_assignments` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_lead_assignments_lead` ON `lead_assignments` (`lead_id`);--> statement-breakpoint
CREATE TABLE `lead_followups` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`session_id` text,
	`sequence_anchor_at` integer NOT NULL,
	`step` integer NOT NULL,
	`kind` text NOT NULL,
	`template_name` text,
	`scheduled_for` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`stop_reason` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lead_followups_step_check" CHECK(step BETWEEN 1 AND 10),
	CONSTRAINT "lead_followups_kind_check" CHECK(kind IN ('text', 'template')),
	CONSTRAINT "lead_followups_status_check" CHECK(status IN ('scheduled', 'sending', 'sent', 'skipped', 'cancelled', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_followups_lead_anchor_step_uniq` ON `lead_followups` (`lead_id`,`sequence_anchor_at`,`step`);--> statement-breakpoint
CREATE INDEX `idx_lead_followups_org_status_scheduled` ON `lead_followups` (`org_id`,`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `idx_lead_followups_lead_status` ON `lead_followups` (`lead_id`,`status`);--> statement-breakpoint
CREATE TABLE `lead_listing_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`status` text,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lead_listing_alerts_status_check" CHECK(status IN ('sent', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_listing_alerts_lead_listing_uniq` ON `lead_listing_alerts` (`lead_id`,`listing_id`);--> statement-breakpoint
CREATE TABLE `lead_pipeline_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`pipeline` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`color` text,
	`is_system` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lead_pipeline_stages_pipeline_check" CHECK(pipeline IN ('demand', 'supply')),
	CONSTRAINT "lead_pipeline_stages_key_check" CHECK((length(key) BETWEEN 2 AND 40 AND key GLOB '[a-z]*' AND key NOT GLOB '*[^a-z0-9_]*')),
	CONSTRAINT "lead_pipeline_stages_label_check" CHECK(length(label) BETWEEN 1 AND 60),
	CONSTRAINT "lead_pipeline_stages_kind_check" CHECK(kind IN ('open', 'won', 'lost')),
	CONSTRAINT "lead_pipeline_stages_color_check" CHECK(color IS NULL OR color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_pipeline_stages_org_pipeline_key_uniq` ON `lead_pipeline_stages` (`org_id`,`pipeline`,`key`);--> statement-breakpoint
CREATE INDEX `idx_lead_pipeline_stages_org_pipeline` ON `lead_pipeline_stages` (`org_id`,`pipeline`,`position`);--> statement-breakpoint
CREATE TABLE `lead_routing_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`pipeline` text DEFAULT 'both' NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`max_open_leads` integer,
	`assigned_count` integer DEFAULT 0 NOT NULL,
	`last_assigned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lead_routing_members_pipeline_check" CHECK(pipeline IN ('demand', 'supply', 'both')),
	CONSTRAINT "lead_routing_members_weight_check" CHECK(weight BETWEEN 1 AND 100),
	CONSTRAINT "lead_routing_members_max_open_leads_check" CHECK(max_open_leads IS NULL OR max_open_leads > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_routing_members_org_profile_uniq` ON `lead_routing_members` (`org_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `property_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`listing_id` text,
	`profile_id` text NOT NULL,
	`session_id` text,
	`contact_phone` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`blocked_until` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_by` text NOT NULL,
	`created_by_profile_id` text,
	`source_channel` text NOT NULL,
	`rescheduled_from_id` text,
	`google_event_id` text,
	`google_connection_id` text,
	`google_sync_status` text DEFAULT 'none' NOT NULL,
	`google_event_etag` text,
	`google_synced_at` integer,
	`google_sync_error` text,
	`google_drift_starts_at` integer,
	`google_drift_ends_at` integer,
	`notes` text,
	`cancel_reason` text,
	`feedback` text,
	`outcome_source` text,
	`confirmed_at` integer,
	`cancelled_at` integer,
	`completed_at` integer,
	`reminder_24h_sent_at` integer,
	`reminder_2h_sent_at` integer,
	`advisor_reminded_at` integer,
	`post_check_sent_at` integer,
	`feedback_requested_at` integer,
	`reoffer_sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rescheduled_from_id`) REFERENCES `property_visits`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`google_connection_id`) REFERENCES `calendar_connections`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "property_visits_status_check" CHECK(status IN ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled')),
	CONSTRAINT "property_visits_created_by_check" CHECK(created_by IN ('agent', 'human')),
	CONSTRAINT "property_visits_source_channel_check" CHECK(source_channel IN ('whatsapp', 'web', 'voice', 'manual')),
	CONSTRAINT "property_visits_feedback_check" CHECK(feedback IS NULL OR feedback IN ('interested', 'not_interested', 'wants_more')),
	CONSTRAINT "property_visits_outcome_source_check" CHECK(outcome_source IS NULL OR outcome_source IN ('staff', 'lead')),
	CONSTRAINT "property_visits_ends_after_starts" CHECK(ends_at > starts_at),
	CONSTRAINT "property_visits_blocked_after_ends" CHECK(blocked_until >= ends_at),
	CONSTRAINT "property_visits_google_sync_status_check" CHECK(google_sync_status IN ('none', 'pending', 'synced', 'error', 'detached', 'drift'))
);
--> statement-breakpoint
CREATE INDEX `idx_property_visits_org_starts` ON `property_visits` (`org_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_property_visits_org_profile_starts` ON `property_visits` (`org_id`,`profile_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_property_visits_lead` ON `property_visits` (`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_property_visits_org_phone_status` ON `property_visits` (`org_id`,`contact_phone`,`status`);--> statement-breakpoint
CREATE INDEX `idx_property_visits_org_created` ON `property_visits` (`org_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_visits_google_event_uniq` ON `property_visits` (`google_connection_id`,`google_event_id`) WHERE google_event_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_property_visits_google_pending` ON `property_visits` (`profile_id`,`updated_at`) WHERE google_sync_status IN ('pending', 'error');--> statement-breakpoint
CREATE TABLE `qa_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`week_start` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`row_count` integer,
	`handoff_count` integer,
	`complaint_count` integer,
	`takeover_count` integer,
	`csv` text NOT NULL,
	`emailed_at` integer,
	`email_recipient_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qa_exports_org_week_uniq` ON `qa_exports` (`org_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `voice_do_not_call` (
	`org_id` text NOT NULL,
	`phone_e164` text NOT NULL,
	`reason` text,
	`source` text NOT NULL,
	`added_by_profile_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`org_id`, `phone_e164`),
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "voice_do_not_call_phone_e164_check" CHECK((length(phone_e164) BETWEEN 8 AND 16 AND phone_e164 GLOB '+[1-9]*' AND substr(phone_e164, 2) NOT GLOB '*[^0-9]*')),
	CONSTRAINT "voice_do_not_call_reason_check" CHECK(reason IS NULL OR length(reason) <= 200),
	CONSTRAINT "voice_do_not_call_source_check" CHECK(source IN ('staff', 'caller_request'))
);
