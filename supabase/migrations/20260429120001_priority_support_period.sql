-- ════════════════════════════════════════════════════════════════════
-- PRIORITY SUPPORT PERIOD — billing-cadence cache for the add-on
-- ════════════════════════════════════════════════════════════════════
--
-- Companion column to `companies.has_priority_support`. Lets the
-- subscription tab render "Active · Monthly" / "Active · Annual"
-- without making a Stripe API roundtrip on every render.
--
-- Source of truth remains Stripe; the webhook writes this column from
-- the line item's price ID on every customer.subscription.* event:
--   STRIPE_PRICE_PRIORITY_SUPPORT_MONTHLY  → 'monthly'
--   STRIPE_PRICE_PRIORITY_SUPPORT_ANNUAL   → 'annual'
-- and clears it (NULL) when has_priority_support flips false.

ALTER TABLE companies
  ADD COLUMN priority_support_period TEXT
    CHECK (priority_support_period IN ('monthly','annual'));

COMMENT ON COLUMN companies.priority_support_period IS
  'Billing cadence for the active Priority Support subscription. Mirrors the Stripe price ID. NULL when has_priority_support = false.';
