-- Create analytics_events table for unified cross-platform tracking
-- Spec: docs/superpowers/specs/2026-03-30-unified-analytics-system-design.md
-- Bible: ops-software-bible/21_ANALYTICS_SYSTEM.md

CREATE TABLE analytics_events (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity
  user_id         uuid          NULL,
  company_id      uuid          NULL,
  role            text          NULL,
  plan            text          NULL,
  -- Event
  event_type      text          NOT NULL,
  event_name      text          NOT NULL,
  -- Context
  platform        text          NOT NULL,
  app_version     text          NULL,
  device_type     text          NULL,
  os_version      text          NULL,
  -- Session
  session_id      uuid          NOT NULL,
  -- Data
  properties      jsonb         DEFAULT '{}',
  duration_ms     int           NULL,
  -- Timestamp
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- Indexes for common admin panel query patterns
CREATE INDEX idx_analytics_events_company_created ON analytics_events (company_id, created_at DESC);
CREATE INDEX idx_analytics_events_type_name_created ON analytics_events (event_type, event_name, created_at DESC);
CREATE INDEX idx_analytics_events_user_created ON analytics_events (user_id, created_at DESC);
CREATE INDEX idx_analytics_events_session ON analytics_events (session_id, created_at ASC);
CREATE INDEX idx_analytics_events_platform_created ON analytics_events (platform, created_at DESC);

-- RLS enabled with insert-only policy for authenticated clients
-- Reads are admin-only via service role (no SELECT policy)
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated inserts" ON analytics_events
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Distinct user count function for admin dashboard
CREATE OR REPLACE FUNCTION count_distinct_users(
  start_date timestamptz,
  end_date timestamptz,
  platform_filter text DEFAULT NULL
) RETURNS bigint AS $$
  SELECT COUNT(DISTINCT user_id)
  FROM analytics_events
  WHERE created_at >= start_date
    AND created_at < end_date
    AND user_id IS NOT NULL
    AND (platform_filter IS NULL OR platform = platform_filter);
$$ LANGUAGE sql STABLE;
