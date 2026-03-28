-- ═══════════════════════════════════════════════════════════════════
-- OPS Pipeline + Financial Schema Migration
-- Supabase / PostgreSQL
--
-- This migration creates the complete data architecture for:
--   - Pipeline management (opportunities, stages, transitions)
--   - Financial records (estimates, invoices, payments)
--   - Activity tracking and follow-ups
--   - Audit logging and document numbering
--
-- All tables are company-scoped via RLS using Firebase JWT claims.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 1: PRIVATE SCHEMA + RLS HELPER
-- ═══════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS private;

-- Extracts company_id from Firebase JWT app_metadata.
-- The (SELECT ...) wrapper in RLS policies causes PostgreSQL to
-- evaluate this once per query (not per row), turning 450ms queries
-- into 45ms on large tables.
CREATE OR REPLACE FUNCTION private.get_user_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
$$;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 2: TABLES (in dependency order)
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 2.1  PIPELINE STAGE CONFIG (customizable per company)
--      No foreign key dependencies -- created first.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE pipeline_stage_configs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL,
  name                    text NOT NULL,
  slug                    text NOT NULL,
  color                   text NOT NULL DEFAULT '#BCBCBC',
  icon                    text,
  sort_order              int NOT NULL DEFAULT 0,
  is_default              boolean DEFAULT false,
  is_won_stage            boolean DEFAULT false,
  is_lost_stage           boolean DEFAULT false,
  default_win_probability int DEFAULT 10,
  auto_follow_up_days     int,
  auto_follow_up_type     text,
  stale_threshold_days    int DEFAULT 7,
  created_at              timestamptz DEFAULT now(),
  deleted_at              timestamptz,
  UNIQUE(company_id, slug)
);

ALTER TABLE pipeline_stage_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON pipeline_stage_configs
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.2  OPPORTUNITIES (Pipeline deals)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE opportunities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  client_id           uuid,                    -- nullable for brand-new leads
  title               text NOT NULL,
  description         text,

  -- Contact info (for leads without a client record yet)
  contact_name        text,
  contact_email       text,
  contact_phone       text,

  -- Pipeline tracking
  stage               text NOT NULL DEFAULT 'new_lead'
    CHECK (stage IN ('new_lead','qualifying','quoting','quoted','follow_up','negotiation','won','lost')),
  source              text CHECK (source IN ('referral','website','email','phone','walk_in','social_media','repeat_client','other')),
  assigned_to         uuid,
  priority            text CHECK (priority IN ('low','medium','high')),

  -- Financial
  estimated_value     numeric(12,2),
  actual_value        numeric(12,2),           -- set on Won
  win_probability     int DEFAULT 10 CHECK (win_probability BETWEEN 0 AND 100),

  -- Dates
  expected_close_date date,
  actual_close_date   date,
  stage_entered_at    timestamptz NOT NULL DEFAULT now(),

  -- Conversion
  project_id          uuid,                    -- set when converted to project on Won
  lost_reason         text,
  lost_notes          text,

  -- Address
  address             text,

  -- Denormalized for performance
  last_activity_at    timestamptz,
  next_follow_up_at   timestamptz,
  tags                text[],

  -- System
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX idx_opp_company_stage ON opportunities(company_id, stage) WHERE deleted_at IS NULL;
CREATE INDEX idx_opp_company_client ON opportunities(company_id, client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_opp_active ON opportunities(company_id, stage, estimated_value)
  WHERE stage NOT IN ('won','lost') AND deleted_at IS NULL;

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON opportunities
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.3  STAGE TRANSITIONS (immutable log of stage changes)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE stage_transitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  opportunity_id    uuid NOT NULL REFERENCES opportunities(id),
  from_stage        text,                      -- null for initial creation
  to_stage          text NOT NULL,
  transitioned_at   timestamptz NOT NULL DEFAULT now(),
  transitioned_by   uuid,
  duration_in_stage interval                   -- time spent in from_stage
);

CREATE INDEX idx_transitions_opp ON stage_transitions(opportunity_id);

