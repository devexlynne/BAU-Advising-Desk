CREATE TABLE IF NOT EXISTS public.advising_app_data (
  key text PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 512),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.advising_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  actor text,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS advising_audit_log_occurred_at_idx
  ON public.advising_audit_log (occurred_at DESC);

REVOKE ALL ON TABLE public.advising_app_data FROM PUBLIC;
REVOKE ALL ON TABLE public.advising_audit_log FROM PUBLIC;
