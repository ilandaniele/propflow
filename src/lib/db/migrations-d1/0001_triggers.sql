-- Hand-written SQLite replacements for Postgres-only objects that drizzle-kit
-- cannot model. Source of each object in the old Postgres migrations:
--   property_visits_no_overlap_*  <- 0006 EXCLUDE USING gist (profile_id =, tstzrange(starts_at, blocked_until, '[)') &&) WHERE status IN ('scheduled','confirmed')
--   listings_set_published_at*    <- 0008 plpgsql trigger trg_listings_published_at
--   tenant_statement              <- 0002 view (per-tenant subqueries instead of the
--                                    charges x payments join, which double-counted)
-- Timestamps are integer epoch milliseconds (drizzle timestamp_ms).

CREATE TRIGGER `property_visits_no_overlap_insert`
BEFORE INSERT ON `property_visits`
WHEN NEW.status IN ('scheduled', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'visit_overlap')
  WHERE EXISTS (
    SELECT 1 FROM `property_visits` v
    WHERE v.profile_id = NEW.profile_id
      AND v.status IN ('scheduled', 'confirmed')
      AND v.starts_at < NEW.blocked_until
      AND NEW.starts_at < v.blocked_until
  );
END;
--> statement-breakpoint
CREATE TRIGGER `property_visits_no_overlap_update`
BEFORE UPDATE OF profile_id, starts_at, blocked_until, status ON `property_visits`
WHEN NEW.status IN ('scheduled', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'visit_overlap')
  WHERE EXISTS (
    SELECT 1 FROM `property_visits` v
    WHERE v.id <> NEW.id
      AND v.profile_id = NEW.profile_id
      AND v.status IN ('scheduled', 'confirmed')
      AND v.starts_at < NEW.blocked_until
      AND NEW.starts_at < v.blocked_until
  );
END;
--> statement-breakpoint
CREATE TRIGGER `listings_set_published_at_insert`
AFTER INSERT ON `listings`
WHEN NEW.published = 1
BEGIN
  UPDATE `listings`
  SET published_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `listings_set_published_at`
AFTER UPDATE OF published ON `listings`
WHEN NEW.published = 1 AND OLD.published IS NOT 1
BEGIN
  UPDATE `listings`
  SET published_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE VIEW `tenant_statement` AS
SELECT
  s.tenant_id,
  s.org_id,
  s.total_charges,
  s.total_approved_payments,
  s.total_approved_payments - s.total_charges AS balance,
  (
    s.total_approved_payments - s.total_charges < 0
    AND EXISTS (
      SELECT 1 FROM `charges` ch
      WHERE ch.tenant_id = s.tenant_id
        AND ch.due_date IS NOT NULL
        AND ch.due_date < date('now')
    )
  ) AS is_overdue
FROM (
  SELECT
    t.id AS tenant_id,
    t.org_id AS org_id,
    COALESCE((SELECT SUM(CAST(ch.amount AS REAL)) FROM `charges` ch WHERE ch.tenant_id = t.id), 0) AS total_charges,
    COALESCE((
      SELECT SUM(CASE WHEN p.status = 'approved' THEN CAST(p.amount AS REAL) END)
      FROM `payments` p WHERE p.tenant_id = t.id
    ), 0) AS total_approved_payments
  FROM `tenants` t
) s;