ALTER TABLE stage_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON stage_transitions
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.4  PRODUCTS / SERVICES CATALOG
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  name            text NOT NULL,
  description     text,
  default_price   numeric(12,2) NOT NULL DEFAULT 0,
  unit_cost       numeric(12,2),               -- internal cost for margin tracking
  unit            text DEFAULT 'each',         -- 'each', 'hour', 'sqft', 'linear ft'
  category        text,
  is_taxable      boolean DEFAULT true,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX idx_products_company ON products(company_id) WHERE deleted_at IS NULL;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON products
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.5  TAX RATES
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE tax_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  name        text NOT NULL,                   -- 'Sales Tax', 'GST'
  rate        numeric(6,4) NOT NULL,           -- 0.0875 = 8.75%
  is_default  boolean DEFAULT false,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON tax_rates
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.6  ESTIMATES (Quotes / Proposals)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE estimates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  opportunity_id   uuid REFERENCES opportunities(id),
  client_id        uuid NOT NULL,
  estimate_number  text NOT NULL,              -- 'EST-2026-00042'
  version          int NOT NULL DEFAULT 1,
  parent_id        uuid REFERENCES estimates(id),  -- previous version

  -- Content
  title            text,
  client_message   text,
  internal_notes   text,
  terms            text,

  -- Pricing (snapshots -- NOT computed from line items at query time)
  subtotal         numeric(12,2) NOT NULL DEFAULT 0,
  discount_type    text CHECK (discount_type IN ('percentage','fixed')),
  discount_value   numeric(12,2),
  discount_amount  numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate         numeric(6,4),               -- snapshot of rate at creation
  tax_amount       numeric(12,2) NOT NULL DEFAULT 0,
  total            numeric(12,2) NOT NULL DEFAULT 0,

  -- Payment schedule
  deposit_type     text CHECK (deposit_type IN ('percentage','fixed')),
  deposit_value    numeric(12,2),
  deposit_amount   numeric(12,2),

  -- Status
  status           text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','viewed','approved','changes_requested','declined','converted','expired','superseded')),
  issue_date       date NOT NULL DEFAULT CURRENT_DATE,
  expiration_date  date,
  sent_at          timestamptz,
  viewed_at        timestamptz,
  approved_at      timestamptz,

  -- PDF
  pdf_storage_path text,

  -- System
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE(company_id, estimate_number)
);

CREATE INDEX idx_estimates_company ON estimates(company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_estimates_opp ON estimates(opportunity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_estimates_client ON estimates(client_id) WHERE deleted_at IS NULL;

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON estimates
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.7  INVOICES
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  client_id        uuid NOT NULL,
  estimate_id      uuid REFERENCES estimates(id),
  opportunity_id   uuid REFERENCES opportunities(id),
  project_id       uuid,                       -- Bubble project ID
  invoice_number   text NOT NULL,              -- 'INV-2026-00042'

  -- Content
  subject          text,
  client_message   text,
  internal_notes   text,
  footer           text,
  terms            text,

  -- Pricing
  subtotal         numeric(12,2) NOT NULL DEFAULT 0,
  discount_type    text CHECK (discount_type IN ('percentage','fixed')),
  discount_value   numeric(12,2),
  discount_amount  numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate         numeric(6,4),
  tax_amount       numeric(12,2) NOT NULL DEFAULT 0,
  total            numeric(12,2) NOT NULL DEFAULT 0,

  -- Payment tracking (denormalized, updated by trigger)
  amount_paid      numeric(12,2) NOT NULL DEFAULT 0,
  balance_due      numeric(12,2) NOT NULL DEFAULT 0,
  deposit_applied  numeric(12,2) NOT NULL DEFAULT 0,

  -- Status & dates
  status           text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','awaiting_payment','partially_paid','past_due','paid','void','written_off')),
  issue_date       date NOT NULL DEFAULT CURRENT_DATE,
  due_date         date NOT NULL,
  payment_terms    text,                       -- 'Net 30', 'Due on Receipt'
  sent_at          timestamptz,
  viewed_at        timestamptz,
  paid_at          timestamptz,

  -- PDF
  pdf_storage_path text,

  -- System
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE(company_id, invoice_number)
);

CREATE INDEX idx_invoices_company_status ON invoices(company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_client ON invoices(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_overdue ON invoices(company_id, due_date)
  WHERE status IN ('sent','awaiting_payment','partially_paid') AND deleted_at IS NULL;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON invoices
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.8  LINE ITEMS (polymorphic: estimate_id OR invoice_id)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE line_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,

  -- Polymorphic parent
  estimate_id       uuid REFERENCES estimates(id),
  invoice_id        uuid REFERENCES invoices(id),
  CHECK (
    (estimate_id IS NOT NULL AND invoice_id IS NULL) OR
    (estimate_id IS NULL AND invoice_id IS NOT NULL)
  ),

  -- From catalog (optional reference)
  product_id        uuid REFERENCES products(id),

  -- Content
  name              text NOT NULL,
  description       text,
  quantity          numeric(10,3) NOT NULL DEFAULT 1,
  unit              text DEFAULT 'each',
  unit_price        numeric(12,2) NOT NULL DEFAULT 0,
  unit_cost         numeric(12,2),             -- internal cost (hidden from client)
  discount_percent  numeric(5,2) DEFAULT 0,
  is_taxable        boolean DEFAULT true,
  tax_rate_id       uuid REFERENCES tax_rates(id),

  -- Calculated
  line_total        numeric(12,2) GENERATED ALWAYS AS (
    ROUND(quantity * unit_price * (1 - COALESCE(discount_percent, 0) / 100), 2)
  ) STORED,

  -- Estimate-specific
  is_optional       boolean DEFAULT false,     -- client can select/deselect
  is_selected       boolean DEFAULT true,      -- client's choice

  -- Display
  sort_order        int NOT NULL DEFAULT 0,
  category          text,
  service_date      date,

  created_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_line_items_estimate ON line_items(estimate_id) WHERE estimate_id IS NOT NULL;
CREATE INDEX idx_line_items_invoice ON line_items(invoice_id) WHERE invoice_id IS NOT NULL;

ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON line_items
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.9  PAYMENTS
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL,
  invoice_id              uuid NOT NULL REFERENCES invoices(id),
  client_id               uuid NOT NULL,
  amount                  numeric(12,2) NOT NULL,
  payment_method          text CHECK (payment_method IN ('credit_card','debit_card','ach','cash','check','bank_transfer','stripe','other')),
  reference_number        text,                -- check #, transaction ID
  notes                   text,
  payment_date            date NOT NULL DEFAULT CURRENT_DATE,
  stripe_payment_intent   text,                -- for Stripe integration
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  voided_at               timestamptz,
  voided_by               uuid
);

CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_client ON payments(company_id, client_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON payments
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.10  PAYMENT MILESTONES (progress billing schedule)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE payment_milestones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id   uuid NOT NULL REFERENCES estimates(id),
  name          text NOT NULL,                 -- 'Upon completion of framing'
  type          text NOT NULL CHECK (type IN ('percentage','fixed')),
  value         numeric(12,2) NOT NULL,
  amount        numeric(12,2) NOT NULL,        -- computed from estimate total
  sort_order    int NOT NULL DEFAULT 0,
  invoice_id    uuid REFERENCES invoices(id),  -- linked once invoiced
  paid_at       timestamptz
);

CREATE INDEX idx_milestones_estimate ON payment_milestones(estimate_id);

ALTER TABLE payment_milestones ENABLE ROW LEVEL SECURITY;
-- payment_milestones does not have its own company_id column;
-- scope via the parent estimate's company_id.
CREATE POLICY "company_isolation" ON payment_milestones
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = payment_milestones.estimate_id
        AND e.company_id = (SELECT private.get_user_company_id())
    )
  );


