-- ─────────────────────────────────────────────────────────────────────────────
-- 020: Feature Flags
--
-- Master on/off switches per feature + per-user overrides when a flag is OFF.
-- No RLS — these tables are only queried via service-role client.
-- ─────────────────────────────────────────────────────────────────────────────

-- feature_flags: master on/off per feature
CREATE TABLE feature_flags (
  slug        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- feature_flag_overrides: per-user access when flag is OFF
CREATE TABLE feature_flag_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_slug  TEXT NOT NULL REFERENCES feature_flags(slug) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(flag_slug, user_id)
);

CREATE INDEX idx_feature_flag_overrides_user ON feature_flag_overrides(user_id);

-- Seed: pipeline and accounting are OFF by default
INSERT INTO feature_flags (slug, label, enabled, description) VALUES
  ('pipeline',   'Pipeline',   false, 'Sales pipeline and opportunity management'),
  ('accounting', 'Accounting', false, 'Accounting integrations (QuickBooks, Sage)');
