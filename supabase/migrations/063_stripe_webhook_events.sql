-- Migration 063: Stripe webhook event dedup table
--
-- Stripe guarantees at-least-once delivery and retries failed webhooks for up
-- to 3 days. Without dedup, a retried event re-applies the same update and can
-- corrupt derived state (e.g. the seat_grace_start_date bounded-once rule in
-- the invoice.payment_failed handler).
--
-- This table records every processed event.id so the handler can bail early
-- on duplicates.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received_at
  ON stripe_webhook_events (received_at DESC);

COMMENT ON TABLE stripe_webhook_events IS
  'Dedup log for Stripe webhook deliveries. Insert before processing; skip if PK conflict.';
