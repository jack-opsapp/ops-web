-- Migration 025: Create user_dashboard_preferences table
-- Per-user dashboard widget layout and preferences persisted to DB (replacing localStorage)

CREATE TABLE IF NOT EXISTS user_dashboard_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  widget_instances JSONB NOT NULL DEFAULT '[]'::jsonb,
  dashboard_layout TEXT DEFAULT 'default',
  scheduling_type TEXT DEFAULT 'both',
  map_default_zoom INT DEFAULT 12,
  map_default_center JSONB DEFAULT NULL,
  map_show_traffic BOOLEAN DEFAULT false,
  map_show_crew_labels BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, company_id)
);

ALTER TABLE user_dashboard_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own dashboard preferences"
  ON user_dashboard_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own dashboard preferences"
  ON user_dashboard_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own dashboard preferences"
  ON user_dashboard_preferences FOR UPDATE
  USING (user_id = auth.uid());
