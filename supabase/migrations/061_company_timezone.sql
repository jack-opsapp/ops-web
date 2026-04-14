-- Sprint S2 Amendment Fix Pass: per-company IANA timezone
--
-- Required to make appointment_reminder.send_hour_local actually work.
-- Without a timezone, a single-hour UTC cron couldn't know what "2pm local"
-- meant for different companies. Adding a canonical timezone column on the
-- companies table means every part of the app (crons, dashboards,
-- scheduling logic) can render in the company's local time.
--
-- Default to 'America/Vancouver' — our primary user base (Canpro and other
-- western-Canadian contractors). Companies can override via settings once we
-- expose the UI.
--
-- Idempotent.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Vancouver';

COMMENT ON COLUMN companies.timezone IS
  'IANA timezone identifier (e.g. America/Vancouver). Used by crons and '
  'scheduling features to interpret per-company local times. Validated at '
  'the application layer via Intl.DateTimeFormat.';
