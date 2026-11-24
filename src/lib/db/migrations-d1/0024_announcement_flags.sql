ALTER TABLE `announcements` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `announcements` ADD `important` integer DEFAULT false NOT NULL;