-- Sprint S2: Client scheduling communications settings
-- Adds a JSONB column to companies for per-company toggles covering:
--   - appointment confirmations
--   - day-before reminders (with weather awareness)
--   - reschedule request detection (min confidence threshold)
--   - subcontractor coordination

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS client_comms_settings JSONB
  DEFAULT '{
    "appointment_confirmations": {
      "enabled": true,
      "delay_hours": 0
    },
    "day_before_reminders": {
      "enabled": true,
      "send_hour_utc": 14,
      "include_weather": true
    },
    "reschedule_requests": {
      "enabled": true,
      "min_confidence": 0.6
    },
    "subcontractor_coordination": {
      "enabled": true
    }
  }'::jsonb;

COMMENT ON COLUMN companies.client_comms_settings IS
  'Per-company settings for Sprint S2 client scheduling communications. Includes appointment confirmations, day-before reminders, reschedule detection thresholds, and subcontractor coordination toggles.';
