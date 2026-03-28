# OPS Pipeline Tracker -- Strategy & Architecture Plan

> **Vision**: OPS = Jobber + QuickBooks + HubSpot -- a single platform that takes a service business from lead to cash without switching tools.
>
> Compiled from 7 parallel research streams: competitive analysis, automation/workflow, UX/UI patterns, OPS-specific UX design, data architecture, Jobber/QuickBooks analysis, and Supabase schema design.

---

## Executive Summary

The current pipeline is a hack -- it maps `ProjectStatus` values into 4 Kanban columns on top of the existing Project entity via Bubble.io. There is no dedicated pipeline entity, no estimates, no invoices, no payments, no activity log, and no follow-up system.

**The play**: Build the pipeline, estimates, and invoicing layers on **Supabase (PostgreSQL)** while keeping the existing Bubble.io backend for legacy entities (Projects, Tasks, Calendar). Firebase Auth bridges to Supabase via its third-party auth provider support -- no user migration needed.

**The moat**: The pre-sale-to-post-sale transition. Most CRMs end at "Closed Won." Most field service tools start at "Job Created." Most accounting tools start at "Invoice Created." OPS connects the entire chain: **Lead → Estimate → Job → Invoice → Payment** with line items flowing forward at each stage and zero double-entry.

---

## Part 1: Competitive Insights

### Table-Stakes Features
1. Visual Kanban board with drag-and-drop
2. Customizable deal stages with win probability
3. Contact & deal management with custom fields
4. Email integration (2-way sync, auto-logging)
5. Activity timeline per contact/deal
6. Task/follow-up management linked to deals
7. Basic automation (email sequences, stage-change triggers)
8. Pipeline reporting (value, count, win rate)
9. Mobile access
10. Multiple pipelines

### High-Impact Differentiators Worth Stealing

| Feature | From | Why It Matters |
|---------|------|----------------|
| **Deal rotting/aging** | Pipedrive | Per-stage idle timers that visually flag stale deals RED |
| **Activity-based selling** | Pipedrive | Always nudges "what is the next action?" |
| **Pre-sale to post-sale handoff** | Monday.com | Won deals auto-create project boards |
| **Zero-input communication logging** | Close.com / Salesflare | Everything auto-logs. 70% less data entry. |
| **Unified client timeline** | HubSpot | Every interaction across all engagements in one view |
| **Forward-flowing line items** | Jobber | Same line items flow Estimate → Job → Invoice without re-entry |
| **Client Hub / portal** | Jobber | Clients view estimates, approve, pay invoices online |
| **Proposal tracking** | Pipedrive | Know when a prospect opened your proposal |

