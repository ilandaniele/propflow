-- Re-key legacy profiles so profiles.id = profiles.user_id (app code compares profile ids with users.id).
-- Every FK column that references profiles.id is moved first; FK checks are deferred to commit.
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
UPDATE `crm_leads` SET `assigned_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `crm_leads`.`assigned_profile_id`) WHERE `assigned_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `tenants` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `tenants`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `whatsapp_messages` SET `sent_by_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `whatsapp_messages`.`sent_by_profile_id`) WHERE `sent_by_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `import_logs` SET `imported_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `import_logs`.`imported_by`) WHERE `imported_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `payments` SET `approved_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `payments`.`approved_by`) WHERE `approved_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `receipt_uploads` SET `uploaded_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `receipt_uploads`.`uploaded_by`) WHERE `uploaded_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `sanctions` SET `proposed_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `sanctions`.`proposed_by`) WHERE `proposed_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `sanctions` SET `approved_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `sanctions`.`approved_by`) WHERE `approved_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `account_mappings` SET `created_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `account_mappings`.`created_by`) WHERE `created_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `ai_chat_messages` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `ai_chat_messages`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `announcements` SET `created_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `announcements`.`created_by`) WHERE `created_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `cleaning_tasks` SET `assigned_to` = (SELECT `user_id` FROM `profiles` WHERE `id` = `cleaning_tasks`.`assigned_to`) WHERE `assigned_to` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `community_comments` SET `author_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `community_comments`.`author_id`) WHERE `author_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `community_posts` SET `author_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `community_posts`.`author_id`) WHERE `author_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `csv_imports` SET `created_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `csv_imports`.`created_by`) WHERE `created_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `incident_comments` SET `author_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `incident_comments`.`author_id`) WHERE `author_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `incidents` SET `created_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `incidents`.`created_by`) WHERE `created_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `incidents` SET `assigned_to` = (SELECT `user_id` FROM `profiles` WHERE `id` = `incidents`.`assigned_to`) WHERE `assigned_to` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `internal_notes` SET `created_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `internal_notes`.`created_by`) WHERE `created_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `notification_inbox` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `notification_inbox`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `phantom_rooms` SET `resolved_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `phantom_rooms`.`resolved_by`) WHERE `resolved_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `property_mappings` SET `created_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `property_mappings`.`created_by`) WHERE `created_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `signature_requests` SET `signer_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `signature_requests`.`signer_profile_id`) WHERE `signer_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `tenant_invitations` SET `invited_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `tenant_invitations`.`invited_by`) WHERE `invited_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `tenant_tasks` SET `created_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `tenant_tasks`.`created_by`) WHERE `created_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `unit_images` SET `uploaded_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `unit_images`.`uploaded_by`) WHERE `uploaded_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `visitor_logs` SET `created_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `visitor_logs`.`created_by`) WHERE `created_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `agent_events` SET `actor_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `agent_events`.`actor_profile_id`) WHERE `actor_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `agent_suggestions` SET `decided_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `agent_suggestions`.`decided_by`) WHERE `decided_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `listing_images` SET `uploaded_by` = (SELECT `user_id` FROM `profiles` WHERE `id` = `listing_images`.`uploaded_by`) WHERE `uploaded_by` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `agent_advisor_settings` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `agent_advisor_settings`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `agent_availability` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `agent_availability`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `agent_availability_exceptions` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `agent_availability_exceptions`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `agent_availability_exceptions` SET `created_by_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `agent_availability_exceptions`.`created_by_profile_id`) WHERE `created_by_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `agent_web_handoff_codes` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `agent_web_handoff_codes`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `calendar_connections` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `calendar_connections`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `lead_assignments` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `lead_assignments`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `lead_assignments` SET `previous_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `lead_assignments`.`previous_profile_id`) WHERE `previous_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `lead_assignments` SET `assigned_by_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `lead_assignments`.`assigned_by_profile_id`) WHERE `assigned_by_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `lead_routing_members` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `lead_routing_members`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `property_visits` SET `profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `property_visits`.`profile_id`) WHERE `profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `property_visits` SET `created_by_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `property_visits`.`created_by_profile_id`) WHERE `created_by_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `voice_do_not_call` SET `added_by_profile_id` = (SELECT `user_id` FROM `profiles` WHERE `id` = `voice_do_not_call`.`added_by_profile_id`) WHERE `added_by_profile_id` IN (SELECT `id` FROM `profiles` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`);
--> statement-breakpoint
UPDATE `profiles` SET `id` = `user_id` WHERE `user_id` IS NOT NULL AND `id` <> `user_id`;
