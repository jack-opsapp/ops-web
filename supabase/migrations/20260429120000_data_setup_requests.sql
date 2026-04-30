-- ════════════════════════════════════════════════════════════════════
-- DATA SETUP REQUESTS — fulfillment queue for the Data Setup add-on
-- ════════════════════════════════════════════════════════════════════
--
-- Purchase path:
--   Stripe Checkout (mode=payment, price=STRIPE_PRICE_DATA_SETUP)
--     → /api/webhooks/stripe handles `checkout.session.completed`
--     → flips companies.data_setup_purchased = true
--     → inserts a row here in status='pending'
--     → triggers the DataSetupRequest fulfillment email
--     → drops a persistent notification on the rail
--
-- Lifecycle:
--   pending      → just paid; OPS staff has yet to schedule
--   scheduled    → date booked; scheduled_at populated
--   in_progress  → migration actively running
--   completed    → done; companies.data_setup_completed flips true
--   cancelled    → refunded or abandoned (rare; admin override)
--
-- The columns on `companies` (data_setup_purchased / data_setup_completed
-- / data_setup_scheduled) remain the canonical entitlement bits the rest
-- of the app reads. This table is the operations log behind those flags.

CREATE TABLE data_setup_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requested_by                UUID NOT NULL REFERENCES users(id),
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','scheduled','in_progress','completed','cancelled')),
  scheduled_at                TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,
  notes                       TEXT,
  stripe_payment_intent_id    TEXT,
  amount_paid_cents           INTEGER,
  source_software             TEXT,
  contact_email               TEXT,
  contact_phone               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_setup_requests_company ON data_setup_requests(company_id);
CREATE INDEX idx_data_setup_requests_status  ON data_setup_requests(status);

-- One Stripe payment must map to at most one request row. The webhook is
-- idempotent (stripe_webhook_events de-dup), but defense-in-depth here too.
CREATE UNIQUE INDEX idx_data_setup_requests_stripe_pi
  ON data_setup_requests(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION data_setup_requests_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER data_setup_requests_updated_at
  BEFORE UPDATE ON data_setup_requests
  FOR EACH ROW EXECUTE FUNCTION data_setup_requests_set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────
-- Same isolation model the rest of the app uses: company members can
-- read/insert their own rows; only company admins can mutate status,
-- schedule date, completion, or notes. Service role bypasses RLS for
-- the Stripe webhook insert path.

ALTER TABLE data_setup_requests ENABLE ROW LEVEL SECURITY;

-- SELECT — anyone in the company can read
CREATE POLICY "data_setup_requests_select_company"
  ON data_setup_requests
  FOR SELECT
  USING (company_id = (SELECT private.get_user_company_id()));

-- INSERT — anyone in the company can request setup. The webhook also
-- inserts via service role (bypasses RLS) so the Stripe path is always
-- safe; this policy covers the rare client-initiated insert.
--
-- The user lookup matches the existing auth pattern in
-- /api/auth/join-company: try auth_id first, then firebase_uid. Most
-- production users authenticate via Firebase and live with auth_id NULL
-- + firebase_uid filled, so the auth.uid() → users mapping must check
-- both columns (cast to text since firebase_uid is TEXT).
CREATE POLICY "data_setup_requests_insert_company"
  ON data_setup_requests
  FOR INSERT
  WITH CHECK (
    company_id = (SELECT private.get_user_company_id())
    AND requested_by IN (
      SELECT id FROM users
      WHERE auth_id = auth.uid()::text
         OR firebase_uid = auth.uid()::text
    )
  );

-- UPDATE — admins only (anyone with users.is_company_admin = TRUE in
-- the same company). The same auth_id / firebase_uid fallback applies.
CREATE POLICY "data_setup_requests_update_admin"
  ON data_setup_requests
  FOR UPDATE
  USING (
    company_id = (SELECT private.get_user_company_id())
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE (u.auth_id = auth.uid()::text OR u.firebase_uid = auth.uid()::text)
        AND u.company_id = data_setup_requests.company_id
        AND u.is_company_admin = TRUE
    )
  )
  WITH CHECK (
    company_id = (SELECT private.get_user_company_id())
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE (u.auth_id = auth.uid()::text OR u.firebase_uid = auth.uid()::text)
        AND u.company_id = data_setup_requests.company_id
        AND u.is_company_admin = TRUE
    )
  );
