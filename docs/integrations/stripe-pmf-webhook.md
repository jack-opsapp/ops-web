# Stripe Webhook → PMF billing_events

The Stripe webhook at `POST /api/webhooks/stripe` (existing endpoint) writes
to the `billing_events` table for PMF analytics in addition to its existing
subscription-state-sync responsibilities.

## Endpoint

`POST /api/webhooks/stripe`

This is the same endpoint that handles `payment_intent.succeeded`,
subscription lifecycle events, and grace-period tracking. PMF event
capture is layered on top — no new Stripe webhook URL needed.

## PMF-tracked events

The following event types insert a row into `billing_events`:

- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`
- `charge.dispute.created`

Other events (e.g. `payment_intent.succeeded`, `customer.deleted`) continue
to flow through the existing handlers but are not captured to `billing_events`.

## Required env

- `STRIPE_SECRET_KEY` — existing
- `STRIPE_WEBHOOK_SECRET` — existing (`whsec_...`)
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — existing

No new env vars.

## Stripe Dashboard configuration

The endpoint is already configured. If reconfiguring from scratch:

1. Stripe Dashboard → Developers → Webhooks → existing endpoint
2. URL: `https://opsapp.co/api/webhooks/stripe`
3. Events to send (existing list, add any from the PMF-tracked list above
   that are not already enabled):
   - `payment_intent.succeeded`
   - `customer.subscription.created` / `updated` / `deleted`
   - `customer.deleted`
   - `invoice.paid` ← may need to add for PMF
   - `invoice.payment_failed`
   - `charge.refunded` ← may need to add for PMF
   - `charge.dispute.created` ← may need to add for PMF
4. Signing secret → Vercel env `STRIPE_WEBHOOK_SECRET`

## Local test

```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger invoice.paid
```

Confirm a row in `billing_events` for the event id (key: `stripe_event_id`).

## Idempotency

Two layers:

1. The existing `stripe_webhook_events` dedup table early-returns duplicates.
2. The `billing_events.stripe_event_id` UNIQUE constraint absorbs any race
   that bypasses layer 1.

The handler inspects the Postgres error code on insert and treats `23505`
(unique_violation) as benign — any other error is logged but does not fail
the request, so a transient Supabase blip on the analytics insert never
blocks the existing subscription-state-sync handlers from running.

## After-insert trigger

`billing_events_first_paid` (defined in migration `20260421120000_pmf_tracking.sql`)
fires after each insert and updates `pmf_deals.first_paid_at` for first-time
paid customers. This is the wiring that surfaces in the PMF dashboard.

## Where the code lives

- Handler: `src/app/api/webhooks/stripe/route.ts`
  - `PMF_TRACKED_EVENTS` constant (top of file) — the seven captured types
  - PMF block (after dedup, before per-type handlers) — performs the insert
  - `extractCustomerId(event)` / `extractAmountCents(event)` (bottom of file)
- Tests: `tests/integration/stripe-webhook-billing-events.test.ts`
- Schema: `supabase/migrations/20260421120000_pmf_tracking.sql`
