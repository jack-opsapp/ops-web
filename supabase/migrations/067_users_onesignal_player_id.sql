-- 067_users_onesignal_player_id.sql
-- Adds onesignal_player_id to users for targeted push notifications.
-- iOS writes this on login via OneSignal.User.pushSubscription.id.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onesignal_player_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_onesignal_player_id
  ON users(onesignal_player_id)
  WHERE onesignal_player_id IS NOT NULL;

COMMENT ON COLUMN users.onesignal_player_id IS
  'OneSignal subscription ID for push notifications. Written by iOS app on login.';
