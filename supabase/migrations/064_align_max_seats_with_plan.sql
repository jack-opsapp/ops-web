-- Migration 064: Align max_seats with subscription_plan
--
-- companies.max_seats defaulted to 10 on every row and was never written by
-- any code path, so Starter (3 seats) and Team (5 seats) customers were
-- effectively getting Business-tier seat limits. The web and iOS seat
-- enforcement both read this column, so the tier limits were dead.
--
-- Going forward /api/stripe/subscribe and the subscription webhook write
-- max_seats from MAX_SEATS_BY_PLAN (lib/stripe/subscription-mapping.ts) on
-- every subscription change. This migration backfills existing rows.
--
-- Plans not listed (NULL, 'trial') keep the default of 10 — trial companies
-- get generous limits by design.

UPDATE companies SET max_seats = 3
 WHERE subscription_plan = 'starter' AND max_seats <> 3;

UPDATE companies SET max_seats = 5
 WHERE subscription_plan = 'team' AND max_seats <> 5;

UPDATE companies SET max_seats = 10
 WHERE subscription_plan = 'business' AND max_seats <> 10;
