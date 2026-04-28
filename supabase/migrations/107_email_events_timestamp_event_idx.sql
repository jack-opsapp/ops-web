-- 107_email_events_timestamp_event_idx.sql
-- PR 8: Event Monitor + Anomaly Alerts
--
-- The metrics RPCs scan email_events.timestamp + event. PR 1 already created
-- idx_email_events_timestamp; this adds a composite covering index used by
-- the FILTER clauses in email_event_metrics for the hot window scan.

CREATE INDEX IF NOT EXISTS idx_email_events_timestamp_event
  ON public.email_events (timestamp DESC, event);

ANALYZE public.email_events;
