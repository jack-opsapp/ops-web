# OPS Web — Verified Data Architecture Reference

> **Generated**: 2026-04-09  
> **Source of truth**: Every table, column, and constraint verified against migration SQL files and service TypeScript code.  
> **Scope**: All 57 migration files (EXECUTED/ + incremental) + all service files in `src/lib/api/services/`.

---

## Table of Contents

1. [Discrepancy Resolutions](#1-discrepancy-resolutions)
2. [Table Schema Reference](#2-table-schema-reference)
3. [Entity Relationships](#3-entity-relationships)
4. [Status Lifecycles](#4-status-lifecycles)
5. [RPC Functions](#5-rpc-functions)
6. [Service Column Mappings](#6-service-column-mappings)
7. [Inventory System](#7-inventory-system)
8. [Safe Patterns](#8-safe-patterns)
9. [Known Issues](#9-known-issues)

---

## 1. Discrepancy Resolutions

### 1a. `task_types` vs `task_types_v2`

**Migration truth**: Migration 004 creates `task_types_v2`. No migration creates a view or alias.

**Code truth**: Most services query `.from("task_types")` (task-type-service, task-service joins, calendar-service joins, project-lifecycle-service, business-context-service, mine-database route, initialize_company_defaults RPC). A minority use `task_types_v2` (admin-queries.ts, export route, delete-account route, project-suggestion-service).

**Resolution**: Migration `058_rename_task_types_v2.sql` renames the table from `task_types_v2` to `task_types`. All 4 source files that referenced `task_types_v2` have been updated. The table is now `task_types` everywhere — code and database.

### 1b. `admin_ids` column type

**Migration truth** (004_core_entities.sql line 65): `admin_ids TEXT[] DEFAULT '{}'`

**Code truth**: Every service casts it as `(row.admin_ids as string[])`. PostgREST returns PostgreSQL `TEXT[]` as a JSON array. The company-service reads and writes it as `string[]`.

**Resolution**: `admin_ids` is `TEXT[]` (PostgreSQL text array). NOT comma-separated, NOT JSONB. The iOS app's `adminIdsString` comma-separated format is a different representation of the same data.

### 1c. Project task status values

**Migration truth** (004 CHECK): `'Booked', 'In Progress', 'Completed', 'Cancelled'` (Title Case). No migration file under `supabase/migrations/` alters this constraint.

**Production truth** (verified 2026-04-13 against live `ijeekuhbatykdomumfjx` project via PostgREST service-role query over 265 rows):

```
SELECT status, COUNT(*) FROM project_tasks WHERE deleted_at IS NULL;
→ active: 104, completed: 157, cancelled: 4
```

The CHECK constraint was dropped or altered out-of-band — no migration file records the change, but the table unambiguously stores lowercase. Title Case is **not** valid in production; queries written as `.eq("status", "Booked")` return zero rows.

Also notable: `in_progress` is not represented at all in the task data — project_tasks only uses `active`, `completed`, `cancelled` in practice. The `TaskStatus.InProgress` enum value in the TypeScript code has no data behind it today, but the parser still accepts it for forward-compatibility.

**Resolution (final — this is the production contract):** canonical task status values are `active`, `completed`, `cancelled` (lowercase). The parser `parseTaskStatus()` accepts both `booked` and `active` for forward-compat; the serializer `serializeTaskStatus()` **must** emit lowercase. Any query touching `project_tasks.status` must use lowercase values.

### 1d. Project status values

**Migration truth** (004 CHECK): `'RFQ', 'Estimated', 'Accepted', 'In Progress', 'Completed', 'Closed', 'Archived'` (Title Case).

**Production truth** (verified 2026-04-13 against live data — 241 rows):

```
SELECT status, COUNT(*) FROM projects WHERE deleted_at IS NULL;
→ rfq: 12, estimated: 11, accepted: 16, in_progress: 26,
  completed: 29, closed: 100, archived: 47
```

All seven lifecycle stages are represented, all lowercase with snake_case for `in_progress`. Title Case values don't exist in the table.

**Resolution (final — this is the production contract):** canonical project status values are `rfq`, `estimated`, `accepted`, `in_progress`, `completed`, `closed`, `archived`. Serializer must emit lowercase. Any query touching `projects.status` must use lowercase values.

### 1c/1d. Why the S2 amendment made things worse

A previous fix pass ("S2 amendment") incorrectly "reconciled" the code against the migration file rather than the live database. It rewrote `serializeTaskStatus` and `serializeProjectStatus` to emit Title Case and added Title Case `.eq`/`.in` queries across ten service files. The amendment did not re-verify against production; because the prod CHECK constraint had been silently relaxed, the Title Case queries simply returned zero rows instead of crashing — which masked the regression. This Phase C final pass reverts all Title Case queries to lowercase to match the live database.

### 1e. `estimates.project_id` vs `invoices.project_id` type mismatch

**Migration truth**:
- `estimates.project_id` = `TEXT` (added in migration 002, stores Bubble ID)
- `invoices.project_id` = `uuid` (declared in migration 001, but comment says "Bubble project ID")
- Both tables have `project_ref UUID REFERENCES projects(id)` (added in migration 005) as the proper FK

**Resolution**: `project_ref` is the correct FK column for both tables. `project_id` on both is a legacy Bubble reference. New code should use `project_ref` for proper FK joins. Both estimate-service and invoice-service currently read `project_id` as a plain string.

### 1f. `line_items.line_total` is GENERATED ALWAYS

**Confirmed** (001_pipeline_schema.sql line 347):
```sql
line_total numeric(12,2) GENERATED ALWAYS AS (
  ROUND(quantity * unit_price * (1 - COALESCE(discount_percent, 0) / 100), 2)
) STORED
```

Both estimate-service.ts and invoice-service.ts correctly exclude `line_total` from INSERT/UPDATE operations. **Never write `line_total`** — it is auto-computed from `quantity`, `unit_price`, and `discount_percent`.

### 1g. Invoice `amount_paid` and `balance_due` are trigger-maintained

**Confirmed** (001_pipeline_schema.sql line 564):
```sql
CREATE OR REPLACE FUNCTION update_invoice_balance() ...
CREATE TRIGGER trg_payment_balance
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_invoice_balance();
```

**Trigger behavior**: When a payment is inserted/updated/deleted:
1. Sums all non-voided payments for the invoice (`WHERE voided_at IS NULL`)
2. Sets `amount_paid = total_paid`
3. Sets `balance_due = invoice.total - total_paid`
4. Auto-sets `status = 'paid'` if `total_paid >= total`, or `'partially_paid'` if `total_paid > 0`
5. Sets `paid_at = now()` when fully paid, `NULL` otherwise

Invoice-service.ts correctly treats `amount_paid`, `balance_due`, and `deposit_applied` as **read-only**.

### 1h. Invoice/estimate number generation

**Confirmed** (001_pipeline_schema.sql line 662):
```sql
CREATE OR REPLACE FUNCTION get_next_document_number(
  p_company_id uuid, p_type text
) RETURNS text
```

Returns gapless numbers like `'EST-2026-00042'` or `'INV-2026-00001'`. Uses `document_sequences` table with per-company, per-type, per-fiscal-year tracking. Both estimate-service and invoice-service call this RPC. **Any code creating invoices/estimates MUST call this RPC** — never generate numbers manually.

### 1i. `convert_estimate_to_invoice` RPC

**Confirmed** (001_pipeline_schema.sql line 691). Steps:
1. Validates estimate status is `'approved'` (raises exception otherwise)
2. Calls `get_next_document_number` for gapless invoice number
3. Creates invoice with all financial fields copied from estimate
4. Copies line items (skips `is_optional = true AND is_selected = false`)
5. Marks estimate as `status = 'converted'`
6. Logs activity record
7. Returns new invoice UUID

Called by estimate-service.ts via `supabase.rpc("convert_estimate_to_invoice", { p_estimate_id, p_due_date })`.

---

## 2. Table Schema Reference

### Pipeline & Financial Tables (Migration 001)

#### `pipeline_stage_configs`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| company_id | uuid | NOT NULL | | |
| name | text | NOT NULL | | |
| slug | text | NOT NULL | | UNIQUE(company_id, slug) |
| color | text | NOT NULL | '#BCBCBC' | |
| icon | text | YES | | |
| sort_order | int | NOT NULL | 0 | |
| is_default | boolean | YES | false | |
| is_won_stage | boolean | YES | false | |
| is_lost_stage | boolean | YES | false | |
| default_win_probability | int | YES | 10 | |
| auto_follow_up_days | int | YES | | |
| auto_follow_up_type | text | YES | | |
| stale_threshold_days | int | YES | 7 | |
| created_at | timestamptz | YES | now() | |
| deleted_at | timestamptz | YES | | |

#### `opportunities`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| company_id | uuid | NOT NULL | | |
| client_id | uuid | YES | | |
| title | text | NOT NULL | | |
| description | text | YES | | |
| contact_name | text | YES | | |
| contact_email | text | YES | | |
| contact_phone | text | YES | | |
| stage | text | NOT NULL | 'new_lead' | CHECK: see §4 |
| source | text | YES | | CHECK: referral,website,email,phone,walk_in,social_media,repeat_client,other |
| assigned_to | uuid | YES | | |
| priority | text | YES | | CHECK: low,medium,high |
| estimated_value | numeric(12,2) | YES | | |
| actual_value | numeric(12,2) | YES | | |
| win_probability | int | YES | 10 | CHECK: 0-100 |
| expected_close_date | date | YES | | |
| actual_close_date | date | YES | | |
| stage_entered_at | timestamptz | NOT NULL | now() | |
| project_id | uuid | YES | | |
| lost_reason | text | YES | | |
| lost_notes | text | YES | | |
| address | text | YES | | |
| last_activity_at | timestamptz | YES | | |
| next_follow_up_at | timestamptz | YES | | |
| tags | text[] | YES | | |
| created_at | timestamptz | NOT NULL | now() | |
| updated_at | timestamptz | NOT NULL | now() | |
| deleted_at | timestamptz | YES | | |
| source_email_id | text | YES | | (mig 002) |
| client_ref | uuid | YES | | FK → clients(id) (mig 005) |
| project_ref | uuid | YES | | FK → projects(id) (mig 005) |
| correspondence_count | int | YES | 0 | (mig 035) |
| outbound_count | int | YES | 0 | (mig 035) |
| inbound_count | int | YES | 0 | (mig 035) |
| last_inbound_at | timestamptz | YES | | (mig 035) |
| last_outbound_at | timestamptz | YES | | (mig 035) |
| last_message_direction | text | YES | | (mig 035) |
| ai_stage_confidence | float | YES | | (mig 035) |
| ai_stage_signals | text[] | YES | | (mig 035) |
| detected_value | int | YES | | (mig 035) |
| stage_manually_set | boolean | NOT NULL | false | (mig 037) |
| ai_summary | text | YES | | (mig 038) |
| images | text[] | YES | '{}' | (mig 041) |

**Triggers**: `trg_opp_timestamp` (update_timestamp), `audit` (not present — only on financial tables)

#### `estimates`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| company_id | uuid | NOT NULL | | |
| opportunity_id | uuid | YES | | FK → opportunities(id) |
| client_id | uuid | NOT NULL | | |
| estimate_number | text | NOT NULL | | UNIQUE(company_id, estimate_number) |
| version | int | NOT NULL | 1 | |
| parent_id | uuid | YES | | FK → estimates(id) (self-ref) |
| title | text | YES | | |
| client_message | text | YES | | |
| internal_notes | text | YES | | |
| terms | text | YES | | |
| subtotal | numeric(12,2) | NOT NULL | 0 | |
| discount_type | text | YES | | CHECK: percentage,fixed |
| discount_value | numeric(12,2) | YES | | |
| discount_amount | numeric(12,2) | NOT NULL | 0 | |
| tax_rate | numeric(6,4) | YES | | |
| tax_amount | numeric(12,2) | NOT NULL | 0 | |
| total | numeric(12,2) | NOT NULL | 0 | |
| deposit_type | text | YES | | CHECK: percentage,fixed |
| deposit_value | numeric(12,2) | YES | | |
| deposit_amount | numeric(12,2) | YES | | |
| status | text | NOT NULL | 'draft' | CHECK: see §4 |
| issue_date | date | NOT NULL | CURRENT_DATE | |
| expiration_date | date | YES | | |
| sent_at | timestamptz | YES | | |
| viewed_at | timestamptz | YES | | |
| approved_at | timestamptz | YES | | |
| pdf_storage_path | text | YES | | |
| created_by | uuid | YES | | |
| created_at | timestamptz | NOT NULL | now() | |
| updated_at | timestamptz | NOT NULL | now() | |
| deleted_at | timestamptz | YES | | |
| project_id | text | YES | | Bubble ID (mig 002) |
| client_ref | uuid | YES | | FK → clients(id) (mig 005) |
| project_ref | uuid | YES | | FK → projects(id) (mig 005) |
| qb_id | text | YES | | (mig 008) |
| sage_id | text | YES | | (mig 019) |

**Triggers**: trg_estimate_timestamp, audit_estimates

#### `invoices`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| company_id | uuid | NOT NULL | | |
| client_id | uuid | NOT NULL | | |
| estimate_id | uuid | YES | | FK → estimates(id) |
| opportunity_id | uuid | YES | | FK → opportunities(id) |
| project_id | uuid | YES | | Legacy Bubble ref |
| invoice_number | text | NOT NULL | | UNIQUE(company_id, invoice_number) |
| subject | text | YES | | |
| client_message | text | YES | | |
| internal_notes | text | YES | | |
| footer | text | YES | | |
| terms | text | YES | | |
| subtotal | numeric(12,2) | NOT NULL | 0 | |
| discount_type | text | YES | | CHECK: percentage,fixed |
| discount_value | numeric(12,2) | YES | | |
| discount_amount | numeric(12,2) | NOT NULL | 0 | |
| tax_rate | numeric(6,4) | YES | | |
| tax_amount | numeric(12,2) | NOT NULL | 0 | |
| total | numeric(12,2) | NOT NULL | 0 | |
| amount_paid | numeric(12,2) | NOT NULL | 0 | **TRIGGER-MAINTAINED** |
| balance_due | numeric(12,2) | NOT NULL | 0 | **TRIGGER-MAINTAINED** |
| deposit_applied | numeric(12,2) | NOT NULL | 0 | |
| status | text | NOT NULL | 'draft' | CHECK: see §4 |
| issue_date | date | NOT NULL | CURRENT_DATE | |
| due_date | date | NOT NULL | | |
| payment_terms | text | YES | | |
| sent_at | timestamptz | YES | | |
| viewed_at | timestamptz | YES | | |
| paid_at | timestamptz | YES | | **TRIGGER-SET** |
| pdf_storage_path | text | YES | | |
| created_by | uuid | YES | | |
| created_at | timestamptz | NOT NULL | now() | |
| updated_at | timestamptz | NOT NULL | now() | |
| deleted_at | timestamptz | YES | | |
| client_ref | uuid | YES | | FK → clients(id) (mig 005) |
| project_ref | uuid | YES | | FK → projects(id) (mig 005) |
| qb_id | text | YES | | (mig 008) |
| sage_id | text | YES | | (mig 019) |

**Triggers**: trg_invoice_timestamp, audit_invoices

#### `line_items`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| company_id | uuid | NOT NULL | | |
| estimate_id | uuid | YES | | FK → estimates(id) |
| invoice_id | uuid | YES | | FK → invoices(id) |
| product_id | uuid | YES | | FK → products(id) |
| name | text | NOT NULL | | |
| description | text | YES | | |
| quantity | numeric(10,3) | NOT NULL | 1 | |
| unit | text | YES | 'each' | |
| unit_price | numeric(12,2) | NOT NULL | 0 | |
| unit_cost | numeric(12,2) | YES | | |
| discount_percent | numeric(5,2) | YES | 0 | |
| is_taxable | boolean | YES | true | |
| tax_rate_id | uuid | YES | | FK → tax_rates(id) |
| line_total | numeric(12,2) | | | **GENERATED ALWAYS** |
| is_optional | boolean | YES | false | |
| is_selected | boolean | YES | true | |
| sort_order | int | NOT NULL | 0 | |
| category | text | YES | | |
| service_date | date | YES | | |
| created_at | timestamptz | YES | now() | |
| type | text | NOT NULL | 'LABOR' | CHECK: LABOR,MATERIAL,OTHER (mig 002) |
| task_type_id | text | YES | | Bubble ID (mig 002) |
| estimated_hours | numeric(6,2) | YES | | (mig 002) |
| task_type_ref | uuid | YES | | FK → task_types_v2(id) (mig 005) |
| parent_line_item_id | uuid | YES | | FK → line_items(id) CASCADE (mig 052) |

**CHECK**: Exactly one of estimate_id/invoice_id must be non-null.

#### `payments`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| company_id | uuid | NOT NULL | | |
| invoice_id | uuid | NOT NULL | | FK → invoices(id) |
| client_id | uuid | NOT NULL | | |
| amount | numeric(12,2) | NOT NULL | | |
| payment_method | text | YES | | CHECK: credit_card,debit_card,ach,cash,check,bank_transfer,stripe,other |
| reference_number | text | YES | | |
| notes | text | YES | | |
| payment_date | date | NOT NULL | CURRENT_DATE | |
| stripe_payment_intent | text | YES | | |
| created_by | uuid | YES | | |
| created_at | timestamptz | NOT NULL | now() | |
| voided_at | timestamptz | YES | | |
| voided_by | uuid | YES | | |
| qb_id | text | YES | | (mig 008) |
| sage_id | text | YES | | (mig 019) |

**Triggers**: trg_payment_balance (updates invoice), audit_payments

#### `products`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| company_id | uuid | NOT NULL | | |
| name | text | NOT NULL | | |
| description | text | YES | | |
| default_price | numeric(12,2) | NOT NULL | 0 | |
| unit_cost | numeric(12,2) | YES | | |
| unit | text | YES | 'each' | |
| category | text | YES | | |
| is_taxable | boolean | YES | true | |
| is_active | boolean | YES | true | |
| type | text | NOT NULL | 'LABOR' | CHECK: LABOR,MATERIAL,OTHER (mig 002) |
| task_type_id | text | YES | | Bubble ID (mig 002) |
| task_type_ref | uuid | YES | | FK → task_types_v2(id) (mig 005) |
| qb_id | text | YES | | (mig 008) |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| deleted_at | timestamptz | YES | | |

#### `tax_rates`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | PK | gen_random_uuid() |
| company_id | uuid | NOT NULL | |
| name | text | NOT NULL | |
| rate | numeric(6,4) | NOT NULL | |
| is_default | boolean | YES | false |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |

#### `payment_milestones`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | PK | gen_random_uuid() |
| estimate_id | uuid | NOT NULL | FK → estimates(id) |
| name | text | NOT NULL | |
| type | text | NOT NULL | CHECK: percentage,fixed |
| value | numeric(12,2) | NOT NULL | |
| amount | numeric(12,2) | NOT NULL | |
| sort_order | int | NOT NULL | 0 |
| invoice_id | uuid | YES | FK → invoices(id) |
| paid_at | timestamptz | YES | |

No company_id — scoped via parent estimate.

#### `document_sequences`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| company_id | uuid | NOT NULL | PK (composite) |
| document_type | text | NOT NULL | PK. CHECK: estimate,invoice |
| prefix | text | NOT NULL | |
| last_number | bigint | NOT NULL | 0 |
| fiscal_year | int | NOT NULL | PK. EXTRACT(YEAR FROM CURRENT_DATE) |

#### `activities`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| company_id | uuid | NOT NULL | | |
| opportunity_id | uuid | YES | | FK → opportunities(id) |
| client_id | uuid | YES | | |
| estimate_id | uuid | YES | | FK → estimates(id) |
| invoice_id | uuid | YES | | FK → invoices(id) |
| type | text | NOT NULL | | CHECK: 16 types (see below) |
| subject | text | NOT NULL | | |
| content | text | YES | | |
| outcome | text | YES | | |
| direction | text | YES | | CHECK: inbound,outbound |
| duration_minutes | int | YES | | |
| created_by | uuid | YES | | |
| created_at | timestamptz | NOT NULL | now() | |
| attachments | text[] | YES | '{}' | (mig 002) |
| email_thread_id | text | YES | | (mig 002) |
| email_message_id | text | YES | | (mig 002) |
| is_read | boolean | NOT NULL | TRUE | (mig 002) |
| site_visit_id | uuid | YES | | FK → site_visits(id) (mig 002) |
| project_id | text | YES | | (mig 002) |
| from_email | text | YES | | (mig 002) |
| match_confidence | text | YES | | (mig 021) |
| match_needs_review | boolean | NOT NULL | false | (mig 021) |
| suggested_client_id | uuid | YES | | (mig 021) |
| to_emails | text[] | YES | '{}' | (mig 037) |
| cc_emails | text[] | YES | '{}' | (mig 037) |
| body_text | text | YES | | (mig 037) |
| has_attachments | boolean | NOT NULL | false | (mig 037) |
| attachment_count | int | NOT NULL | 0 | (mig 037) |

Activity type CHECK: `note, email, call, meeting, estimate_sent, estimate_accepted, estimate_declined, invoice_sent, payment_received, stage_change, created, won, lost, system, site_visit, site_visit_scheduled`

#### `follow_ups`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | PK | gen_random_uuid() |
| company_id | uuid | NOT NULL | |
| opportunity_id | uuid | YES | FK → opportunities(id) |
| client_id | uuid | YES | |
| type | text | NOT NULL | CHECK: call,email,meeting,quote_follow_up,invoice_follow_up,custom |
| title | text | NOT NULL | |
| description | text | YES | |
| due_at | timestamptz | NOT NULL | |
| reminder_at | timestamptz | YES | |
| completed_at | timestamptz | YES | |
| assigned_to | uuid | YES | |
| status | text | NOT NULL | 'pending'. CHECK: pending,completed,skipped |
| completion_notes | text | YES | |
| is_auto_generated | boolean | YES | false |
| trigger_source | text | YES | |
| created_by | uuid | YES | |
| created_at | timestamptz | NOT NULL | now() |

#### `stage_transitions`
Immutable audit log. Columns: id, company_id, opportunity_id (FK), from_stage, to_stage, transitioned_at, transitioned_by, duration_in_stage (interval).

#### `valid_status_transitions`
Reference data. PK: (entity_type, from_status, to_status). Readable by all authenticated users.

#### `audit_log`
Append-only (REVOKE UPDATE, DELETE). Columns: id (bigserial), table_name, record_id (uuid), company_id (uuid), action (INSERT/UPDATE/DELETE), old_data (jsonb), new_data (jsonb), changed_by (uuid), changed_at.

### Core Entity Tables (Migration 004)

#### `companies`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| bubble_id | text | YES | | UNIQUE |
| name | text | NOT NULL | | |
| external_id | text | YES | | |
| description | text | YES | | |
| website | text | YES | | |
| phone | text | YES | | |
| email | text | YES | | |
| address | text | YES | | |
| latitude | double precision | YES | | |
| longitude | double precision | YES | | |
| open_hour | text | YES | | |
| close_hour | text | YES | | |
| logo_url | text | YES | | |
| default_project_color | text | YES | '#9CA3AF' | |
| industries | text[] | YES | '{}' | |
| company_size | text | YES | | |
| company_age | text | YES | | |
| referral_method | text | YES | | |
| account_holder_id | text | YES | | |
| **admin_ids** | **text[]** | YES | '{}' | **PostgreSQL text array** |
| seated_employee_ids | text[] | YES | '{}' | |
| max_seats | int | YES | 10 | |
| subscription_status | text | YES | | CHECK: trial,active,grace,expired,cancelled |
| subscription_plan | text | YES | | CHECK: trial,starter,team,business |
| subscription_end | timestamptz | YES | | |
| subscription_period | text | YES | | CHECK: Monthly,Annual |
| trial_start_date | timestamptz | YES | | |
| trial_end_date | timestamptz | YES | | |
| seat_grace_start_date | timestamptz | YES | | |
| has_priority_support | boolean | YES | FALSE | |
| data_setup_purchased | boolean | YES | FALSE | |
| data_setup_completed | boolean | YES | FALSE | |
| data_setup_scheduled | timestamptz | YES | | |
| stripe_customer_id | text | YES | | |
| subscription_ids_json | text | YES | | |
| weather_dependent | boolean | YES | NULL | (mig 027) |
| created_at | timestamptz | YES | NOW() | |
| updated_at | timestamptz | YES | NOW() | |
| deleted_at | timestamptz | YES | | |

#### `users`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| bubble_id | text | YES | UNIQUE | |
| company_id | uuid | YES | | FK → companies(id) ON DELETE SET NULL |
| first_name | text | NOT NULL | | |
| last_name | text | NOT NULL | | |
| email | text | YES | | |
| phone | text | YES | | |
| home_address | text | YES | | |
| profile_image_url | text | YES | | |
| user_color | text | YES | | |
| role | text | YES | | CHECK (mig 031): admin,owner,office,operator,crew,unassigned |
| user_type | text | YES | | CHECK: Employee,Company,Client,Admin |
| is_company_admin | boolean | YES | FALSE | |
| has_completed_tutorial | boolean | YES | FALSE | |
| dev_permission | boolean | YES | FALSE | |
| latitude | double precision | YES | | |
| longitude | double precision | YES | | |
| location_name | text | YES | | |
| client_id | text | YES | | |
| is_active | boolean | YES | TRUE | |
| stripe_customer_id | text | YES | | |
| device_token | text | YES | | |
| auth_id | **text** | YES | UNIQUE | Changed from UUID to TEXT (mig 023) |
| special_permissions | text[] | YES | '{}' | (mig 011) |
| onboarding_completed | jsonb | YES | '{}' | Replaced has_completed_onboarding (mig 026) |
| created_at | timestamptz | YES | NOW() | |
| updated_at | timestamptz | YES | NOW() | |
| deleted_at | timestamptz | YES | | |

**Note**: `has_completed_onboarding` was DROPPED in mig 026 and replaced by `onboarding_completed JSONB`.

#### `clients`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | PK | gen_random_uuid() |
| bubble_id | text | YES | UNIQUE |
| company_id | uuid | NOT NULL | FK → companies(id) CASCADE |
| name | text | NOT NULL | |
| email | text | YES | |
| **phone_number** | text | YES | NOT "phone" |
| notes | text | YES | |
| address | text | YES | |
| latitude | double precision | YES | |
| longitude | double precision | YES | |
| profile_image_url | text | YES | |
| qb_id | text | YES | (mig 008) |
| sage_id | text | YES | (mig 019) |
| created_at/updated_at/deleted_at | timestamptz | | |

#### `sub_clients`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | PK | gen_random_uuid() |
| bubble_id | text | YES | UNIQUE |
| client_id | uuid | NOT NULL | FK → clients(id) CASCADE |
| company_id | uuid | NOT NULL | FK → companies(id) CASCADE |
| name | text | NOT NULL | |
| title | text | YES | |
| email | text | YES | |
| **phone_number** | text | YES | NOT "phone" |
| address | text | YES | |
| created_at/updated_at/deleted_at | timestamptz | | |

#### `task_types` (renamed from `task_types_v2` in migration 058)
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | PK | gen_random_uuid() |
| bubble_id | text | YES | UNIQUE |
| company_id | uuid | NOT NULL | FK → companies(id) CASCADE |
| display | text | NOT NULL | NOT "name" |
| color | text | NOT NULL | '#417394' |
| icon | text | YES | |
| is_default | boolean | YES | FALSE |
| display_order | int | YES | 0 |
| default_team_member_ids | text[] | YES | '{}' |
| created_at/updated_at/deleted_at | timestamptz | | |

#### `projects`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| bubble_id | text | YES | UNIQUE | |
| company_id | uuid | NOT NULL | FK → companies CASCADE | |
| client_id | uuid | YES | FK → clients SET NULL | |
| title | text | NOT NULL | | |
| address | text | YES | | |
| latitude | double precision | YES | | |
| longitude | double precision | YES | | |
| status | text | NOT NULL | 'RFQ' | CHECK: see §4 |
| notes | text | YES | | |
| description | text | YES | | |
| all_day | boolean | YES | FALSE | |
| project_images | text[] | YES | '{}' | |
| team_member_ids | text[] | YES | '{}' | |
| opportunity_id | text | YES | | |
| start_date | timestamptz | YES | | |
| end_date | timestamptz | YES | | |
| duration | int | YES | | |
| created_at/updated_at/deleted_at | timestamptz | | | |

#### `calendar_events` (DEPRECATED for reads — use project_tasks)
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | PK | gen_random_uuid() |
| bubble_id | text | YES | UNIQUE |
| company_id | uuid | NOT NULL | FK → companies CASCADE |
| project_id | uuid | YES | FK → projects CASCADE |
| title | text | NOT NULL | |
| color | text | YES | '#417394' |
| start_date | timestamptz | YES | |
| end_date | timestamptz | YES | |
| duration | int | YES | 1 |
| team_member_ids | text[] | YES | '{}' |
| created_at/updated_at/deleted_at | timestamptz | | |

**Notable absences**: No `task_id`, no `all_day`, no `event_type` in the migration. calendar-service.ts writes `task_id`, `event_type`, `opportunity_id`, `site_visit_id` — these columns were added directly in Supabase.

#### `project_tasks`
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | PK | gen_random_uuid() | |
| bubble_id | text | YES | UNIQUE | |
| company_id | uuid | NOT NULL | FK → companies CASCADE | |
| project_id | uuid | NOT NULL | FK → projects CASCADE | |
| task_type_id | uuid | YES | FK → task_types_v2 SET NULL | |
| calendar_event_id | uuid | YES | FK → calendar_events SET NULL | |
| custom_title | text | YES | | NOT "title" |
| task_notes | text | YES | | NOT "notes" |
| status | text | NOT NULL | 'Booked' | CHECK: see §4 |
| task_color | text | YES | '#417394' | |
| display_order | int | YES | 0 | |
| team_member_ids | text[] | YES | '{}' | |
| source_line_item_id | text | YES | | |
| source_estimate_id | text | YES | | |
| start_date | timestamptz | YES | | (mig 057) |
| end_date | timestamptz | YES | | (mig 057) |
| duration | int | YES | 1 | (mig 057) |
| start_time | text | YES | | (mig 057) |
| end_time | text | YES | | (mig 057) |
| created_at/updated_at/deleted_at | timestamptz | | | |

### RBAC System (Migration 015)

#### `roles`
PK: id (uuid). Columns: name, description, is_preset (boolean), company_id (uuid FK, NULL for presets), hierarchy (int, 1=Admin highest).

Preset role UUIDs:
- `00000000-...-000000000001` = Admin (hierarchy 1)
- `00000000-...-000000000002` = Owner (hierarchy 2)
- `00000000-...-000000000003` = Office (hierarchy 3)
- `00000000-...-000000000004` = Operator (hierarchy 4)
- `00000000-...-000000000005` = Crew (hierarchy 5)
- `00000000-...-000000000006` = Unassigned (referenced in join_user_to_company)

#### `role_permissions`
PK: (role_id, permission). permission is `app_permission` enum (~59 values). scope is `permission_scope` enum (all, assigned, own).

#### `user_roles`
PK: user_id (uuid FK → users). role_id (uuid FK → roles). assigned_at, assigned_by.

### Other Notable Tables

| Table | Migration | Key Columns |
|-------|-----------|-------------|
| `notifications` | 006 | user_id TEXT, company_id TEXT, type, title, body, is_read, persistent*, action_url*, action_label* |
| `notification_preferences` | 018, 042, 046 | user_id UUID, company_id UUID, channel_preferences JSONB |
| `team_invitations` | 024 | company_id UUID FK, email, phone, role_id FK, status CHECK |
| `feature_flags` | 020 | slug TEXT PK, enabled BOOLEAN |
| `feature_flag_overrides` | 020 | flag_slug FK, user_id UUID |
| `email_connections` | 002→034 | Renamed from gmail_connections. provider, ai_review_enabled, status |
| `email_templates` | 039 | company_id UUID FK, category CHECK, is_active |
| `agent_memories` | 036, 053 | embedding halfvec(1536), decay_score, entity_id FK |
| `agent_knowledge_graph` | 036, 053 | subject/object text-based + entity-linked edges |
| `agent_writing_profiles` | 036, 053 | profile_type, per-user writing style data |
| `graph_entities` | 053 | entity_type, normalized_name, embedding vector(1536) |
| `agent_actions` | 056 | action_type, action_data JSONB, status, confidence |
| `deck_designs` | 050 | drawing_data JSONB, company_id TEXT |
| `duplicate_reviews` | 047 | entity_type, entity_a_id < entity_b_id, confidence |
| `analytics_events` | 048 | event_type, event_name, platform, session_id |
| `crew_locations` | 022 | PK: user_id, lat/lng, battery_level |
| `accounting_connections` | 008 | company_id TEXT, provider, OAuth tokens |
| `accounting_sync_log` | 008 | direction, entity_type, status |
| `company_settings` | 002 | PK: company_id TEXT |
| `project_notes` | 003 | project_id TEXT, attachments JSONB, mentioned_user_ids TEXT[] |
| `site_visits` | 002 | status enum(scheduled,in_progress,completed,cancelled) |
| `project_photos` | 002, 043 | source enum, is_client_visible |
| `project_photo_annotations` | 012 | photo_url, annotation_url |
| Portal tables | 007, 013, 044 | portal_tokens, portal_sessions, portal_branding, line_item_questions, line_item_answers, portal_messages |
| Blog tables | 009 | blog_categories, blog_topics, blog_posts |
| `document_templates` | (no migration) | Template visibility and branding overrides |
| `expense_settings` | (no migration) | company_id PK, review_frequency, thresholds |

*Columns marked with * were added directly in Supabase, not tracked in migrations.

---

## 3. Entity Relationships

### Financial Entity Graph

```
opportunities ─┬─→ estimates ──→ line_items ←── products
                │       │              │              │
                │       ↓              │              ↓
                ├─→ invoices ──→ line_items      tax_rates
                │       │
                │       ↓
                └── payments
                        │
                        ↓ (trigger)
                    invoices.amount_paid / balance_due
```

### Core Entity Graph

```
companies ──┬── users
            ├── clients ──── sub_clients
            ├── projects ──── project_tasks ──── task_types_v2
            │       │              │
            │       └──── calendar_events (deprecated for reads)
            ├── opportunities
            └── roles ──── role_permissions
                  │
                  └── user_roles
```

### FK Direction and Cardinality

| From | To | Column | Cardinality | ON DELETE |
|------|----|--------|-------------|-----------|
| users.company_id | companies.id | FK | N:1 | SET NULL |
| clients.company_id | companies.id | FK | N:1 | CASCADE |
| sub_clients.client_id | clients.id | FK | N:1 | CASCADE |
| projects.company_id | companies.id | FK | N:1 | CASCADE |
| projects.client_id | clients.id | FK | N:1 | SET NULL |
| project_tasks.project_id | projects.id | FK | N:1 | CASCADE |
| project_tasks.task_type_id | task_types_v2.id | FK | N:1 | SET NULL |
| estimates.opportunity_id | opportunities.id | FK | N:1 | (default) |
| estimates.client_id | — | uuid | N:1 | No FK |
| invoices.estimate_id | estimates.id | FK | N:1 | (default) |
| invoices.opportunity_id | opportunities.id | FK | N:1 | (default) |
| line_items.estimate_id | estimates.id | FK | N:1 | (default) |
| line_items.invoice_id | invoices.id | FK | N:1 | (default) |
| line_items.product_id | products.id | FK | N:1 | (default) |
| payments.invoice_id | invoices.id | FK | N:1 | (default) |
| estimates.project_ref | projects.id | FK | N:1 | SET NULL |
| invoices.project_ref | projects.id | FK | N:1 | SET NULL |

---

## 4. Status Lifecycles

### Opportunity Stages
`new_lead → qualifying → quoting → quoted → follow_up → negotiation → won | lost | discarded`

### Estimate Statuses
`draft → sent → viewed → approved → converted` (via RPC)
`draft → sent → viewed → changes_requested → draft` (revision cycle)
`draft → sent → viewed → declined`
`draft → expired`
`draft → superseded` (new version created)

### Invoice Statuses
`draft → sent → awaiting_payment → partially_paid → paid` (via payment trigger)
`draft → sent → past_due`
`draft → void`
`draft → written_off`

### Project Statuses (lowercase canonical)
`rfq → estimated → accepted → in_progress → completed → closed → archived`

### Task Statuses (lowercase canonical)
`active → in_progress → completed`
`active → cancelled`

### Follow-Up Statuses
`pending → completed | skipped`

### Site Visit Statuses (enum)
`scheduled → in_progress → completed | cancelled`

### Agent Action Statuses
`pending → approved → executed | failed`
`pending → rejected | expired | cancelled`

---

## 5. RPC Functions

### Financial RPCs

| Function | Params | Returns | Notes |
|----------|--------|---------|-------|
| `get_next_document_number` | (company_id uuid, type text) | text | Gapless: 'EST-2026-00042' |
| `convert_estimate_to_invoice` | (estimate_id uuid, due_date date DEFAULT +30d) | uuid | SECURITY DEFINER. Only approved estimates. |

### User/Auth RPCs

| Function | Params | Returns | Notes |
|----------|--------|---------|-------|
| `join_user_to_company` | (user_id uuid, company_id uuid) | jsonb | Sets company, role, seat |
| `check_pending_invites` | (email text) | jsonb | Returns invites with company details |
| `get_company_join_details` | (code text) | jsonb | Lookup by company_code or UUID |
| `initialize_company_defaults` | (company_id uuid) | void | Seeds task types, inventory units, settings |

### Permission RPCs

| Function | Params | Returns | Notes |
|----------|--------|---------|-------|
| `has_permission` | (user_id uuid, permission, scope) | boolean | SECURITY DEFINER |
| `private.get_user_company_id` | () | uuid | From JWT → bubble_id → companies.id |
| `private.get_current_user_id` | () | uuid | From auth.uid() → users.auth_id |

### AI RPCs

| Function | Params | Returns | Notes |
|----------|--------|---------|-------|
| `match_memories` | (embedding, company_id, threshold, count) | table | pgvector cosine similarity |
| `increment_access_count` | (memory_ids uuid[]) | void | |
| `count_distinct_users` | (start_date, end_date, platform) | bigint | |

### Notification RPCs

| Function | Params | Returns | Notes |
|----------|--------|---------|-------|
| `create_notification_if_new` | (user_id, company_id, type, title, body, ...) | void | Dedup via ON CONFLICT |

---

## 6. Service Column Mappings

### Key Naming Asymmetries

| Service | TS Property | DB Column |
|---------|-------------|-----------|
| company-service | companyDescription | description |
| company-service | dataSetupScheduledDate | data_setup_scheduled |
| company-service | logoURL | logo_url |
| user-service | hasCompletedAppTutorial | has_completed_tutorial |
| user-service | profileImageURL | profile_image_url |
| client-service | profileImageURL | profile_image_url |
| project-service | projectDescription | description |
| task-service | taskIndex | display_order |

### Tables Queried by Service

| Service File | Table(s) Queried |
|-------------|-----------------|
| estimate-service | estimates, line_items |
| invoice-service | invoices, line_items, payments |
| opportunity-service | opportunities, stage_transitions, activities, follow_ups |
| project-service | projects |
| task-service | project_tasks (join task_types) |
| client-service | clients, sub_clients |
| company-service | companies, projects |
| user-service | users |
| calendar-service | project_tasks (primary), calendar_events (write only) |
| task-type-service | task_types |
| inventory-service | inventory_items, inventory_units, inventory_tags, inventory_item_tags, inventory_snapshots, inventory_snapshot_items |
| product-service | products |
| roles-service | roles, role_permissions, user_roles |
| accounting-service | accounting_connections |
| notification-service | notifications |
| portal-auth-service | portal_tokens, portal_sessions |
| portal-branding-service | portal_branding |
| portal-message-service | portal_messages, clients |
| document-template-service | document_templates |
| email-template-service | email_templates |
| site-visit-service | site_visits |
| project-note-service | project_notes |

---

## 7. Inventory System

### Tables (created in Supabase directly — NO migration files)

| Table | Key Columns |
|-------|-------------|
| `inventory_items` | id, company_id, name, description, quantity, unit_id FK, sku, image_url, warning_threshold, critical_threshold |
| `inventory_units` | id, company_id, display, is_default, sort_order |
| `inventory_tags` | id, company_id, name, warning_threshold, critical_threshold |
| `inventory_item_tags` | id, item_id FK, tag_id FK (junction) |
| `inventory_snapshots` | id, company_id, created_by_id, is_automatic, item_count, notes |
| `inventory_snapshot_items` | id, snapshot_id FK, original_item_id, name, quantity, unit_display, sku, tags_string |

### Inventory ↔ Financial Gap

**There is NO foreign key between inventory and financial tables.** `inventory_items` has no link to `line_items` or `products`. These systems are completely decoupled. The I1 invoice sprint should leave this gap as-is — bridging inventory to line items would require a dedicated sprint with material tracking, cost-of-goods-sold calculations, and stock reservation logic.

---

## 8. Safe Patterns

### Creating an Estimate

```typescript
// 1. Get document number via RPC
const { data: docNumber } = await supabase.rpc("get_next_document_number", {
  p_company_id: companyId,
  p_type: "estimate"
});

// 2. Insert estimate (never set estimate_number manually)
const { data: estimate } = await supabase.from("estimates").insert({
  company_id: companyId,
  client_id: clientId,
  estimate_number: docNumber,
  subtotal: calculatedSubtotal,
  discount_type: "percentage",
  discount_value: 10,
  discount_amount: calculatedDiscountAmount,
  tax_rate: 0.0875,
  tax_amount: calculatedTaxAmount,
  total: calculatedTotal,
  status: "draft",
  issue_date: new Date().toISOString().split("T")[0],
}).select().single();

// 3. Insert line items (NEVER include line_total)
await supabase.from("line_items").insert([{
  company_id: companyId,
  estimate_id: estimate.id,
  name: "Deck Installation",
  quantity: 1,
  unit: "each",
  unit_price: 5000,
  sort_order: 0,
  type: "LABOR",
}]);
```

### Creating an Invoice

```typescript
// 1. Get document number via RPC
const { data: docNumber } = await supabase.rpc("get_next_document_number", {
  p_company_id: companyId,
  p_type: "invoice"
});

// 2. Insert invoice (NEVER set amount_paid or balance_due)
const { data: invoice } = await supabase.from("invoices").insert({
  company_id: companyId,
  client_id: clientId,
  invoice_number: docNumber,
  subtotal: 5000,
  total: 5000,
  balance_due: 5000, // Initial only — trigger maintains after this
  status: "draft",
  issue_date: new Date().toISOString().split("T")[0],
  due_date: dueDateString,
}).select().single();
```

### Recording a Payment (trigger auto-updates invoice)

```typescript
// Just insert the payment — trigger handles the rest
await supabase.from("payments").insert({
  company_id: companyId,
  invoice_id: invoiceId,
  client_id: clientId,
  amount: 2500,
  payment_method: "check",
  payment_date: new Date().toISOString().split("T")[0],
});
// Invoice.amount_paid, balance_due, and status are now auto-updated
```

### Converting Estimate → Invoice

```typescript
// Use the RPC — it handles everything atomically
const { data: newInvoiceId } = await supabase.rpc("convert_estimate_to_invoice", {
  p_estimate_id: estimateId,
  p_due_date: dueDateString, // optional, defaults to +30 days
});
```

### Creating a Project Task

```typescript
await supabase.from("project_tasks").insert({
  company_id: companyId,
  project_id: projectId,
  task_type_id: taskTypeId, // UUID from task_types
  custom_title: "Install railing",
  status: "active", // lowercase canonical
  task_color: "#417394",
  start_date: startDateISO,
  end_date: endDateISO,
  duration: 2,
  team_member_ids: [userId1, userId2],
});
```

---

## 9. Known Issues

### Bugs in Service Code

1. **estimate-service.ts missing `projectId` in `mapEstimateToDb`**: The mapper reads `project_id` from DB but never writes it. Invoice-service correctly maps `projectId → project_id`. Estimates cannot be linked to projects through the service's create/update methods.

2. **Line item `type` and `taskTypeId` not writable**: `mapLineItemToDb` in estimate-service does not map `type` or `taskTypeId`. Line items always get the DB default `'LABOR'` for type.

3. **`dependency_overrides` column**: Referenced in task-service.ts but no migration adds this column to `project_tasks`. Reads return `null/undefined`, writes would be silently ignored by PostgREST.

4. **`dependencies` column on task_types**: Referenced in task-service.ts but no migration adds this column to `task_types_v2`. Always returns `null`.

### Schema Gaps (Columns in Code but Not in Migrations)

| Table | Column | Used By | Status |
|-------|--------|---------|--------|
| notifications | persistent | notification-service, RPC | Added in Supabase directly |
| notifications | action_url | notification-service, RPC | Added in Supabase directly |
| notifications | action_label | notification-service, RPC | Added in Supabase directly |
| calendar_events | task_id | calendar-service (write) | Added in Supabase directly |
| calendar_events | event_type | calendar-service (write) | Added in Supabase directly |
| calendar_events | opportunity_id | calendar-service (write) | Added in Supabase directly |
| calendar_events | site_visit_id | calendar-service (write) | Added in Supabase directly |
| project_tasks | dependency_overrides | task-service | Missing entirely |
| task_types_v2 | dependencies | task-service | Missing entirely |
| document_templates | (entire table) | document-template-service | No migration found |
| expense_settings | (entire table) | expense-settings-service | No migration found |

### Status Case Mismatch

The migration CHECK constraints use Title Case (`'Booked'`, `'In Progress'`, `'RFQ'`) but services write lowercase (`'active'`, `'in_progress'`, `'rfq'`). These constraints were either modified or dropped in production. **All new code should use lowercase** as that is what the service layer expects.

### company_id Type Inconsistency

Migration 001 tables use `uuid` for company_id. Migration 002/003/006/007/008 tables use `TEXT`. This means some tables store the UUID as text while others use native UUID type. Both work with PostgREST but joins require casting.

### Inventory Tables Missing Migrations

All 6 inventory tables (`inventory_items`, `inventory_units`, `inventory_tags`, `inventory_item_tags`, `inventory_snapshots`, `inventory_snapshot_items`) were created directly in Supabase with no migration tracking. A migration should be created to formalize these schemas.
