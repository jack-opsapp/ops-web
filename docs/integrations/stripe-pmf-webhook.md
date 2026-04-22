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

The endpoint URL is already configured at `https://opsapp.co/api/webhooks/stripe`.
To enable PMF capture on the existing endpoint, verify the webhook subscription
includes ALL seven PMF-tracked event types listed below.

| Event | Already enabled (subscription sync) | Required for PMF |
|---|---|---|
| `invoice.paid` | no | YES — add if missing |
| `invoice.payment_failed` | yes | already enabled |
| `customer.subscription.created` | yes | already enabled |
| `customer.subscription.updated` | yes | already enabled |
| `customer.subscription.deleted` | yes | already enabled |
| `charge.refunded` | no | YES — add if missing |
| `charge.dispute.created` | no | YES — add if missing |

The pre-existing endpoint also listens for `payment_intent.succeeded` and
`customer.deleted` for the non-PMF handlers. Leave those enabled.

To check and add the missing events:

1. Stripe Dashboard → Developers → Webhooks → existing endpoint
2. Click "Listening to N events" → review the list
3. If `invoice.paid`, `charge.refunded`, or `charge.dispute.created` are
   missing, click "Update details" → "Add events" → search and select.
4. No code changes or env-var changes needed after adding events — the
   handler already knows what to do.

If reconfiguring the endpoint from scratch, the signing secret must be wired
to the Vercel env var `STRIPE_WEBHOOK_SECRET`.

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
(unique_violation) as benign. Any other DB error returns 500 so Stripe retries
the event — without the retry, the dedup table would be written on the next
successful delivery and the missing `billing_events` row would be permanently
lost (and `pmf_deals.first_paid_at` would never fire). The 500 also blocks
the per-type handlers on this delivery, but that is safe: those handlers are
idempotent and Stripe's retry will re-apply them.

## After-insert trigger

`billing_events_first_paid` (defined in migration `20260421120000_pmf_tracking.sql`)
fires after each insert and updates `pmf_deals.first_paid_at` for first-time
paid customers. This is the wiring that surfaces in the PMF dashboard.

## Where the code lives

- Handler: `src/app/api/webhooks/stripe/route.ts`
  - `PMF_TRACKED_EVENTS` constant (top of file) — the seven captured types
  - PMF block (after dedup, before per-type handlers) — performs the insert
  - `extractCustomerId(event)` / `extractAmountCents(event)` / `extractCurrency(event)` (bottom of file)
- Tests: `tests/integration/stripe-webhook-billing-events.test.ts`
- Schema: `supabase/migrations/20260421120000_pmf_tracking.sql`