-- ───────────────────────────────────────────────────────────────────
-- 2.11  ACTIVITIES (communication & event log)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  opportunity_id  uuid REFERENCES opportunities(id),
  client_id       uuid,                        -- persists after deal closes
  estimate_id     uuid REFERENCES estimates(id),
  invoice_id      uuid REFERENCES invoices(id),

  type            text NOT NULL CHECK (type IN (
    'note','email','call','meeting','estimate_sent','estimate_accepted',
    'estimate_declined','invoice_sent','payment_received',
    'stage_change','created','won','lost','system'
  )),
  subject         text NOT NULL,
  content         text,
  outcome         text,
  direction       text CHECK (direction IN ('inbound','outbound')),
  duration_minutes int,

  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activities_opp ON activities(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX idx_activities_client ON activities(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_activities_company ON activities(company_id, created_at DESC);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON activities
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.12  FOLLOW-UPS (scheduled tasks)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE follow_ups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  opportunity_id    uuid REFERENCES opportunities(id),
  client_id         uuid,

  type              text NOT NULL CHECK (type IN ('call','email','meeting','quote_follow_up','invoice_follow_up','custom')),
  title             text NOT NULL,
  description       text,
  due_at            timestamptz NOT NULL,
  reminder_at       timestamptz,
  completed_at      timestamptz,
  assigned_to       uuid,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','skipped')),
  completion_notes  text,
  is_auto_generated boolean DEFAULT false,
  trigger_source    text,                      -- 'stage_change', 'estimate_sent', 'invoice_overdue'

  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_followups_opp ON follow_ups(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX idx_followups_pending ON follow_ups(company_id, due_at)
  WHERE status = 'pending';

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON follow_ups
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.13  DOCUMENT SEQUENCES (gapless numbering for EST / INV)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE document_sequences (
  company_id        uuid NOT NULL,
  document_type     text NOT NULL CHECK (document_type IN ('estimate','invoice')),
  prefix            text NOT NULL,
  last_number       bigint NOT NULL DEFAULT 0,
  fiscal_year       int NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  PRIMARY KEY (company_id, document_type, fiscal_year)
);

ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON document_sequences
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.14  AUDIT LOG (append-only, for financial records)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  table_name    text NOT NULL,
  record_id     uuid NOT NULL,
  company_id    uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data      jsonb,
  new_data      jsonb,
  changed_by    uuid,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

-- Append-only: no updates or deletes allowed
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_log FROM authenticated;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON audit_log
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));


-- ───────────────────────────────────────────────────────────────────
-- 2.15  VALID STATUS TRANSITIONS (state machine enforcement)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE valid_status_transitions (
  entity_type  text NOT NULL,
  from_status  text NOT NULL,
  to_status    text NOT NULL,
  PRIMARY KEY (entity_type, from_status, to_status)
);

-- valid_status_transitions is reference data shared across all companies.
-- RLS is enabled but the policy allows all authenticated users to read.
ALTER TABLE valid_status_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone_can_read" ON valid_status_transitions
  FOR SELECT USING (true);


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 3: TRIGGERS
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 3.1  AUTO-UPDATE invoice balance when payments change
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_invoice_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_invoice_id uuid;
  v_total_paid numeric(12,2);
  v_invoice_total numeric(12,2);
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM payments WHERE invoice_id = v_invoice_id AND voided_at IS NULL;

  SELECT total INTO v_invoice_total FROM invoices WHERE id = v_invoice_id;

  UPDATE invoices SET
    amount_paid = v_total_paid,
    balance_due = v_invoice_total - v_total_paid,
    status = CASE
      WHEN v_total_paid >= v_invoice_total THEN 'paid'
      WHEN v_total_paid > 0 THEN 'partially_paid'
      ELSE status
    END,
    paid_at = CASE
      WHEN v_total_paid >= v_invoice_total THEN now()
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = v_invoice_id;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_payment_balance
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_invoice_balance();


-- ───────────────────────────────────────────────────────────────────
-- 3.2  AUTO-UPDATE updated_at timestamp on modifications
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_opp_timestamp BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_estimate_timestamp BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_invoice_timestamp BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_product_timestamp BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();


-- ───────────────────────────────────────────────────────────────────
-- 3.3  AUDIT TRIGGER (append-only log for financial tables)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, company_id, action, new_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, NEW.company_id, 'INSERT', to_jsonb(NEW),
            (auth.jwt() ->> 'sub')::uuid);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, company_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, NEW.company_id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
            (auth.jwt() ->> 'sub')::uuid);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (table_name, record_id, company_id, action, old_data, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, OLD.company_id, 'DELETE', to_jsonb(OLD),
            (auth.jwt() ->> 'sub')::uuid);
    RETURN OLD;
  END IF;
