-- Migration 000012: announcements + cleaning_tasks + crm_leads + indexes
-- Phase 2 — Module 3: Operations Automation

-- ── announcements ─────────────────────────────────────────────────────────────
CREATE TABLE public.announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL,
  audience    text NOT NULL DEFAULT 'all'
              CHECK (audience IN ('all','property','unit')),
  property_id uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL,
  unit_id     uuid NULL REFERENCES public.units(id) ON DELETE SET NULL,
  published_at timestamptz NULL,
  expires_at  timestamptz NULL,
  created_at  timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_announcements_org         ON public.announcements(org_id);
CREATE INDEX idx_announcements_org_pub     ON public.announcements(org_id, published_at);
CREATE INDEX idx_announcements_property    ON public.announcements(property_id);
CREATE INDEX idx_announcements_unit        ON public.announcements(unit_id);

-- ── cleaning_tasks ────────────────────────────────────────────────────────────
CREATE TABLE public.cleaning_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id        uuid NULL REFERENCES public.units(id) ON DELETE SET NULL,
  assigned_to    uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  title          text NOT NULL,
  scheduled_date date NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','done')),
  notes          text NULL,
  completed_at   timestamptz NULL,
  created_at     timestamptz DEFAULT now() NOT NULL,
  updated_at     timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_cleaning_tasks_org      ON public.cleaning_tasks(org_id);
CREATE INDEX idx_cleaning_tasks_org_date ON public.cleaning_tasks(org_id, scheduled_date);
CREATE INDEX idx_cleaning_tasks_unit     ON public.cleaning_tasks(unit_id);
CREATE INDEX idx_cleaning_tasks_assignee ON public.cleaning_tasks(assigned_to);

-- ── crm_leads ─────────────────────────────────────────────────────────────────
CREATE TABLE public.crm_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name         text NOT NULL,   -- PII
  email             text NULL,        -- PII
  phone             text NULL,        -- PII
  property_interest text NULL,
  source            text NULL,
  status            text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','contacted','qualified','lost')),
  notes             text NULL,
  created_at        timestamptz DEFAULT now() NOT NULL,
  updated_at        timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_crm_leads_org        ON public.crm_leads(org_id);
CREATE INDEX idx_crm_leads_org_status ON public.crm_leads(org_id, status);

CREATE TRIGGER trg_announcements_updated
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_cleaning_tasks_updated
  BEFORE UPDATE ON public.cleaning_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_crm_leads_updated
  BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
