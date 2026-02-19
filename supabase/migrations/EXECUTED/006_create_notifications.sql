CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mention',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  project_id TEXT,
  note_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, company_id)
  WHERE is_read = false;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT USING (true);

CREATE POLICY "Users can create notifications"
  ON notifications FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE USING (true);
