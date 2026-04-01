-- Partial unique index: prevents duplicate unread notifications for the same
-- (user, company, type, title) combination. This is the DB-level safety net
-- that makes runaway client loops harmless — even if the client fires thousands
-- of INSERTs, only the first one succeeds.
--
-- The WHERE clause limits the constraint to unread notifications only, so a user
-- can receive a new "Connect Gmail" prompt after dismissing the previous one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unread_dedup
  ON notifications (user_id, company_id, type, title)
  WHERE is_read = false;

-- RPC function: inserts a notification only if no unread duplicate exists.
-- Uses ON CONFLICT DO NOTHING so PostgREST always returns 200 (no 409 noise).
CREATE OR REPLACE FUNCTION create_notification_if_new(
  p_user_id TEXT,
  p_company_id TEXT,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_persistent BOOLEAN DEFAULT false,
  p_action_url TEXT DEFAULT NULL,
  p_action_label TEXT DEFAULT NULL,
  p_project_id TEXT DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO notifications (user_id, company_id, type, title, body, is_read, persistent, action_url, action_label, project_id)
  VALUES (p_user_id, p_company_id, p_type, p_title, p_body, false, p_persistent, p_action_url, p_action_label, p_project_id)
  ON CONFLICT (user_id, company_id, type, title) WHERE is_read = false
  DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