### What NOT to Build
- Power/predictive dialers (low-volume, high-touch sales)
- AI lead scoring (at small volume, you know your leads)
- Complex territory management or approval hierarchies
- Full double-entry accounting / chart of accounts (that's what QuickBooks export is for)
- Complex product bundles and discount rules

---

## Part 2: UX/UI Design Strategy

### Design Principles
1. **Low Friction** -- Minimum clicks to accomplish any action
2. **Automated** -- Smart defaults, auto-reminders, auto-progression
3. **Intuitive** -- New user understands pipeline in seconds
4. **Simple** -- No feature bloat, only high-value capabilities
5. **Connected** -- Pipeline → Estimates → Projects → Invoices flow seamlessly

### Views

**Two views** (matching existing Clients/Projects pattern with `SegmentedPicker`):
1. **Board View (Kanban)** -- Default. Drag-and-drop cards between stage columns.
2. **List View (Table)** -- Sortable, filterable for bulk actions and data comparison.

### Pipeline Card Design

**Minimal, scannable anatomy:**
- **Primary:** Client name (uppercase, `font-mohave`)
- **Secondary:** Deal title (`font-kosugi`, smaller)
- **Data:** Deal value (right-aligned, `font-mono`) + Days in stage (clock icon)
- **Indicators:** Follow-up status (amber=today, red=overdue), stale deal border

**Quick actions on hover:**
1. **Advance Stage** (ChevronRight) -- one-click to next stage
2. **Quick Note** (MessageSquare) -- inline text input, Enter to save
3. **Set Follow-Up** (Clock) -- date popover
4. **View Detail** (FolderOpen) -- opens deal sheet

### Deal Detail: Slide-Out Panel (NOT Modal)

Right-side drawer (480px). Pipeline board stays visible for context.

**Sections:**
1. **Header** -- Client name, deal title, stage badge, value (editable)
2. **Contact Info** -- Phone, email, address with click-to-action buttons
3. **Activity Timeline** -- Reverse-chronological notes, stage changes, communications
4. **Follow-Up** -- Next scheduled with countdown, reschedule
5. **Estimate** -- Current estimate status, value, link to estimate builder
6. **Actions** -- Advance stage, Create Estimate, Mark Lost, Convert to Project

### Drag-and-Drop Feedback
1. **Idle:** Grab cursor on hover
2. **Grab:** Card lifts with shadow + scale(1.02x), original at 20% opacity
3. **Move:** Ghost follows cursor, target columns highlight, placeholder at insertion
4. **Drop:** Snap animation, toast with 5-second undo

### Stage Transitions with Prompts

| Transition | What Happens |
|-----------|--------------|
| Any → Won | Prompt for final value + "Convert to Project?" |
| Any → Lost | Required: loss reason (Price / Timing / Competition / Scope / No Response / Other) |
| Lead → Quoting | Auto-set follow-up 3 days out |
| Quoted → Won | Auto-create invoice from accepted estimate if exists |
| Lost → Any Active | Allowed (reactivation). Toast: "Deal reactivated." |

### Adding a New Lead (Minimum Friction)

**Tier 1 -- Quick Add (inline, 2 fields):**
Click "+" on Lead column. Inline card-form at top:
- Client name (combobox -- search existing or type new)
- Deal title (auto-generated as "{Client} - Lead")
- Enter to save. Auto-creates client if new.

**Tier 2 -- Full Form:**
"New Lead" button opens full form for all details upfront.

---

## Part 3: The Lead-to-Cash Flow

This is what makes OPS the "Jobber + QuickBooks + HubSpot." Each stage flows forward with data carrying over automatically.

```
PIPELINE (HubSpot)              OPERATIONS (Jobber)              FINANCE (QuickBooks)
===================             ====================             ====================

 [New Lead]
 Opportunity created
      |
      v
 [Qualifying]
 Notes, follow-ups
      |
      v
 [Quoting]  ──────────────>  Estimate created
 Create estimate               with line items, pricing
      |                        from Products catalog
      v
 [Quoted]  ───────────────>  Estimate sent to client
 Estimate sent                 Client views in portal
      |                        Client approves/declines
      v
 [Won] ───────────────────>  Convert to Project  ────────────>  Deposit invoice generated
 Estimate accepted             Line items carry forward          (if payment schedule set)
                               Tasks/visits scheduled
                                    |
                                    v
                               [Work In Progress]               Progress invoices (optional)
                               Team executes tasks
                               Time tracked, expenses logged
                                    |
                                    v
                               [Work Complete]  ─────────────>  Final invoice generated
                               "Requires Invoicing" flag         Line items from project
                                                                     |
                                                                     v
                                                                 Payment recorded
                                                                 Client balance updated
                                                                 Revenue recognized
```

### The Key Principle: Forward-Flowing Immutable Snapshots

1. **Products/Services Catalog** -- Company-wide defaults (names, prices, costs, tax)
2. **Estimate** pulls from catalog but allows customization. Snapshotted at send.
3. **Project/Job** gets a COPY of approved estimate line items (not a reference). Can be modified for change orders.
4. **Invoice** gets a COPY of job line items at invoice-creation time. Can be adjusted.

Each stage gets its own copy so editing one never breaks another. The invoice is always the legal source of truth for billing.

---

## Part 4: Automation Strategy

### Tier 1 -- Must-Have (Build First)

| # | Automation | Trigger | Action |
|---|-----------|---------|--------|
| 1 | **Auto follow-up on stage entry** | Deal enters any stage | Create follow-up from stage config (Lead: 2d, Quoting: 3d, Quoted: 5d) |
| 2 | **Stale deal alerts** | No activity for X days (per stage) | Visual indicator on card + notification badge |
| 3 | **Stage change logging** | Deal moves stages | Auto-create Activity record with from/to + timestamp |
| 4 | **Follow-up overdue alerts** | Follow-up date passes | Red indicator on card, notification in bell menu |
| 5 | **Won deal flow** | Deal → Won | Prompt for value, offer "Convert to Project" |
| 6 | **Lost deal logging** | Deal → Lost | Require loss reason, clear follow-ups |
| 7 | **Estimate sent → auto-advance** | Estimate status → Sent | Auto-move opportunity to Quoted stage |
| 8 | **Estimate accepted → auto-advance** | Estimate status → Accepted | Auto-move opportunity to Won stage |
| 9 | **Invoice balance trigger** | Payment recorded | Auto-update invoice balance; mark Paid when balance = 0 |
| 10 | **Project complete → invoice prompt** | All tasks completed | Flag "Requires Invoicing", prompt to generate invoice |

### Tier 2 -- High Value (Build Second)

| # | Automation | Description |
|---|-----------|-------------|
| 11 | **Email templates per stage** | Pre-built for intro, follow-up, estimate delivery, payment reminder |
| 12 | **Weighted pipeline forecast** | Sum(dealValue x stageProbability) |
| 13 | **Invoice payment reminders** | Auto-email at 3 days, 7 days, 14 days past due |
| 14 | **AR aging alerts** | Notify when client balance enters 60+ day bucket |

### Anti-Patterns to Avoid
- Over-automation on important deals
- Required fields beyond the minimum
- Complex approval workflows for small teams
- Activity count quotas (measure outcomes, not inputs)

---

## Part 5: Data Architecture (Supabase / PostgreSQL)

### Technology Strategy

| Layer | Current | Pipeline/Finance |
|-------|---------|-----------------|
| **Database** | Bubble.io (NoSQL) | **Supabase (PostgreSQL)** |
| **Auth** | Firebase | Firebase → Supabase bridge (third-party auth provider) |
| **API** | Bubble Data API via Next.js proxy | **Supabase client SDK** (direct from browser, RLS enforced) |
| **Real-time** | None | **Supabase Realtime** (live pipeline updates across team) |
| **File Storage** | AWS S3 (images) | **Supabase Storage** (estimate/invoice PDFs) |
| **Server Functions** | Bubble Workflows | **Supabase Edge Functions** (PDF generation, email, webhooks) |

### Firebase Auth → Supabase Bridge

No user migration needed. Supabase natively supports Firebase as a third-party auth provider:

1. Register Firebase project in Supabase Dashboard → Authentication → Third-Party Auth
2. Pass Firebase JWT to Supabase client:
```typescript
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async () => {
    const user = auth.currentUser;
    return user ? user.getIdToken() : null;
  }
});
```
3. RLS policies validate the Firebase JWT and extract `company_id` from custom claims

### Row Level Security (Multi-Tenant)

Every table gets company-scoped RLS using a cached helper function:

```sql
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.get_user_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
$$;

-- Applied to every table:
CREATE POLICY "company_isolation" ON opportunities
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));
```

The `(SELECT ...)` wrapper causes PostgreSQL to evaluate once per query (not per row) -- turning 450ms queries into 45ms on large tables.

### Complete Schema

#### Core Pipeline Tables

```sql
-- ═══════════════════════════════════════════════════
-- OPPORTUNITIES (Pipeline deals)
-- ═══════════════════════════════════════════════════
CREATE TABLE opportunities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  client_id       uuid,                    -- nullable for brand-new leads
  title           text NOT NULL,
  description     text,

  -- Contact info (for leads without a client record yet)
  contact_name    text,
  contact_email   text,
  contact_phone   text,

  -- Pipeline tracking
  stage           text NOT NULL DEFAULT 'new_lead'
    CHECK (stage IN ('new_lead','qualifying','quoting','quoted','follow_up','negotiation','won','lost')),
  source          text CHECK (source IN ('referral','website','email','phone','walk_in','social_media','repeat_client','other')),
  assigned_to     uuid,
  priority        text CHECK (priority IN ('low','medium','high')),

  -- Financial
  estimated_value numeric(12,2),
  actual_value    numeric(12,2),           -- set on Won
  win_probability int DEFAULT 10 CHECK (win_probability BETWEEN 0 AND 100),

  -- Dates
  expected_close_date date,
  actual_close_date   date,
  stage_entered_at    timestamptz NOT NULL DEFAULT now(),

  -- Conversion
  project_id      uuid,                    -- set when converted to project on Won
  lost_reason     text,
  lost_notes      text,

  -- Address
  address         text,

  -- Denormalized for performance
  last_activity_at  timestamptz,
  next_follow_up_at timestamptz,
  tags              text[],

  -- System
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX idx_opp_company_stage ON opportunities(company_id, stage) WHERE deleted_at IS NULL;
CREATE INDEX idx_opp_company_client ON opportunities(company_id, client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_opp_active ON opportunities(company_id, stage, estimated_value)
  WHERE stage NOT IN ('won','lost') AND deleted_at IS NULL;


-- ═══════════════════════════════════════════════════
-- STAGE HISTORY (immutable log of stage transitions)
-- ═══════════════════════════════════════════════════
CREATE TABLE stage_transitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  opportunity_id    uuid NOT NULL REFERENCES opportunities(id),
  from_stage        text,                  -- null for initial creation
  to_stage          text NOT NULL,
  transitioned_at   timestamptz NOT NULL DEFAULT now(),
  transitioned_by   uuid,
  duration_in_stage interval               -- time spent in from_stage
);

CREATE INDEX idx_transitions_opp ON stage_transitions(opportunity_id);


-- ═══════════════════════════════════════════════════
-- PIPELINE STAGE CONFIG (customizable per company)
-- ═══════════════════════════════════════════════════
CREATE TABLE pipeline_stage_configs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL,
  name                   text NOT NULL,
  slug                   text NOT NULL,
  color                  text NOT NULL DEFAULT '#BCBCBC',
  icon                   text,
  sort_order             int NOT NULL DEFAULT 0,
  is_default             boolean DEFAULT false,
  is_won_stage           boolean DEFAULT false,
  is_lost_stage          boolean DEFAULT false,
  default_win_probability int DEFAULT 10,
  auto_follow_up_days    int,
  auto_follow_up_type    text,
  stale_threshold_days   int DEFAULT 7,    -- days before deal is flagged stale
  created_at             timestamptz DEFAULT now(),
  deleted_at             timestamptz,
  UNIQUE(company_id, slug)
);
```

#### Financial Tables (Estimates, Invoices, Payments)

```sql
-- ═══════════════════════════════════════════════════
-- PRODUCTS / SERVICES CATALOG
-- ═══════════════════════════════════════════════════
CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  name            text NOT NULL,
  description     text,
  default_price   numeric(12,2) NOT NULL DEFAULT 0,
  unit_cost       numeric(12,2),           -- internal cost for margin tracking
  unit            text DEFAULT 'each',     -- 'each', 'hour', 'sqft', 'linear ft'
  category        text,
  is_taxable      boolean DEFAULT true,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX idx_products_company ON products(company_id) WHERE deleted_at IS NULL;


-- ═══════════════════════════════════════════════════
-- TAX RATES
-- ═══════════════════════════════════════════════════
CREATE TABLE tax_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  name        text NOT NULL,               -- 'Sales Tax', 'GST'
  rate        numeric(6,4) NOT NULL,       -- 0.0875 = 8.75%
  is_default  boolean DEFAULT false,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════
-- ESTIMATES (Quotes/Proposals)
-- ═══════════════════════════════════════════════════
CREATE TABLE estimates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  opportunity_id   uuid REFERENCES opportunities(id),
  client_id        uuid NOT NULL,
  estimate_number  text NOT NULL,          -- 'EST-2026-00042'
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
  tax_rate         numeric(6,4),           -- snapshot of rate at creation
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


-- ═══════════════════════════════════════════════════
-- INVOICES
-- ═══════════════════════════════════════════════════
CREATE TABLE invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  client_id        uuid NOT NULL,
  estimate_id      uuid REFERENCES estimates(id),
  opportunity_id   uuid REFERENCES opportunities(id),
  project_id       uuid,                   -- Bubble project ID (string)
  invoice_number   text NOT NULL,          -- 'INV-2026-00042'

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
  payment_terms    text,                   -- 'Net 30', 'Due on Receipt'
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


-- ═══════════════════════════════════════════════════
-- LINE ITEMS (normalized -- shared across estimates and invoices)
-- ═══════════════════════════════════════════════════
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
  unit_cost         numeric(12,2),         -- internal cost (hidden from client)
  discount_percent  numeric(5,2) DEFAULT 0,
  is_taxable        boolean DEFAULT true,
  tax_rate_id       uuid REFERENCES tax_rates(id),

  -- Calculated
  line_total        numeric(12,2) GENERATED ALWAYS AS (
    ROUND(quantity * unit_price * (1 - COALESCE(discount_percent, 0) / 100), 2)
  ) STORED,

  -- Estimate-specific
  is_optional       boolean DEFAULT false,  -- client can select/deselect
  is_selected       boolean DEFAULT true,   -- client's choice

  -- Display
  sort_order        int NOT NULL DEFAULT 0,
  category          text,
  service_date      date,

  created_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_line_items_estimate ON line_items(estimate_id) WHERE estimate_id IS NOT NULL;
CREATE INDEX idx_line_items_invoice ON line_items(invoice_id) WHERE invoice_id IS NOT NULL;


-- ═══════════════════════════════════════════════════
-- PAYMENTS
-- ═══════════════════════════════════════════════════
CREATE TABLE payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL,
  invoice_id              uuid NOT NULL REFERENCES invoices(id),
  client_id               uuid NOT NULL,
  amount                  numeric(12,2) NOT NULL,
  payment_method          text CHECK (payment_method IN ('credit_card','debit_card','ach','cash','check','bank_transfer','stripe','other')),
  reference_number        text,            -- check #, transaction ID
  notes                   text,
  payment_date            date NOT NULL DEFAULT CURRENT_DATE,
  stripe_payment_intent   text,            -- for Stripe integration
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  voided_at               timestamptz,
  voided_by               uuid
);

CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_client ON payments(company_id, client_id);


-- ═══════════════════════════════════════════════════
-- PAYMENT MILESTONES (progress billing schedule)
-- ═══════════════════════════════════════════════════
CREATE TABLE payment_milestones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id   uuid NOT NULL REFERENCES estimates(id),
  name          text NOT NULL,             -- 'Upon completion of framing'
  type          text NOT NULL CHECK (type IN ('percentage','fixed')),
  value         numeric(12,2) NOT NULL,
  amount        numeric(12,2) NOT NULL,    -- computed from estimate total
  sort_order    int NOT NULL DEFAULT 0,
  invoice_id    uuid REFERENCES invoices(id),  -- linked once invoiced
  paid_at       timestamptz
);

CREATE INDEX idx_milestones_estimate ON payment_milestones(estimate_id);
```

#### Activity & Follow-Up Tables

```sql
-- ═══════════════════════════════════════════════════
-- ACTIVITIES (communication & event log)
-- ═══════════════════════════════════════════════════
CREATE TABLE activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  opportunity_id  uuid REFERENCES opportunities(id),
  client_id       uuid,                    -- persists after deal closes
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


-- ═══════════════════════════════════════════════════
-- FOLLOW-UPS (scheduled tasks)
-- ═══════════════════════════════════════════════════
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
  trigger_source    text,                  -- 'stage_change', 'estimate_sent', 'invoice_overdue'

  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_followups_opp ON follow_ups(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX idx_followups_pending ON follow_ups(company_id, due_at)
  WHERE status = 'pending';
```

#### Infrastructure Tables

```sql
-- ═══════════════════════════════════════════════════
-- GAPLESS NUMBERING (for estimates + invoices)
-- ═══════════════════════════════════════════════════
CREATE TABLE document_sequences (
  company_id        uuid NOT NULL,
  document_type     text NOT NULL CHECK (document_type IN ('estimate','invoice')),
  prefix            text NOT NULL,
  last_number       bigint NOT NULL DEFAULT 0,
  fiscal_year       int NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  PRIMARY KEY (company_id, document_type, fiscal_year)
);

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


-- ═══════════════════════════════════════════════════
-- AUDIT LOG (append-only, for financial records)
-- ═══════════════════════════════════════════════════
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

-- Attach to financial tables
CREATE TRIGGER audit_estimates AFTER INSERT OR UPDATE OR DELETE ON estimates
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

#### Database Triggers

```sql
-- ═══════════════════════════════════════════════════
-- AUTO-UPDATE invoice balance when payments change
-- ═══════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════
-- AUTO-UPDATE opportunity.updated_at on any change
-- ═══════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════
-- ENFORCE valid status transitions
-- ═══════════════════════════════════════════════════
CREATE TABLE valid_status_transitions (
  entity_type  text NOT NULL,
  from_status  text NOT NULL,
  to_status    text NOT NULL,
  PRIMARY KEY (entity_type, from_status, to_status)
);

-- Estimate transitions
INSERT INTO valid_status_transitions (entity_type, from_status, to_status) VALUES
  ('estimate', 'draft', 'sent'),
  ('estimate', 'draft', 'superseded'),
  ('estimate', 'sent', 'viewed'),
  ('estimate', 'sent', 'approved'),
  ('estimate', 'sent', 'declined'),
  ('estimate', 'sent', 'expired'),
  ('estimate', 'sent', 'superseded'),
  ('estimate', 'viewed', 'approved'),
  ('estimate', 'viewed', 'declined'),
  ('estimate', 'viewed', 'expired'),
  ('estimate', 'viewed', 'changes_requested'),
  ('estimate', 'viewed', 'superseded'),
  ('estimate', 'changes_requested', 'draft'),
  ('estimate', 'approved', 'converted');

-- Invoice transitions
INSERT INTO valid_status_transitions (entity_type, from_status, to_status) VALUES
  ('invoice', 'draft', 'sent'),
  ('invoice', 'sent', 'awaiting_payment'),
  ('invoice', 'sent', 'partially_paid'),
  ('invoice', 'sent', 'paid'),
  ('invoice', 'sent', 'past_due'),
  ('invoice', 'sent', 'void'),
  ('invoice', 'awaiting_payment', 'partially_paid'),
  ('invoice', 'awaiting_payment', 'paid'),
  ('invoice', 'awaiting_payment', 'past_due'),
  ('invoice', 'awaiting_payment', 'void'),
  ('invoice', 'partially_paid', 'paid'),
  ('invoice', 'partially_paid', 'past_due'),
  ('invoice', 'past_due', 'partially_paid'),
  ('invoice', 'past_due', 'paid'),
  ('invoice', 'past_due', 'written_off');
```

#### Database Functions (Atomic Operations)

```sql
-- ═══════════════════════════════════════════════════
-- CONVERT ESTIMATE → INVOICE (atomic)
-- ═══════════════════════════════════════════════════
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
```

### Entity Relationship Diagram

```
Company (Bubble) ←──── company_id on ALL Supabase tables

Client (Bubble) ←─────── client_id
  │
  ├──1:N──→ Opportunity
  │           │
  │           ├──1:N──→ Estimate ──1:N──→ Line Items
  │           │           │
  │           │           ├──1:N──→ Payment Milestones
  │           │           │
  │           │           └──converts──→ Invoice ──1:N──→ Line Items
  │           │                           │
  │           │                           └──1:N──→ Payment
  │           │
  │           ├──1:N──→ Activity
  │           ├──1:N──→ Follow-Up
  │           ├──1:N──→ Stage Transition
  │           │
  │           └──1:1──→ Project (Bubble) [on Won conversion]
  │
  └──1:N──→ Activity (client-level, persists across deals)

Products ←── product_id on Line Items (optional catalog reference)
Tax Rates ←── tax_rate_id on Line Items
Pipeline Stage Configs ←── per-company stage definitions
Document Sequences ←── gapless numbering for EST/INV
Audit Log ←── append-only history of all financial changes
```

---

## Part 6: Financial Reports (MVP)

### Must-Have Reports

| Report | What It Shows | Query Pattern |
|--------|--------------|---------------|
| **Accounts Receivable Aging** | Unpaid invoices bucketed by 0-30, 31-60, 61-90, 90+ days | `invoices WHERE status NOT IN ('paid','void') GROUP BY age bucket` |
| **Revenue by Period** | Monthly/quarterly income totals | `SUM(payments.amount) GROUP BY month` |
| **Invoice Summary** | All invoices by status with totals | `invoices GROUP BY status` |
| **Client Balance** | Total outstanding per client | `SUM(invoices.balance_due) GROUP BY client_id` |
| **Payment History** | All payments, filterable by date/client/method | `payments ORDER BY payment_date DESC` |
| **Pipeline Forecast** | Weighted pipeline value by stage | `SUM(estimated_value * win_probability/100) GROUP BY stage` |

### Should-Have Reports (V2)

| Report | What It Shows |
|--------|--------------|
| **Profit & Loss** | Revenue minus expenses by period |
| **Job Profitability** | Revenue vs cost per project (from line item costs + labor) |
| **Estimate Conversion Rate** | % of estimates that become invoices |
| **Pipeline Velocity** | Average time in each stage |
| **Win/Loss Analysis** | Loss reasons, win rate by source/rep |

---

## Part 7: Implementation Phases

### Phase 1 -- Supabase Foundation + Core Pipeline
- Set up Supabase project with Firebase third-party auth
- Create all schema tables, RLS policies, indexes
- Build Supabase client integration alongside existing Bubble client
- Build `opportunities`, `stage_transitions`, `pipeline_stage_configs` tables
- Rewrite pipeline page to query Supabase (not Bubble projects)
- Board + List views with SegmentedPicker
- Quick-add inline form
- Drag-and-drop with proper feedback
- Deal value on cards
- Stage transitions with prompts (Won/Lost)

### Phase 2 -- Deal Sheet, Activity & Follow-Ups
- Build DealSheet slide-out panel
- `activities` table + Activity timeline component
- Inline quick-note on cards
- `follow_ups` table + Follow-up date picker
- Follow-up indicators on cards (amber/red)
- Auto-follow-up creation on stage entry
- Stale deal detection and visual indicators

### Phase 3 -- Estimates
- `products` catalog + `tax_rates` + `line_items` tables
- `estimates` table with gapless numbering
- Estimate builder UI with line items from product catalog
- Estimate versioning (create revision → supersede old)
- Estimate status workflow (Draft → Sent → Approved/Declined)
- Estimate-sent auto-advances opportunity to Quoted
- Estimate-approved auto-advances opportunity to Won
- Optional line items (client selects/deselects)
- Payment milestones for progress billing
- Estimate PDF generation (Supabase Edge Function + Storage)

### Phase 4 -- Invoices & Payments
- `invoices` table with gapless numbering
- `payments` table with balance trigger
- Estimate → Invoice conversion (atomic DB function)
- Invoice builder UI (or auto-generated from estimate)
- Invoice status workflow with overdue detection
- Payment recording (manual: cash/check + future: Stripe)
- Deposit handling (from estimate payment schedule)
- Progress invoicing for milestone-based billing
- Invoice PDF generation + email delivery
- Payment reminders (manual, then automated)

### Phase 5 -- Financial Dashboard & Reporting
- AR Aging report
- Revenue by period report
- Invoice summary dashboard
- Client balance summary
- Payment history log
- Pipeline forecast (weighted)
- Pipeline metrics bar on pipeline page

### Phase 6 -- Integration & Polish
- Won opportunity → Project conversion (creates Bubble project)
- Pipeline activity on Client detail page
- "New Deal" button from Client page
- Client billing hub (all invoices, payments, balance for a client)
- Keyboard shortcuts
- Empty states with guided actions
- Notification store + bell icon integration

---

## Part 8: Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | **Supabase (PostgreSQL)** | Real relational DB, RLS, real-time, Edge Functions, Storage. Future-proof. |
| Auth strategy | **Firebase → Supabase bridge** | No user migration. Works immediately via third-party auth. |
| Opportunity vs Project | **Separate entity in Supabase** | Clean separation of pre-sale and post-sale. Multiple opps per client. |
| Line items | **Normalized table (NOT JSONB)** | 2000x faster queries, individual item updates, proper indexes |
| Monetary values | **NUMERIC(12,2)** | Exact arithmetic, no floating-point errors, supports $9.99B |
| Document numbering | **Gapless sequences** (counter table) | Legal compliance -- invoice numbers can't have gaps |
| Quote versioning | **Parent-child** (estimate → revision chain) | Clean history, old versions preserved immutably |
| Invoice balance | **Trigger-maintained** | Auto-updates on payment insert/update/delete. Always consistent. |
| Financial audit | **Append-only audit_log** | Immutable history of all changes to financial records |
| Status transitions | **DB-enforced state machine** | Invalid transitions rejected at database level, not just UI |
| Detail view | **Slide-out panel** (not modal) | Keeps board visible. Fast open/close flow. |
| Card density | **Minimal + hover actions** | Clean default, power on interaction |
| Stale alerts | **Visual on card** (border color) | Impossible to miss. Drives daily behavior. |
| Mobile | **Not in v1 scope** | Desktop-first. Mobile is Phase 7+. |
