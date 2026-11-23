ALTER TABLE `charges` ADD `kind` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_charges_rent_contract_period` ON `charges` (`contract_id`,`period`) WHERE kind = 'rent';