-- Migration 000050: extend payments.status CHECK to include 'under_review' and 'rejected'
-- The original constraint (migration 000001) only allowed ('pending','approved').
-- CSV import sets status='under_review' — that was a latent bug; this fixes it.
-- The reject route also needs 'rejected'.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending','approved','under_review','rejected'));
