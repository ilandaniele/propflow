-- Migration 000013: reminders + notification_inbox + indexes
-- Phase 2 — Module 3: Operations Automation

-- ── reminders ─────────────────────────────────────────────────────────────────
CREATE TABLE public.reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type            text NOT NULL
                  CHECK (type IN ('lease_renewal','payment_due','custom')),
  target_type     text NOT NULL
                  CHECK (target_type IN ('contract','charge','tenant')),
  target_id       uuid NOT NULL,
  channel         text NOT NULL DEFAULT 'both'
                  CHECK (channel IN ('email','in_app','both')),
  scheduled_for   date NOT NULL,
  sent_at         timestamptz NULL,
  status          text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','sent','failed','skipped')),
  message_preview text NULL,
  error           text NULL,
  created_at      timestamptz DEFAULT now() NOT NULL,
  updated_at      timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_reminders_org             ON public.reminders(org_id);
CREATE INDEX idx_reminders_org_date_status ON public.reminders(org_id, scheduled_for, status);
CREATE INDEX idx_reminders_target          ON public.reminders(target_type, target_id);

-- ── notification_inbox ────────────────────────────────────────────────────────
CREATE TABLE public.notification_inbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL,
  related_type text NULL,
  related_id   uuid NULL,
  read_at      timestamptz NULL,
  created_at   timestamptz DEFAULT now() NOT NULL,
  updated_at   timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_notification_inbox_org         ON public.notification_inbox(org_id);
CREATE INDEX idx_notification_inbox_profile_read ON public.notification_inbox(profile_id, read_at);
CREATE INDEX idx_notification_inbox_profile_ts   ON public.notification_inbox(profile_id, created_at);

CREATE TRIGGER trg_reminders_updated
  BEFORE UPDATE ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_notification_inbox_updated
  BEFORE UPDATE ON public.notification_inbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