END; $$;

-- Attach audit trigger to financial tables
CREATE TRIGGER audit_estimates AFTER INSERT OR UPDATE OR DELETE ON estimates
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 4: FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 4.1  GAPLESS DOCUMENT NUMBERING
--      Returns e.g. 'EST-2026-00042' or 'INV-2026-00001'
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_next_document_number(
  p_company_id uuid, p_type text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_next bigint; v_prefix text; v_year int;
BEGIN
  v_year := EXTRACT(YEAR FROM CURRENT_DATE);
  UPDATE document_sequences
  SET last_number = last_number + 1
  WHERE company_id = p_company_id AND document_type = p_type AND fiscal_year = v_year
  RETURNING last_number, prefix INTO v_next, v_prefix;

  IF NOT FOUND THEN
    v_prefix := CASE p_type WHEN 'estimate' THEN 'EST' WHEN 'invoice' THEN 'INV' END;
    INSERT INTO document_sequences (company_id, document_type, prefix, last_number, fiscal_year)
    VALUES (p_company_id, p_type, v_prefix, 1, v_year)
    RETURNING last_number, prefix INTO v_next, v_prefix;
  END IF;

  RETURN v_prefix || '-' || v_year || '-' || LPAD(v_next::text, 5, '0');
END; $$;


-- ───────────────────────────────────────────────────────────────────
-- 4.2  CONVERT ESTIMATE -> INVOICE (atomic)
--      Only approved estimates can be converted.
--      Copies selected line items, marks estimate as converted,
--      and logs an activity record.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION convert_estimate_to_invoice(
  p_estimate_id uuid,
  p_due_date date DEFAULT CURRENT_DATE + 30
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_estimate estimates%ROWTYPE;
  v_invoice_id uuid;
  v_invoice_number text;
BEGIN
  SELECT * INTO v_estimate FROM estimates WHERE id = p_estimate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found'; END IF;
  IF v_estimate.status != 'approved' THEN
    RAISE EXCEPTION 'Only approved estimates can become invoices (current: %)', v_estimate.status;
  END IF;

  -- Get gapless invoice number
  v_invoice_number := get_next_document_number(v_estimate.company_id, 'invoice');

  -- Create invoice
  INSERT INTO invoices (
    company_id, client_id, estimate_id, opportunity_id,
    invoice_number, subtotal, discount_type, discount_value, discount_amount,
    tax_rate, tax_amount, total, balance_due,
    due_date, terms, deposit_applied, created_by
  ) VALUES (
    v_estimate.company_id, v_estimate.client_id, v_estimate.id, v_estimate.opportunity_id,
    v_invoice_number, v_estimate.subtotal, v_estimate.discount_type, v_estimate.discount_value,
    v_estimate.discount_amount, v_estimate.tax_rate, v_estimate.tax_amount, v_estimate.total,
    v_estimate.total - COALESCE(v_estimate.deposit_amount, 0),
    p_due_date, v_estimate.terms, COALESCE(v_estimate.deposit_amount, 0), v_estimate.created_by
  ) RETURNING id INTO v_invoice_id;

  -- Copy selected line items (skip unselected optionals)
  INSERT INTO line_items (
    company_id, invoice_id, product_id, name, description,
    quantity, unit, unit_price, unit_cost, discount_percent,
    is_taxable, tax_rate_id, sort_order, category
  )
  SELECT
    company_id, v_invoice_id, product_id, name, description,
    quantity, unit, unit_price, unit_cost, discount_percent,
    is_taxable, tax_rate_id, sort_order, category
  FROM line_items
  WHERE estimate_id = p_estimate_id
    AND (is_optional = false OR is_selected = true);

  -- Mark estimate as converted
  UPDATE estimates SET status = 'converted', updated_at = now() WHERE id = p_estimate_id;

  -- Log activity
  INSERT INTO activities (company_id, opportunity_id, client_id, estimate_id, invoice_id, type, subject, created_by)
  VALUES (v_estimate.company_id, v_estimate.opportunity_id, v_estimate.client_id,
          p_estimate_id, v_invoice_id, 'invoice_sent',
          'Invoice ' || v_invoice_number || ' created from estimate', v_estimate.created_by);

  RETURN v_invoice_id;
END; $$;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION 5: SEED DATA
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 5.1  VALID STATUS TRANSITIONS (estimate state machine)
-- ───────────────────────────────────────────────────────────────────
INSERT INTO valid_status_transitions (entity_type, from_status, to_status) VALUES
  ('estimate', 'draft',              'sent'),
  ('estimate', 'draft',              'superseded'),
  ('estimate', 'sent',               'viewed'),
  ('estimate', 'sent',               'approved'),
  ('estimate', 'sent',               'declined'),
  ('estimate', 'sent',               'expired'),
  ('estimate', 'sent',               'superseded'),
  ('estimate', 'viewed',             'approved'),
  ('estimate', 'viewed',             'declined'),
  ('estimate', 'viewed',             'expired'),
  ('estimate', 'viewed',             'changes_requested'),
  ('estimate', 'viewed',             'superseded'),
  ('estimate', 'changes_requested',  'draft'),
  ('estimate', 'approved',           'converted');

-- ───────────────────────────────────────────────────────────────────
-- 5.2  VALID STATUS TRANSITIONS (invoice state machine)
-- ───────────────────────────────────────────────────────────────────
INSERT INTO valid_status_transitions (entity_type, from_status, to_status) VALUES
  ('invoice', 'draft',              'sent'),
  ('invoice', 'sent',               'awaiting_payment'),
  ('invoice', 'sent',               'partially_paid'),
  ('invoice', 'sent',               'paid'),
  ('invoice', 'sent',               'past_due'),
  ('invoice', 'sent',               'void'),
  ('invoice', 'awaiting_payment',   'partially_paid'),
  ('invoice', 'awaiting_payment',   'paid'),
  ('invoice', 'awaiting_payment',   'past_due'),
  ('invoice', 'awaiting_payment',   'void'),
  ('invoice', 'partially_paid',     'paid'),
  ('invoice', 'partially_paid',     'past_due'),
  ('invoice', 'past_due',           'partially_paid'),
  ('invoice', 'past_due',           'paid'),
  ('invoice', 'past_due',           'written_off');

-- NOTE: Default pipeline_stage_configs are NOT seeded here.
-- They are per-company and should be created during company onboarding.

COMMIT;
