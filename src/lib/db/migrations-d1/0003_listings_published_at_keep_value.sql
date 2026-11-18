DROP TRIGGER `listings_set_published_at_insert`;--> statement-breakpoint
CREATE TRIGGER `listings_set_published_at_insert`
AFTER INSERT ON `listings`
WHEN NEW.published = 1 AND NEW.published_at IS NULL
BEGIN
  UPDATE `listings`
  SET published_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.id;
END;
