-- Migration 000014: community_posts + community_comments + visitor_logs + ai_chat_messages + indexes
-- Phase 2 — Module 4: Community & Security + AI

-- ── community_posts ───────────────────────────────────────────────────────────
CREATE TABLE public.community_posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,  -- plain text; NEVER rendered as HTML
  category   text NOT NULL DEFAULT 'general'
             CHECK (category IN ('general','question','marketplace','event')),
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_community_posts_org          ON public.community_posts(org_id);
CREATE INDEX idx_community_posts_org_pinned   ON public.community_posts(org_id, pinned, created_at);
CREATE INDEX idx_community_posts_author       ON public.community_posts(author_id);

-- ── community_comments ────────────────────────────────────────────────────────
CREATE TABLE public.community_comments (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  post_id   uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body      text NOT NULL,  -- plain text
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_community_comments_org     ON public.community_comments(org_id);
CREATE INDEX idx_community_comments_post_ts ON public.community_comments(post_id, created_at);

-- ── visitor_logs ──────────────────────────────────────────────────────────────
CREATE TABLE public.visitor_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id    uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL,
  unit_id        uuid NULL REFERENCES public.units(id) ON DELETE SET NULL,
  visitor_name   text NOT NULL,  -- PII
  host_tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  visit_date     date NOT NULL,
  entry_time     timestamptz NULL,
  exit_time      timestamptz NULL,
  purpose        text NULL,
  created_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notes          text NULL,
  created_at     timestamptz DEFAULT now() NOT NULL,
  updated_at     timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_visitor_logs_org        ON public.visitor_logs(org_id);
CREATE INDEX idx_visitor_logs_org_date   ON public.visitor_logs(org_id, visit_date);
CREATE INDEX idx_visitor_logs_unit       ON public.visitor_logs(unit_id);
CREATE INDEX idx_visitor_logs_host       ON public.visitor_logs(host_tenant_id);

-- ── ai_chat_messages ──────────────────────────────────────────────────────────
CREATE TABLE public.ai_chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  role       text NOT NULL CHECK (role IN ('user','assistant')),
  content    text NOT NULL,  -- may reflect org aggregates; never store secrets/PII beyond user-typed
  created_at timestamptz DEFAULT now() NOT NULL
  -- no updated_at: chat messages are immutable
);

CREATE INDEX idx_ai_chat_org         ON public.ai_chat_messages(org_id);
CREATE INDEX idx_ai_chat_session_ts  ON public.ai_chat_messages(profile_id, session_id, created_at);

CREATE TRIGGER trg_community_posts_updated
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_community_comments_updated
  BEFORE UPDATE ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_visitor_logs_updated
  BEFORE UPDATE ON public.visitor_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
