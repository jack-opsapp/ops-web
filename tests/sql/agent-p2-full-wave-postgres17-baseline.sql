\set ON_ERROR_STOP on

-- Canonical production-typed prerequisite fixture for the complete P2 read
-- wave. This file creates only pre-P2 relations/functions. The existing
-- manifest compatibility fixture installs ledger item 1 and proves v6/v7/v8
-- continuity before the integration runner applies items 2..38.
\set agent_mcp_manifest_v8_bootstrap 1
\ir agent-manifest-v8-compatibility-runtime.sql
\unset agent_mcp_manifest_v8_bootstrap

create type public.site_visit_status as enum (
  'scheduled', 'in_progress', 'completed', 'cancelled'
);
create type public.gmail_connection_type as enum ('company', 'individual');
create type public.photo_source as enum (
  'site_visit', 'in_progress', 'completion', 'other', 'measurement',
  'deck_design', 'email'
);

create table public.companies (
  id uuid primary key,
  name text not null default 'Company',
  description text,
  industries text[] default array[]::text[],
  industry text,
  currency_code text not null default 'CAD',
  timezone text not null default 'UTC',
  locale text not null default 'en-CA',
  default_work_start time not null default '08:00:00',
  default_work_end time not null default '17:00:00',
  skip_weekends_in_auto_schedule boolean default false,
  precise_scheduling_enabled boolean default false,
  phone text,
  email text,
  website text,
  address text,
  logo_url text,
  bubble_id text,
  account_holder_id text,
  admin_ids text[] default array[]::text[],
  deleted_at timestamptz
);

create table public.users (
  id uuid primary key,
  company_id uuid,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  role text,
  profile_image_url text,
  user_color text,
  auth_id text,
  is_active boolean default true,
  is_company_admin boolean default false,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp(),
  deleted_at timestamptz
);

create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null,
  permission text not null,
  scope text,
  granted boolean not null default true
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  name text not null,
  description text,
  hierarchy integer not null default 0,
  is_preset boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz
);

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null,
  permission text not null,
  scope text not null default 'all',
  created_at timestamptz not null default statement_timestamp()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  role_id uuid not null,
  created_at timestamptz not null default statement_timestamp()
);

create table public.clients (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  email text,
  phone_number text,
  notes text,
  address text,
  merged_into_client_id uuid,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp(),
  deleted_at timestamptz
);

create table public.sub_clients (
  id uuid primary key,
  company_id uuid not null,
  client_id uuid not null,
  name text not null,
  email text,
  phone_number text,
  title text,
  address text,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp(),
  deleted_at timestamptz
);

create table public.duplicate_reviews (
  id uuid primary key,
  company_id uuid not null,
  entity_type text not null,
  entity_a_id uuid not null,
  entity_b_id uuid not null,
  confidence text not null,
  status text not null,
  created_at timestamptz not null default statement_timestamp()
);

create table public.opportunities (
  id uuid primary key,
  company_id uuid not null,
  client_id uuid,
  client_ref uuid,
  project_id uuid,
  project_ref uuid,
  title text not null,
  stage text not null default 'new_lead',
  assigned_to uuid,
  operator_action_required_at timestamptz,
  next_follow_up_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  merged_into_opportunity_id uuid
);

create table public.projects (
  id uuid primary key,
  company_id uuid not null,
  client_id uuid,
  opportunity_id text,
  opportunity_ref uuid,
  title text not null,
  status text not null default 'in_progress',
  start_date timestamptz,
  end_date timestamptz,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp(),
  deleted_at timestamptz
);

create table public.task_types (
  id uuid primary key,
  company_id uuid not null,
  display text not null,
  dependencies jsonb,
  deleted_at timestamptz
);

create table public.project_tasks (
  id uuid primary key,
  company_id uuid not null,
  project_id uuid not null,
  task_type_id uuid,
  custom_title text,
  task_notes text,
  status text not null default 'not_started',
  priority_rank double precision,
  team_member_ids text[] default array[]::text[],
  start_date timestamptz,
  end_date timestamptz,
  duration integer default 1,
  start_time time,
  end_time time,
  all_day boolean not null default true,
  schedule_version bigint not null default 0,
  confirmed_schedule_version bigint,
  schedule_confirmed_at timestamptz,
  dependency_overrides jsonb,
  source_estimate_id text,
  source_line_item_id text,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp(),
  deleted_at timestamptz
);

create table public.task_mutation_events (
  id uuid primary key,
  event_sequence bigint generated always as identity,
  company_id uuid not null,
  task_id uuid not null,
  project_id uuid not null,
  actor_user_id uuid,
  event_type text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  task_schedule_version bigint not null,
  task_updated_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);

create table public.task_materials (
  id uuid primary key,
  task_id uuid not null,
  catalog_variant_id uuid,
  inventory_item_id uuid,
  quantity double precision not null,
  source text not null default 'stock' check (source in ('stock', 'order'))
);

create table public.project_notes (
  id uuid primary key,
  company_id text not null,
  project_id text not null,
  author_id text not null,
  mentioned_user_ids text[] not null default array[]::text[],
  content text not null,
  event_kind text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create table public.email_connections (
  id uuid primary key,
  company_id text not null,
  type public.gmail_connection_type not null default 'company',
  provider text not null default 'gmail',
  email text not null,
  user_id text,
  status text not null default 'active',
  sync_enabled boolean not null default true,
  webhook_subscription_id text,
  webhook_expires_at timestamptz,
  last_synced_at timestamptz,
  provider_snapshot_at timestamptz,
  granted_scopes text[],
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp()
);

create table public.email_threads (
  id uuid primary key,
  company_id uuid not null,
  connection_id uuid not null,
  opportunity_id uuid,
  provider_thread_id text not null,
  subject text not null,
  first_message_at timestamptz not null,
  latest_snippet text,
  last_message_at timestamptz not null,
  unread_count integer not null default 0,
  snoozed_until timestamptz,
  next_commitment_due_at timestamptz,
  has_unresolved_commitments boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.activities (
  id uuid primary key,
  company_id uuid not null,
  type text not null,
  email_connection_id uuid,
  email_thread_id text,
  opportunity_id uuid,
  project_id text,
  match_needs_review boolean not null default false,
  created_at timestamptz not null default statement_timestamp()
);

create table public.email_suppressions (
  id uuid primary key,
  email text not null,
  list text not null default 'global',
  reason text not null,
  source text not null,
  source_event_id uuid,
  metadata jsonb default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);

create table public.site_visits (
  id uuid primary key,
  company_id text not null,
  opportunity_id uuid,
  client_id text,
  client_ref uuid,
  project_id text,
  project_ref uuid,
  created_by text not null,
  assignee_ids text[] default array[]::text[],
  notes text,
  internal_notes text,
  measurements text,
  photos text[] default array[]::text[],
  scheduled_at timestamptz not null default statement_timestamp(),
  duration_minutes integer not null default 60,
  booked_at timestamptz,
  status public.site_visit_status not null default 'scheduled',
  completed_at timestamptz,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp(),
  deleted_at timestamptz
);

grant select, insert, update on public.site_visits to authenticated, service_role;

create table public.site_visit_checklist_answers (
  id uuid primary key,
  site_visit_id uuid not null,
  company_id text not null,
  opportunity_id uuid,
  site_visit_type_id text,
  field_id text not null,
  label text not null,
  kind text not null,
  required boolean not null default false,
  help_text text,
  sort_order integer not null default 0,
  answer_value jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz
);

create table public.site_visit_artifacts (
  id uuid primary key,
  company_id text not null,
  site_visit_id uuid not null,
  opportunity_id uuid,
  deck_design_id uuid,
  kind text not null,
  source text not null default 'manual',
  created_by text not null,
  title text,
  body text,
  asset_url text,
  rendered_asset_url text,
  thumbnail_url text,
  dimensions jsonb,
  captured_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  included_in_project_review boolean not null default true,
  deleted_at timestamptz
);

create table public.deck_designs (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  project_id uuid,
  title text not null default 'Untitled Deck',
  drawing_data jsonb not null default '{}'::jsonb,
  thumbnail_url text,
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create function public.deck_designs_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$function$;

create trigger deck_designs_set_updated_at
before update on public.deck_designs
for each row execute function public.deck_designs_set_updated_at();

grant select, insert, update, delete on public.deck_designs
  to authenticated, service_role;

create table public.project_photos (
  id uuid primary key,
  company_id text not null,
  project_id text not null,
  source public.photo_source not null default 'other',
  caption text,
  taken_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  is_client_visible boolean not null default false,
  rendered_url text,
  url text not null,
  site_visit_id uuid
);

create table public.project_photo_annotations (
  id uuid primary key,
  company_id text not null,
  project_id text not null,
  photo_url text not null,
  annotation_url text,
  rendered_photo_url text,
  note text,
  created_at timestamptz not null,
  updated_at timestamptz,
  deleted_at timestamptz
);

create table public.email_attachments (
  id uuid primary key,
  company_id uuid not null,
  connection_id uuid not null,
  opportunity_id uuid,
  attribution_status text not null,
  ingest_status text not null,
  occurred_at timestamptz,
  stored_at timestamptz,
  created_at timestamptz not null,
  filename text,
  detected_mime_type text,
  verified_size_bytes bigint,
  storage_path text
);

create table public.email_attachment_inspection_jobs (
  id uuid primary key,
  company_id uuid not null,
  email_attachment_id uuid not null,
  status text not null
);

create table public.attachment_inspections (
  id uuid primary key,
  company_id uuid not null,
  connection_id uuid not null,
  email_attachment_id uuid not null
);

create table public.estimates (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  project_id text,
  project_ref uuid,
  client_id uuid not null,
  client_ref uuid,
  estimate_number text not null,
  title text,
  client_message text,
  notes text,
  terms text,
  status text not null,
  issue_date date not null,
  expiration_date date,
  total numeric(12,2) not null,
  pdf_storage_path text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table public.invoices (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  project_id uuid,
  project_ref uuid,
  client_id uuid not null,
  client_ref uuid,
  invoice_number text not null,
  subject text,
  client_message text,
  footer text,
  terms text,
  status text not null,
  issue_date date not null,
  due_date date not null,
  paid_at timestamptz,
  total numeric(12,2) not null,
  amount_paid numeric(12,2) not null,
  balance_due numeric(12,2) not null,
  pdf_storage_path text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table public.line_items (
  id uuid primary key,
  company_id uuid not null,
  estimate_id uuid,
  invoice_id uuid,
  name text not null,
  description text,
  quantity numeric(10,3) not null,
  unit text,
  unit_price numeric(12,2) not null,
  discount_percent numeric(5,2),
  minimum_charge_snapshot numeric(14,2),
  line_total numeric generated always as (
    pg_catalog.round(
      greatest(
        quantity * unit_price * (
          1::numeric - coalesce(discount_percent, 0::numeric) /
            100::numeric
        ),
        coalesce(minimum_charge_snapshot, 0::numeric)
      ),
      2
    )
  ) stored,
  is_taxable boolean,
  is_optional boolean,
  is_selected boolean,
  category text,
  sort_order integer not null,
  task_type_id text
);

create table public.payment_milestones (
  id uuid primary key,
  estimate_id uuid not null,
  invoice_id uuid,
  name text not null,
  amount numeric(12,2) not null,
  type text not null,
  value numeric(12,2) not null,
  expected_date date,
  paid_at timestamptz,
  sort_order integer not null
);

create table public.payments (
  id uuid primary key,
  company_id uuid not null,
  invoice_id uuid not null,
  client_id uuid not null,
  amount numeric(12,2) not null,
  payment_method text,
  reference_number text,
  notes text,
  payment_date date not null,
  stripe_payment_intent text,
  created_by uuid,
  created_at timestamptz not null default statement_timestamp(),
  voided_at timestamptz,
  voided_by uuid,
  qb_id text,
  sage_id text
);

create table public.expense_categories (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  is_active boolean default true,
  created_at timestamptz default statement_timestamp()
);

create table public.expense_batches (
  id uuid primary key,
  company_id uuid not null,
  batch_number text not null,
  status text not null,
  period_start date,
  period_end date,
  submitted_by uuid,
  total_amount numeric(12,2),
  approved_amount numeric(12,2),
  paid_at timestamptz,
  created_at timestamptz default statement_timestamp()
);

create table public.expenses (
  id uuid primary key,
  company_id uuid not null,
  submitted_by uuid not null,
  category_id uuid,
  batch_id uuid,
  merchant_name text,
  description text,
  amount numeric(12,2) not null,
  tax_amount numeric(12,2),
  currency text,
  expense_date date,
  payment_method text,
  status text not null,
  receipt_image_url text,
  receipt_thumbnail_url text,
  ocr_raw_data jsonb,
  accounting_sync_status text,
  accounting_sync_id text,
  approved_at timestamptz,
  approved_by uuid,
  rejected_at timestamptz,
  rejected_by uuid,
  rejection_reason text,
  flag_comment text,
  flagged_by uuid,
  flagged_at timestamptz,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz
);

create table public.expense_project_allocations (
  id uuid primary key,
  expense_id uuid not null,
  project_id text not null,
  percentage numeric(5,2) not null,
  amount numeric(12,2)
);

create table public.company_inventory_settings (
  company_id uuid primary key,
  inventory_mode text not null default 'disabled',
  enabled_at timestamptz,
  updated_by uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.company_settings (
  company_id text primary key,
  catalog_setup_completed_at timestamptz,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp()
);

create table public.catalog_categories (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  default_critical_threshold double precision,
  default_warning_threshold double precision,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_units (
  id uuid primary key,
  company_id uuid not null,
  display text not null,
  abbreviation text,
  dimension text not null default 'count',
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_items (
  id uuid primary key,
  company_id uuid not null,
  category_id uuid,
  name text not null,
  description text,
  notes text,
  external_id text,
  external_source text,
  default_price numeric,
  default_unit_cost numeric,
  default_critical_threshold double precision,
  default_warning_threshold double precision,
  default_unit_id uuid,
  image_url text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_variants (
  id uuid primary key,
  company_id uuid not null,
  catalog_item_id uuid not null,
  sku text,
  quantity double precision not null default 0,
  unit_id uuid,
  price_override numeric,
  unit_cost_override numeric,
  warning_threshold double precision,
  critical_threshold double precision,
  external_id text,
  external_source text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_options (
  id uuid primary key,
  catalog_item_id uuid not null,
  name text not null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_option_values (
  id uuid primary key,
  option_id uuid not null,
  value text not null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_variant_option_values (
  id uuid primary key,
  variant_id uuid not null,
  option_value_id uuid not null,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_tags (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  warning_threshold double precision,
  critical_threshold double precision,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_item_tags (
  id uuid primary key,
  catalog_item_id uuid not null,
  tag_id uuid not null
);
create table public.catalog_stock_units (
  id uuid primary key,
  company_id uuid not null,
  catalog_variant_id uuid not null,
  label text,
  location text,
  lot_code text,
  notes text,
  quantity_value numeric not null default 0,
  status text not null default 'full',
  unit_kind text not null default 'each',
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.catalog_supplier_cost_profiles (
  id uuid primary key,
  company_id uuid not null,
  catalog_variant_id uuid not null,
  profile_key text not null,
  label text not null,
  unit_cost numeric(14, 4) not null,
  currency_code text not null default 'CAD',
  is_default boolean not null default false,
  activation_rule jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);
create table public.products (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  linked_catalog_item_id uuid,
  is_active boolean default true,
  deleted_at timestamptz,
  created_at timestamptz default statement_timestamp(),
  updated_at timestamptz default statement_timestamp()
);
create table public.product_materials (
  id uuid primary key,
  product_id uuid not null,
  catalog_item_id uuid,
  catalog_variant_id uuid,
  quantity_per_unit double precision not null default 1,
  unit_id uuid,
  notes text,
  deleted_at timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);

create table public.catalog_orders (
  id uuid primary key,
  company_id uuid not null,
  status text not null,
  title text,
  supplier_name text,
  supplier_contact text,
  expected_delivery_date date,
  notes text,
  created_by_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  sent_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  deleted_at timestamptz
);
create table public.catalog_order_items (
  id uuid primary key,
  order_id uuid not null,
  catalog_variant_id uuid not null,
  quantity_requested double precision not null,
  cost_per_unit numeric,
  notes text
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  title text not null,
  project_id uuid,
  team_member_ids text[],
  start_date timestamptz,
  end_date timestamptz,
  duration integer,
  color text,
  bubble_id text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);

create table public.calendar_user_events (
  id uuid primary key,
  user_id text not null,
  company_id text not null,
  type text not null,
  title text not null default '',
  start_date timestamptz not null,
  end_date timestamptz not null,
  all_day boolean not null default true,
  notes text,
  status text not null default 'none',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz,
  deleted_at timestamptz,
  address text,
  team_member_ids text[] default array[]::text[],
  series_id uuid
);

create table public.accounting_connections (
  id uuid primary key,
  company_id text not null,
  provider text not null,
  provider_environment text not null default 'production',
  is_connected boolean not null default false,
  sync_enabled boolean not null default false,
  last_sync_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

-- Pin every declared public-column default to the exact production pre-P2 schema.
alter table public.accounting_connections alter column id set default gen_random_uuid();
alter table public.accounting_connections alter column created_at set default now();
alter table public.accounting_connections alter column updated_at set default now();
alter table public.activities alter column id set default gen_random_uuid();
alter table public.activities alter column created_at set default now();
alter table public.attachment_inspections alter column id set default gen_random_uuid();
alter table public.calendar_events alter column team_member_ids set default '{}'::text[];
alter table public.calendar_events alter column duration set default 1;
alter table public.calendar_events alter column color set default '#417394'::text;
alter table public.calendar_events alter column created_at set default now();
alter table public.calendar_events alter column updated_at set default now();
alter table public.calendar_user_events alter column id set default gen_random_uuid();
alter table public.calendar_user_events alter column created_at set default now();
alter table public.calendar_user_events alter column team_member_ids set default '{}'::text[];
alter table public.catalog_categories alter column id set default gen_random_uuid();
alter table public.catalog_categories alter column created_at set default now();
alter table public.catalog_categories alter column updated_at set default now();
alter table public.catalog_item_tags alter column id set default gen_random_uuid();
alter table public.catalog_items alter column id set default gen_random_uuid();
alter table public.catalog_items alter column created_at set default now();
alter table public.catalog_items alter column updated_at set default now();
alter table public.catalog_option_values alter column id set default gen_random_uuid();
alter table public.catalog_option_values alter column created_at set default now();
alter table public.catalog_option_values alter column updated_at set default now();
alter table public.catalog_options alter column id set default gen_random_uuid();
alter table public.catalog_options alter column created_at set default now();
alter table public.catalog_options alter column updated_at set default now();
alter table public.catalog_order_items alter column id set default gen_random_uuid();
alter table public.catalog_orders alter column id set default gen_random_uuid();
alter table public.catalog_orders alter column status set default 'draft'::text;
alter table public.catalog_orders alter column created_at set default now();
alter table public.catalog_orders alter column updated_at set default now();
alter table public.catalog_stock_units alter column id set default gen_random_uuid();
alter table public.catalog_stock_units alter column quantity_value set default 1;
alter table public.catalog_stock_units alter column created_at set default now();
alter table public.catalog_stock_units alter column updated_at set default now();
alter table public.catalog_supplier_cost_profiles alter column id set default gen_random_uuid();
alter table public.catalog_supplier_cost_profiles alter column created_at set default now();
alter table public.catalog_supplier_cost_profiles alter column updated_at set default now();
alter table public.catalog_tags alter column id set default gen_random_uuid();
alter table public.catalog_tags alter column created_at set default now();
alter table public.catalog_tags alter column updated_at set default now();
alter table public.catalog_units alter column id set default gen_random_uuid();
alter table public.catalog_units alter column created_at set default now();
alter table public.catalog_units alter column updated_at set default now();
alter table public.catalog_variant_option_values alter column id set default gen_random_uuid();
alter table public.catalog_variant_option_values alter column created_at set default now();
alter table public.catalog_variant_option_values alter column updated_at set default now();
alter table public.catalog_variants alter column id set default gen_random_uuid();
alter table public.catalog_variants alter column created_at set default now();
alter table public.catalog_variants alter column updated_at set default now();
alter table public.clients alter column id set default gen_random_uuid();
alter table public.clients alter column created_at set default now();
alter table public.clients alter column updated_at set default now();
alter table public.companies alter column id set default gen_random_uuid();
alter table public.companies alter column name drop default;
alter table public.companies alter column industries set default '{}'::text[];
alter table public.companies alter column industry set default 'trades'::text;
alter table public.companies alter column timezone set default 'America/Vancouver'::text;
alter table public.companies alter column locale set default 'en'::text;
alter table public.companies alter column skip_weekends_in_auto_schedule set default true;
alter table public.companies alter column admin_ids set default '{}'::text[];
alter table public.company_inventory_settings alter column inventory_mode set default 'off'::text;
alter table public.company_inventory_settings alter column created_at set default now();
alter table public.company_inventory_settings alter column updated_at set default now();
alter table public.company_settings alter column created_at set default now();
alter table public.company_settings alter column updated_at set default now();
alter table public.deck_designs alter column id set default gen_random_uuid();
alter table public.deck_designs alter column created_at set default now();
alter table public.duplicate_reviews alter column id set default gen_random_uuid();
alter table public.duplicate_reviews alter column status set default 'pending'::text;
alter table public.duplicate_reviews alter column created_at set default now();
alter table public.email_attachment_inspection_jobs alter column id set default gen_random_uuid();
alter table public.email_attachment_inspection_jobs alter column status set default 'pending'::text;
alter table public.email_attachments alter column id set default gen_random_uuid();
alter table public.email_attachments alter column attribution_status set default 'pending'::text;
alter table public.email_attachments alter column ingest_status set default 'discovered'::text;
alter table public.email_attachments alter column created_at set default now();
alter table public.email_connections alter column id set default gen_random_uuid();
alter table public.email_connections alter column created_at set default now();
alter table public.email_connections alter column updated_at set default now();
alter table public.email_suppressions alter column id set default gen_random_uuid();
alter table public.email_suppressions alter column created_at set default now();
alter table public.email_threads alter column id set default gen_random_uuid();
alter table public.email_threads alter column subject set default ''::text;
alter table public.email_threads alter column created_at set default now();
alter table public.email_threads alter column updated_at set default now();
alter table public.estimates alter column id set default gen_random_uuid();
alter table public.estimates alter column status set default 'draft'::text;
alter table public.estimates alter column issue_date set default CURRENT_DATE;
alter table public.estimates alter column total set default 0;
alter table public.estimates alter column created_at set default now();
alter table public.estimates alter column updated_at set default now();
alter table public.expense_batches alter column id set default gen_random_uuid();
alter table public.expense_batches alter column status set default 'pending_review'::text;
alter table public.expense_batches alter column total_amount set default 0;
alter table public.expense_batches alter column approved_amount set default 0;
alter table public.expense_batches alter column created_at set default now();
alter table public.expense_categories alter column id set default gen_random_uuid();
alter table public.expense_categories alter column created_at set default now();
alter table public.expense_project_allocations alter column id set default gen_random_uuid();
alter table public.expenses alter column id set default gen_random_uuid();
alter table public.expenses alter column amount set default 0;
alter table public.expenses alter column currency set default 'USD'::text;
alter table public.expenses alter column status set default 'draft'::text;
alter table public.expenses alter column accounting_sync_status set default 'pending'::text;
alter table public.expenses alter column created_at set default now();
alter table public.expenses alter column updated_at set default now();
alter table public.invoices alter column id set default gen_random_uuid();
alter table public.invoices alter column status set default 'draft'::text;
alter table public.invoices alter column issue_date set default CURRENT_DATE;
alter table public.invoices alter column total set default 0;
alter table public.invoices alter column amount_paid set default 0;
alter table public.invoices alter column balance_due set default 0;
alter table public.invoices alter column created_at set default now();
alter table public.invoices alter column updated_at set default now();
alter table public.line_items alter column id set default gen_random_uuid();
alter table public.line_items alter column quantity set default 1;
alter table public.line_items alter column unit set default 'each'::text;
alter table public.line_items alter column unit_price set default 0;
alter table public.line_items alter column discount_percent set default 0;
alter table public.line_items alter column is_taxable set default true;
alter table public.line_items alter column is_optional set default false;
alter table public.line_items alter column is_selected set default true;
alter table public.line_items alter column sort_order set default 0;
alter table public.opportunities alter column id set default gen_random_uuid();
alter table public.opportunities alter column created_at set default now();
alter table public.opportunities alter column updated_at set default now();
alter table public.payment_milestones alter column id set default gen_random_uuid();
alter table public.payment_milestones alter column sort_order set default 0;
alter table public.payments alter column id set default gen_random_uuid();
alter table public.payments alter column payment_date set default CURRENT_DATE;
alter table public.payments alter column created_at set default now();
alter table public.product_materials alter column id set default gen_random_uuid();
alter table public.product_materials alter column quantity_per_unit drop default;
alter table public.product_materials alter column updated_at set default now();
alter table public.products alter column id set default gen_random_uuid();
alter table public.products alter column created_at set default now();
alter table public.products alter column updated_at set default now();
alter table public.project_notes alter column id set default gen_random_uuid();
alter table public.project_notes alter column mentioned_user_ids set default '{}'::text[];
alter table public.project_notes alter column content set default ''::text;
alter table public.project_notes alter column created_at set default now();
alter table public.project_notes alter column updated_at set default now();
alter table public.project_photo_annotations alter column id set default gen_random_uuid();
alter table public.project_photo_annotations alter column note set default ''::text;
alter table public.project_photo_annotations alter column created_at set default now();
alter table public.project_photo_annotations alter column updated_at set default now();
alter table public.project_photos alter column id set default gen_random_uuid();
alter table public.project_photos alter column created_at set default now();
alter table public.project_photos alter column updated_at set default now();
alter table public.project_tasks alter column id set default gen_random_uuid();
alter table public.project_tasks alter column status set default 'active'::text;
alter table public.project_tasks alter column team_member_ids set default '{}'::text[];
alter table public.project_tasks alter column duration drop default;
alter table public.project_tasks alter column start_time set default '08:00:00'::time without time zone;
alter table public.project_tasks alter column end_time set default '17:00:00'::time without time zone;
alter table public.project_tasks alter column created_at set default now();
alter table public.project_tasks alter column updated_at set default now();
alter table public.projects alter column id set default gen_random_uuid();
alter table public.projects alter column status set default 'rfq'::text;
alter table public.projects alter column created_at set default now();
alter table public.projects alter column updated_at set default now();
alter table public.role_permissions alter column created_at set default now();
alter table public.roles alter column created_at set default now();
alter table public.roles alter column updated_at set default now();
alter table public.site_visit_artifacts alter column id set default gen_random_uuid();
alter table public.site_visit_artifacts alter column source drop default;
alter table public.site_visit_artifacts alter column created_at set default now();
alter table public.site_visit_artifacts alter column updated_at set default now();
alter table public.site_visit_checklist_answers alter column id set default gen_random_uuid();
alter table public.site_visit_checklist_answers alter column created_at set default now();
alter table public.site_visit_checklist_answers alter column updated_at set default now();
alter table public.site_visits alter column id set default gen_random_uuid();
alter table public.site_visits alter column assignee_ids set default '{}'::text[];
alter table public.site_visits alter column photos set default '{}'::text[];
alter table public.site_visits alter column scheduled_at drop default;
alter table public.site_visits alter column created_at set default now();
alter table public.site_visits alter column updated_at set default now();
alter table public.sub_clients alter column id set default gen_random_uuid();
alter table public.sub_clients alter column created_at set default now();
alter table public.sub_clients alter column updated_at set default now();
alter table public.task_materials alter column id set default gen_random_uuid();
alter table public.task_mutation_events alter column id set default gen_random_uuid();
alter table public.task_mutation_events alter column before_snapshot set default '{}'::jsonb;
alter table public.task_mutation_events alter column created_at set default now();
alter table public.task_types alter column id set default gen_random_uuid();
alter table public.task_types alter column dependencies set default '[]'::jsonb;
alter table public.user_roles alter column created_at set default now();
alter table public.users alter column id set default gen_random_uuid();
alter table public.users alter column role set default 'unassigned'::text;
alter table public.users alter column created_at set default now();
alter table public.users alter column updated_at set default now();

create table private.agent_operational_read_revisions (
  company_id uuid primary key,
  source_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  check (source_revision between 0 and 9007199254740991)
);
create table private.agent_job_history_revisions (
  company_id uuid primary key,
  history_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  check (history_revision between 0 and 9007199254740991)
);
create table private.agent_contactability_address_revisions (
  address_sha256 text primary key,
  source_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  check (address_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  check (source_revision between 0 and 9007199254740991)
);

create index sub_clients_agent_current_client_id_idx
  on public.sub_clients (company_id, client_id, id)
  where deleted_at is null;

create index opportunities_agent_customer_jobs_updated_keyset_idx
  on public.opportunities (
    company_id,
    coalesce(client_ref, client_id),
    updated_at desc,
    id desc
  )
  where deleted_at is null and merged_into_opportunity_id is null;

create index projects_agent_customer_jobs_updated_keyset_idx
  on public.projects (company_id, client_id, updated_at desc, id desc)
  where deleted_at is null;

create index idx_duplicate_reviews_pending
  on public.duplicate_reviews (company_id, status)
  where status = 'pending';

create or replace function public.normalize_project_opportunity_link()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_opportunity_id uuid;
begin
  if new.opportunity_ref is not null then
    v_opportunity_id := new.opportunity_ref;
  elsif new.opportunity_id is not null
    and btrim(new.opportunity_id) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_opportunity_id := new.opportunity_id::uuid;
  else
    return new;
  end if;

  if not exists (
    select 1
      from public.opportunities opportunity
     where opportunity.id = v_opportunity_id
       and opportunity.company_id = new.company_id
       and opportunity.deleted_at is null
  ) then
    raise exception 'project opportunity link must reference an active opportunity in the same company'
      using errcode = '23503';
  end if;

  new.opportunity_ref := v_opportunity_id;
  new.opportunity_id := v_opportunity_id::text;
  return new;
end;
$function$;

revoke all on function public.normalize_project_opportunity_link()
  from public, anon, authenticated, service_role;
grant execute on function public.normalize_project_opportunity_link()
  to service_role;

create trigger projects_normalize_opportunity_link
before insert or update of opportunity_id, opportunity_ref, company_id
on public.projects
for each row execute function public.normalize_project_opportunity_link();

create or replace function private.user_is_active_company_member(
  p_actor_user_id uuid,
  p_actor_company_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $$
  select exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  )
$$;

create or replace function private.user_is_company_admin(
  p_actor_user_id uuid,
  p_actor_company_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
      and (
        coalesce(actor.is_company_admin, false)
        or actor.id::text = company.account_holder_id
        or actor.id::text = any(coalesce(company.admin_ids, array[]::text[]))
      )
  );
$function$;

create or replace function private.raw_permission_scope_for_user(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_override_granted boolean;
  v_override_scope text;
  v_scope text;
begin
  if p_actor_user_id is null
     or p_actor_company_id is null
     or nullif(btrim(p_permission), '') is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return null;
  end if;

  select override.granted, override.scope
  into v_override_granted, v_override_scope
  from public.user_permission_overrides override
  where override.user_id = p_actor_user_id
    and override.company_id = p_actor_company_id
    and override.permission = p_permission
  limit 1;

  if found then
    if not v_override_granted then
      return null;
    end if;
    if v_override_scope is not null then
      if v_override_scope in ('all', 'assigned', 'own') then
        return v_override_scope;
      end if;
      return null;
    end if;
  end if;

  select permission.scope
  into v_scope
  from public.user_roles assignment
  join public.roles role
    on role.id = assignment.role_id
   and (role.is_preset or role.company_id = p_actor_company_id)
  join public.role_permissions permission
    on permission.role_id = assignment.role_id
   and permission.permission = p_permission
   and permission.scope in ('all', 'assigned', 'own')
  where assignment.user_id = p_actor_user_id::text
  order by case permission.scope
    when 'all' then 1
    when 'assigned' then 2
    when 'own' then 3
    else 4
  end
  limit 1;

  return v_scope;
end;
$function$;

create or replace function public.has_permission(
  p_user_id uuid,
  p_permission text,
  p_required_scope text default 'all'::text
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_scope text;
begin
  if p_user_id is null or p_permission is null then return false; end if;
  select actor.company_id into v_company_id
  from public.users actor
  join public.companies company
    on company.id = actor.company_id and company.deleted_at is null
  where actor.id = p_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);
  if not found then return false; end if;
  if private.user_is_company_admin(p_user_id, v_company_id) then return true; end if;
  v_scope := private.raw_permission_scope_for_user(
    p_user_id, v_company_id, p_permission
  );
  if v_scope = 'all' then return true; end if;
  if v_scope = 'assigned' then
    return p_required_scope in ('assigned', 'own');
  end if;
  if v_scope = 'own' then return p_required_scope = 'own'; end if;
  return false;
end;
$function$;

create or replace function private.should_use_pipeline_manage_compat(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns boolean
language sql stable security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select p_actor_user_id is not null
    and p_actor_company_id is not null
    and p_permission is not null
    and not exists (
      select 1
        from public.user_permission_overrides upo
       where upo.user_id = p_actor_user_id
         and upo.company_id = p_actor_company_id
         and upo.permission = p_permission
    )
    and not exists (
      select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = p_actor_user_id::text
         and rp.permission = p_permission
    )
    and public.has_permission(
      p_actor_user_id,
      'pipeline.manage',
      'all'
    );
$function$;

create or replace function private.least_permissive_pipeline_scope(
  p_left_scope text, p_right_scope text
) returns text language sql immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when p_left_scope is null or p_right_scope is null then null
    when p_left_scope not in ('all', 'assigned') then null
    when p_right_scope not in ('all', 'assigned') then null
    when p_left_scope = 'assigned' or p_right_scope = 'assigned'
      then 'assigned'
    else 'all'
  end;
$function$;

create or replace function private.effective_pipeline_scope_for_user(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns text
language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_raw_scope text;
  v_prerequisite_scope text;
begin
  if p_permission is null or p_permission not in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  ) then
    return null;
  end if;

  if not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = p_actor_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return null;
  end if;

  if public.has_permission(p_actor_user_id, p_permission, 'all') then
    v_raw_scope := 'all';
  elsif public.has_permission(p_actor_user_id, p_permission, 'assigned') then
    v_raw_scope := 'assigned';
  elsif private.should_use_pipeline_manage_compat(
    p_actor_user_id, p_actor_company_id, p_permission
  ) then
    v_raw_scope := 'all';
  else
    return null;
  end if;

  -- `own` and every unknown scope are invalid for these capabilities.
  if v_raw_scope not in ('all', 'assigned') then
    return null;
  end if;

  case p_permission
    when 'pipeline.create' then
      if v_raw_scope is distinct from 'all' then
        return null;
      end if;
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.view'
      );
      if v_prerequisite_scope not in ('all', 'assigned') then
        return null;
      end if;
      return 'all';

    when 'pipeline.view' then
      return v_raw_scope;

    when 'pipeline.edit' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.view'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );

    when 'pipeline.assign' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.edit'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );

    when 'pipeline.convert' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.edit'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );
  end case;

  return null;
end;
$function$;

create or replace function private.should_use_inbox_view_company_compat(
  p_actor_user_id uuid, p_actor_company_id uuid
) returns boolean language sql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select p_actor_user_id is not null
    and p_actor_company_id is not null
    and not exists (
      select 1
        from public.user_permission_overrides upo
       where upo.user_id = p_actor_user_id
         and upo.company_id = p_actor_company_id
         and upo.permission = 'inbox.view'
    )
    and not exists (
      select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = p_actor_user_id::text
         and rp.permission = 'inbox.view'
    )
    and public.has_permission(
      p_actor_user_id,
      'inbox.view_company',
      'all'
    );
$function$;

create or replace function private.effective_inbox_scope_for_user(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns text language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if p_permission is null
    or p_permission not in ('inbox.view', 'inbox.send')
    or not exists (
      select 1
        from public.users u
       where u.id = p_actor_user_id
         and u.company_id = p_actor_company_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
    )
  then
    return null;
  end if;

  if public.has_permission(p_actor_user_id, p_permission, 'all') then
    return 'all';
  end if;
  if public.has_permission(p_actor_user_id, p_permission, 'assigned') then
    return 'assigned';
  end if;
  if p_permission = 'inbox.view'
    and public.has_permission(p_actor_user_id, p_permission, 'own')
  then
    return 'own';
  end if;
  if p_permission = 'inbox.view'
    and private.should_use_inbox_view_company_compat(
      p_actor_user_id,
      p_actor_company_id
    )
  then
    return 'all';
  end if;
  return null;
end;
$function$;

create or replace function private.effective_permission_scope_for_user(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if p_permission in (
    'pipeline.create', 'pipeline.view', 'pipeline.edit',
    'pipeline.assign', 'pipeline.convert'
  ) then
    return private.effective_pipeline_scope_for_user(
      p_actor_user_id, p_actor_company_id, p_permission
    );
  end if;
  if p_permission in ('inbox.view', 'inbox.send') then
    return private.effective_inbox_scope_for_user(
      p_actor_user_id, p_actor_company_id, p_permission
    );
  end if;
  return private.raw_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, p_permission
  );
end;
$function$;

create or replace function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_registered_permission_keys text[]
) returns table(
  actor_user_id uuid,
  company_id uuid,
  is_active boolean,
  is_admin boolean,
  role_ids uuid[],
  configured_permissions text[],
  effective_permissions jsonb,
  permission_snapshot_revision text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_registered_permission_keys text[] := array[]::text[];
  v_is_company_admin_flag boolean;
  v_is_account_holder boolean;
  v_is_admin_list_member boolean;
  v_is_admin boolean;
  v_role_ids uuid[] := array[]::uuid[];
  v_role_grants jsonb := '[]'::jsonb;
  v_override_facts jsonb := '[]'::jsonb;
  v_configured_permissions text[] := array[]::text[];
  v_effective_permissions jsonb := '[]'::jsonb;
  v_revision_input jsonb;
begin
  if p_registered_permission_keys is null
     or cardinality(p_registered_permission_keys) = 0
     or cardinality(p_registered_permission_keys) > 256 then
    raise exception 'invalid_agent_permission_registry'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where permission_key is null
       or permission_key is distinct from btrim(permission_key)
       or length(permission_key) > 128
       or permission_key !~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'
  ) then
    raise exception 'invalid_agent_permission_registry'
      using errcode = '22023';
  end if;
  select array_agg(distinct permission_key order by permission_key)
  into v_registered_permission_keys
  from unnest(p_registered_permission_keys) registry(permission_key);

  select coalesce(actor.is_company_admin, false),
         coalesce(actor.id::text = company.account_holder_id, false),
         coalesce(
           actor.id::text = any(coalesce(company.admin_ids, array[]::text[])),
           false
         )
  into v_is_company_admin_flag,
       v_is_account_holder,
       v_is_admin_list_member
  from public.users actor
  join public.companies company
    on company.id = actor.company_id
   and company.deleted_at is null
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);
  if not found then return; end if;

  v_is_admin := v_is_company_admin_flag
    or v_is_account_holder
    or v_is_admin_list_member;

  select coalesce(
    array_agg(distinct assignment.role_id order by assignment.role_id),
    array[]::uuid[]
  )
  into v_role_ids
  from public.user_roles assignment
  join public.roles role
    on role.id = assignment.role_id
   and (role.is_preset or role.company_id = p_company_id)
  where assignment.user_id = p_actor_user_id::text;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role_id', assignment.role_id::text,
        'permission', permission.permission,
        'scope', permission.scope,
        'role_is_valid', (
          coalesce(role.is_preset, false)
          or coalesce(role.company_id = p_company_id, false)
        )
      ) order by assignment.role_id, permission.permission, permission.scope
    ), '[]'::jsonb
  )
  into v_role_grants
  from public.user_roles assignment
  join public.roles role on role.id = assignment.role_id
  join public.role_permissions permission
    on permission.role_id = assignment.role_id
  where assignment.user_id = p_actor_user_id::text;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permission', override.permission,
        'scope', override.scope,
        'granted', override.granted
      ) order by override.permission, override.scope, override.granted
    ), '[]'::jsonb
  )
  into v_override_facts
  from public.user_permission_overrides override
  where override.user_id = p_actor_user_id
    and override.company_id = p_company_id;

  if v_is_admin then
    v_configured_permissions := v_registered_permission_keys;
  else
    select coalesce(
      array_agg(registry.permission_key order by registry.permission_key),
      array[]::text[]
    )
    into v_configured_permissions
    from unnest(v_registered_permission_keys) registry(permission_key)
    where exists (
      select 1
      from public.user_roles assignment
      join public.role_permissions permission
        on permission.role_id = assignment.role_id
      where assignment.user_id = p_actor_user_id::text
        and permission.permission = registry.permission_key
    ) or exists (
      select 1
      from public.user_permission_overrides override
      where override.user_id = p_actor_user_id
        and override.company_id = p_company_id
        and override.permission = registry.permission_key
    );
  end if;

  with effective_permission as (
    select registry.permission_key as permission,
           case when v_is_admin then 'all'::text
             else private.effective_permission_scope_for_user(
               p_actor_user_id, p_company_id, registry.permission_key
             )
           end as scope
    from unnest(v_registered_permission_keys) registry(permission_key)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('permission', permission, 'scope', scope)
      order by permission, scope
    ) filter (where scope is not null),
    '[]'::jsonb
  )
  into v_effective_permissions
  from effective_permission;

  v_revision_input := jsonb_build_object(
    'actor_user_id', p_actor_user_id::text,
    'company_id', p_company_id::text,
    'admin_facts', jsonb_build_object(
      'is_company_admin_flag', v_is_company_admin_flag,
      'is_account_holder', v_is_account_holder,
      'is_admin_list_member', v_is_admin_list_member
    ),
    'registered_permission_keys', to_jsonb(v_registered_permission_keys),
    'role_ids', to_jsonb(v_role_ids),
    'role_grants', v_role_grants,
    'overrides', v_override_facts,
    'configured_permissions', to_jsonb(v_configured_permissions),
    'effective_permissions', v_effective_permissions
  );

  actor_user_id := p_actor_user_id;
  company_id := p_company_id;
  is_active := true;
  is_admin := v_is_admin;
  role_ids := v_role_ids;
  configured_permissions := v_configured_permissions;
  effective_permissions := v_effective_permissions;
  permission_snapshot_revision := 'sha256:' || encode(
    extensions.digest(v_revision_input::text, 'sha256'), 'hex'
  );
  return next;
end;
$function$;

create or replace function private.user_can_view_opportunity(
  p_actor_user_id uuid, p_opportunity_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opportunity record;
  v_scope text;
begin
  select o.company_id, o.assigned_to
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;

  if not found then
    return false;
  end if;

  v_scope := private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    v_opportunity.company_id,
    'pipeline.view'
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned'
    and v_opportunity.assigned_to = p_actor_user_id
  then
    return true;
  end if;
  return false;
end;
$function$;

create or replace function private.user_can_view_project(
  p_actor_user_id uuid, p_project_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_project record;
begin
  select p.company_id
    into v_project
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_project.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'projects.view', 'all') then
    return true;
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'projects.view',
    'assigned'
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.project_tasks pt
     where pt.project_id = p_project_id
       and pt.deleted_at is null
      and p_actor_user_id::text = any(
        coalesce(pt.team_member_ids, array[]::text[])
      )
  ) or exists (
    select 1
      from public.project_notes pn
     where pn.project_id = p_project_id::text
       and pn.deleted_at is null
      and p_actor_user_id::text = any(
        coalesce(pn.mentioned_user_ids, array[]::text[])
      )
  );
end;
$function$;

create or replace function private.user_can_view_task(
  p_actor_user_id uuid, p_task_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = task.company_id
   and project.deleted_at is null
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_task.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'tasks.view', 'all') then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.view',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_can_view_project(
        p_actor_user_id,
        v_task.project_id
      )
    );
end;
$function$;

create or replace function private.user_can_view_client(
  p_actor_user_id uuid, p_actor_company_id uuid, p_client_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_scope text;
begin
  if not private.user_is_active_company_member(
    p_actor_user_id, p_actor_company_id
  ) or not exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and client.company_id = p_actor_company_id
      and client.deleted_at is null
  ) then
    return false;
  end if;

  if private.user_is_company_admin(
    p_actor_user_id, p_actor_company_id
  ) then
    return true;
  end if;

  v_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'clients.view'
  );
  if v_scope = 'all' then
    return true;
  end if;
  if v_scope is distinct from 'assigned' then
    return false;
  end if;

  -- Deliberately team-assignment-only. A project note mention grants the
  -- project/task read surface, not the customer's full contact record.
  return exists (
    select 1
    from public.projects project
    join public.project_tasks task
      on task.project_id = project.id
     and task.company_id = project.company_id
     and task.deleted_at is null
    where project.client_id = p_client_id
      and project.company_id = p_actor_company_id
      and project.deleted_at is null
      and p_actor_user_id::text = any(
        coalesce(task.team_member_ids, array[]::text[])
      )
  );
end;
$function$;

create or replace function private.try_parse_uuid(p_value text)
returns uuid language plpgsql immutable security invoker
set search_path to 'public', 'private', 'pg_temp'
as $function$
begin
  if p_value is null then
    return null;
  end if;

  if btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return btrim(p_value)::uuid;
  end if;

  return null;
end;
$function$;

create or replace function private.user_can_view_sub_client(
  p_actor_user_id uuid, p_actor_company_id uuid, p_sub_client_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_client_id uuid;
begin
  select sub_client.client_id
  into v_client_id
  from public.sub_clients sub_client
  where sub_client.id = p_sub_client_id
    and sub_client.company_id = p_actor_company_id
    and sub_client.deleted_at is null;

  if not found then
    return false;
  end if;

  return private.user_can_view_client(
    p_actor_user_id,
    p_actor_company_id,
    v_client_id
  );
end;
$function$;

create or replace function private.user_can_edit_opportunity(
  p_actor_user_id uuid, p_opportunity_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opportunity record;
  v_scope text;
begin
  select o.company_id, o.assigned_to
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;

  if not found then
    return false;
  end if;

  v_scope := private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    v_opportunity.company_id,
    'pipeline.edit'
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned'
    and v_opportunity.assigned_to = p_actor_user_id
  then
    return true;
  end if;
  return false;
end;
$function$;

create or replace function private.user_can_edit_project(
  p_actor_user_id uuid, p_project_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_project record;
begin
  select p.company_id
    into v_project
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_project.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'projects.edit', 'all') then
    return true;
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'projects.edit',
    'assigned'
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.project_tasks pt
     where pt.project_id = p_project_id
       and pt.deleted_at is null
      and p_actor_user_id::text = any(
        coalesce(pt.team_member_ids, array[]::text[])
      )
  );
end;
$function$;

create or replace function private.user_is_project_member_for_task(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_project_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.project_tasks assigned_task
    join public.projects project on project.id = assigned_task.project_id
    where assigned_task.project_id = p_project_id
      and assigned_task.company_id = p_company_id
      and assigned_task.deleted_at is null
      and assigned_task.status = 'active'
      and project.company_id = p_company_id
      and project.deleted_at is null
      and p_actor_user_id::text = any(
        coalesce(assigned_task.team_member_ids, array[]::text[])
      )
  );
$function$;

create or replace function private.user_can_edit_task(
  p_actor_user_id uuid, p_task_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = task.company_id
   and project.deleted_at is null
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_task.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return false;
  end if;
  if public.has_permission(p_actor_user_id, 'tasks.edit', 'all') then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.edit',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_is_project_member_for_task(
        p_actor_user_id,
        v_task.company_id,
        v_task.project_id
      )
    );
end;
$function$;

create or replace function private.user_can_change_task_status(
  p_actor_user_id uuid, p_task_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not private.user_can_edit_task(p_actor_user_id, p_task_id) then
    return false;
  end if;
  if public.has_permission(
    p_actor_user_id,
    'tasks.change_status',
    'all'
  ) then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.change_status',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_is_project_member_for_task(
        p_actor_user_id,
        v_task.company_id,
        v_task.project_id
      )
    );
end;
$function$;

create or replace function private.user_can_edit_client(
  p_actor_user_id uuid, p_actor_company_id uuid, p_client_id uuid
) returns boolean language sql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_is_active_company_member(
    p_actor_user_id, p_actor_company_id
  ) and exists (
    select 1 from public.clients client
    where client.id = p_client_id
      and client.company_id = p_actor_company_id
      and client.deleted_at is null
  ) and (
    private.user_is_company_admin(p_actor_user_id, p_actor_company_id)
    or private.effective_permission_scope_for_user(
      p_actor_user_id, p_actor_company_id, 'clients.edit'
    ) = 'all'
  );
$function$;

create or replace function private.user_can_edit_sub_client(
  p_actor_user_id uuid, p_actor_company_id uuid, p_sub_client_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_client_id uuid;
begin
  select sub_client.client_id into v_client_id
  from public.sub_clients sub_client
  where sub_client.id = p_sub_client_id
    and sub_client.company_id = p_actor_company_id
    and sub_client.deleted_at is null;
  if not found then return false; end if;
  return private.user_can_edit_client(
    p_actor_user_id, p_actor_company_id, v_client_id
  );
end;
$function$;

create or replace function private.user_can_view_calendar_event(
  p_actor_user_id uuid, p_actor_company_id uuid, p_calendar_event_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.calendar_events;
  v_calendar_scope text;
  v_task_scope text;
begin
  select event.* into v_event from public.calendar_events event
  where event.id = p_calendar_event_id
    and event.company_id = p_actor_company_id
    and event.deleted_at is null;
  if not found or not private.user_is_active_company_member(
    p_actor_user_id, p_actor_company_id
  ) then return false; end if;
  if private.user_is_company_admin(
    p_actor_user_id, p_actor_company_id
  ) then return true; end if;
  v_calendar_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'calendar.view'
  );
  v_task_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'tasks.view'
  );
  if v_calendar_scope = 'all' or v_task_scope = 'all' then return true; end if;
  if v_calendar_scope is distinct from 'own'
     and v_task_scope is distinct from 'assigned' then return false; end if;
  return p_actor_user_id::text = any(
    coalesce(v_event.team_member_ids, array[]::text[])
  ) or (
    v_event.project_id is not null
    and private.user_can_view_project(p_actor_user_id, v_event.project_id)
  );
end;
$function$;

create or replace function private.user_can_edit_calendar_event(
  p_actor_user_id uuid, p_actor_company_id uuid, p_calendar_event_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.calendar_events;
  v_scope text;
begin
  select event.* into v_event from public.calendar_events event
  where event.id = p_calendar_event_id
    and event.company_id = p_actor_company_id
    and event.deleted_at is null;
  if not found or not private.user_is_active_company_member(
    p_actor_user_id, p_actor_company_id
  ) then return false; end if;
  if private.user_is_company_admin(
    p_actor_user_id, p_actor_company_id
  ) then return true; end if;
  v_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'calendar.edit'
  );
  return v_scope = 'all' or (
    v_scope = 'own' and p_actor_user_id::text = any(
      coalesce(v_event.team_member_ids, array[]::text[])
    )
  );
end;
$function$;

create or replace function private.user_can_view_calendar_user_event(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_calendar_user_event_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.calendar_user_events;
  v_calendar_scope text;
  v_task_scope text;
  v_time_off_scope text;
begin
  select event.* into v_event from public.calendar_user_events event
  where event.id = p_calendar_user_event_id
    and event.company_id = p_actor_company_id::text
    and event.deleted_at is null;
  if not found or not private.user_is_active_company_member(
    p_actor_user_id, p_actor_company_id
  ) then return false; end if;
  if private.user_is_company_admin(
    p_actor_user_id, p_actor_company_id
  ) then return true; end if;
  v_calendar_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'calendar.view'
  );
  v_task_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'tasks.view'
  );
  v_time_off_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'time_off.approve'
  );
  if v_calendar_scope = 'all' or v_task_scope = 'all' then return true; end if;
  if v_event.user_id = p_actor_user_id::text
     or p_actor_user_id::text = any(
       coalesce(v_event.team_member_ids, array[]::text[])
     ) then return true; end if;
  return v_event.type = 'time_off' and v_time_off_scope = 'all';
end;
$function$;

create or replace function private.user_can_edit_calendar_user_event(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_calendar_user_event_id uuid
) returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.calendar_user_events;
  v_edit_scope text;
  v_time_off_scope text;
begin
  select event.* into v_event from public.calendar_user_events event
  where event.id = p_calendar_user_event_id
    and event.company_id = p_actor_company_id::text
    and event.deleted_at is null;
  if not found or not private.user_is_active_company_member(
    p_actor_user_id, p_actor_company_id
  ) then return false; end if;
  if private.user_is_company_admin(
    p_actor_user_id, p_actor_company_id
  ) then return true; end if;
  v_edit_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'calendar.edit'
  );
  v_time_off_scope := private.effective_permission_scope_for_user(
    p_actor_user_id, p_actor_company_id, 'time_off.approve'
  );
  if v_edit_scope = 'all' then return true; end if;
  if v_event.user_id = p_actor_user_id::text then return true; end if;
  return v_event.type = 'time_off' and v_time_off_scope = 'all';
end;
$function$;

create or replace function private.agent_user_can_access_entity(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_action text
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if p_entity_kind is null or p_entity_kind not in (
    'opportunity', 'project', 'task', 'client', 'sub_client',
    'calendar_event', 'calendar_user_event'
  ) then
    raise exception 'invalid_agent_entity_kind' using errcode = '22023';
  end if;
  if p_action is null then
    raise exception 'invalid_agent_entity_action' using errcode = '22023';
  end if;
  case p_entity_kind
    when 'opportunity' then
      if p_action not in ('view', 'edit') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if not private.user_is_active_company_member(
        p_actor_user_id, p_actor_company_id
      ) then return false; end if;
      if p_action = 'view' then
        return private.user_can_view_opportunity(p_actor_user_id, p_entity_id);
      end if;
      return private.user_can_edit_opportunity(p_actor_user_id, p_entity_id);
    when 'project' then
      if p_action not in ('view', 'edit') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.projects entity
        where entity.id = p_entity_id
          and entity.company_id = p_actor_company_id
          and entity.deleted_at is null
      ) then return false; end if;
      if p_action = 'view' then
        return private.user_can_view_project(p_actor_user_id, p_entity_id);
      end if;
      return private.user_can_edit_project(p_actor_user_id, p_entity_id);
    when 'task' then
      if p_action not in ('view', 'edit', 'change_status') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.project_tasks entity
        where entity.id = p_entity_id
          and entity.company_id = p_actor_company_id
          and entity.deleted_at is null
      ) then return false; end if;
      if p_action = 'view' then
        return private.user_can_view_task(p_actor_user_id, p_entity_id);
      elsif p_action = 'edit' then
        return private.user_can_edit_task(p_actor_user_id, p_entity_id);
      end if;
      return private.user_can_change_task_status(p_actor_user_id, p_entity_id);
    when 'client' then
      if p_action not in ('view', 'edit') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if p_action = 'view' then
        return private.user_can_view_client(
          p_actor_user_id, p_actor_company_id, p_entity_id
        );
      end if;
      return private.user_can_edit_client(
        p_actor_user_id, p_actor_company_id, p_entity_id
      );
    when 'sub_client' then
      if p_action not in ('view', 'edit') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if p_action = 'view' then
        return private.user_can_view_sub_client(
          p_actor_user_id, p_actor_company_id, p_entity_id
        );
      end if;
      return private.user_can_edit_sub_client(
        p_actor_user_id, p_actor_company_id, p_entity_id
      );
    when 'calendar_event' then
      if p_action not in ('view', 'edit', 'delete') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if p_action = 'view' then
        return private.user_can_view_calendar_event(
          p_actor_user_id, p_actor_company_id, p_entity_id
        );
      elsif p_action = 'edit' then
        return private.user_can_edit_calendar_event(
          p_actor_user_id, p_actor_company_id, p_entity_id
        );
      end if;
      return exists (
        select 1 from public.calendar_events entity
        where entity.id = p_entity_id
          and entity.company_id = p_actor_company_id
          and entity.deleted_at is null
      ) and (
        private.user_is_company_admin(
          p_actor_user_id, p_actor_company_id
        ) or private.effective_permission_scope_for_user(
          p_actor_user_id, p_actor_company_id, 'calendar.delete'
        ) = 'all'
      );
    when 'calendar_user_event' then
      if p_action not in ('view', 'edit', 'delete') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if p_action = 'view' then
        return private.user_can_view_calendar_user_event(
          p_actor_user_id, p_actor_company_id, p_entity_id
        );
      elsif p_action = 'edit' then
        return private.user_can_edit_calendar_user_event(
          p_actor_user_id, p_actor_company_id, p_entity_id
        );
      end if;
      return private.user_is_active_company_member(
        p_actor_user_id, p_actor_company_id
      ) and exists (
        select 1 from public.calendar_user_events entity
        where entity.id = p_entity_id
          and entity.company_id = p_actor_company_id::text
          and entity.deleted_at is null
          and (
            entity.user_id = p_actor_user_id::text
            or private.user_is_company_admin(
              p_actor_user_id, p_actor_company_id
            ) or private.effective_permission_scope_for_user(
              p_actor_user_id, p_actor_company_id, 'calendar.delete'
            ) = 'all'
          )
      );
  end case;
  return false;
end;
$function$;

create or replace function private.user_can_view_inbox_connection(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_opportunity_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_scope text;
begin
  if p_connection_id is null
    or not exists (
      select 1
        from public.email_connections ec
       where ec.id = p_connection_id
         and private.try_parse_uuid(ec.company_id) = p_company_id
    )
  then
    return false;
  end if;

  v_scope := private.effective_inbox_scope_for_user(
    p_actor_user_id,
    p_company_id,
    'inbox.view'
  );
  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned' then
    return exists (
      select 1
        from public.email_connections ec
       where ec.id = p_connection_id
         and private.try_parse_uuid(ec.company_id) = p_company_id
         and ec.type::text = 'individual'
         and nullif(btrim(ec.user_id), '') = p_actor_user_id::text
    ) or (
      p_opportunity_id is not null
      and exists (
        select 1
          from public.opportunities o
         where o.id = p_opportunity_id
           and o.company_id = p_company_id
           and o.deleted_at is null
           and o.assigned_to = p_actor_user_id
      )
    );
  end if;
  if v_scope = 'own' then
    return exists (
      select 1
        from public.email_connections ec
       where ec.id = p_connection_id
         and private.try_parse_uuid(ec.company_id) = p_company_id
         and ec.type::text = 'individual'
         and nullif(btrim(ec.user_id), '') = p_actor_user_id::text
    );
  end if;
  return false;
end;
$function$;

create or replace function private.agent_rfc3339_utc(p_value timestamptz)
returns text language sql immutable strict security invoker
set search_path to 'pg_catalog', 'pg_temp'
as $$
  select pg_catalog.to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

drop function private.canonical_agent_projection_json(jsonb);
create function private.canonical_agent_projection_json(
  p_value jsonb
) returns text
language plpgsql
immutable
strict
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_kind text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_kind = 'array' then
    select '[' || coalesce(
      string_agg(
        private.canonical_agent_projection_json(element.value),
        ',' order by element.ordinality
      ),
      ''
    ) || ']'
    into v_result
    from jsonb_array_elements(p_value) with ordinality
      as element(value, ordinality);
    return v_result;
  end if;

  if v_kind = 'object' then
    select '{' || coalesce(
      string_agg(
        to_jsonb(member.key)::text || ':' ||
          private.canonical_agent_projection_json(member.value),
        ',' order by member.key collate "C"
      ),
      ''
    ) || '}'
    into v_result
    from jsonb_each(p_value) as member(key, value);
    return v_result;
  end if;

  if v_kind = 'number' and (
    trunc(p_value::text::numeric) is distinct from p_value::text::numeric
    or abs(p_value::text::numeric) > 9007199254740991::numeric
  ) then
    raise exception 'agent_projection_number_not_safe_integer'
      using errcode = '22023';
  end if;

  return p_value::text;
end;
$function$;

revoke all on function private.canonical_agent_projection_json(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.agent_trim_discovery_display_text(
  p_value text
) returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
  select btrim(
    p_value,
    chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
    chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
    chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
    chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
    chr(8239) || chr(8287) || chr(12288) || chr(65279)
  )
$function$;

revoke all on function private.agent_trim_discovery_display_text(text)
  from public, anon, authenticated, service_role;

-- Generated from Unicode 15.0.0 DerivedAge.txt, excluding the 66
-- Noncharacter_Code_Point values in PropList.txt (707 scalar ranges).
-- DerivedAge SHA-256:
-- 7570877e0fa197c45338f7c41a02636da4e14c8dba6a3611a01cd30bf329d5ca
-- PropList SHA-256:
-- e05c0a2811d113dae4abd832884199a3ea8d187ee1b872d8240a788a96540bfd
-- Generated SQL literal SHA-256:
-- 42e74e70413868b4af535c138449f39f64cb39c73a7cd0d2e70b674e18d4f365
-- Production PostgreSQL 17.6 reports ICU Unicode 15.0; this fixed repertoire
-- prevents newer Node Unicode tables from creating cross-runtime identities.
create or replace function private.agent_discovery_unicode15_text_is_supported(
  p_value text
) returns boolean
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
  select not exists (
    select 1
    from generate_series(1, char_length(p_value)) scalar(position)
    where not (
      ascii(substr(p_value, scalar.position, 1)) <@
        '{[0,888),[890,896),[900,907),[908,909),[910,930),[931,1328),[1329,1367),[1369,1419),[1421,1424),[1425,1480),[1488,1515),[1519,1525),[1536,1806),[1807,1867),[1869,1970),[1984,2043),[2045,2094),[2096,2111),[2112,2140),[2142,2143),[2144,2155),[2160,2191),[2192,2194),[2200,2436),[2437,2445),[2447,2449),[2451,2473),[2474,2481),[2482,2483),[2486,2490),[2492,2501),[2503,2505),[2507,2511),[2519,2520),[2524,2526),[2527,2532),[2534,2559),[2561,2564),[2565,2571),[2575,2577),[2579,2601),[2602,2609),[2610,2612),[2613,2615),[2616,2618),[2620,2621),[2622,2627),[2631,2633),[2635,2638),[2641,2642),[2649,2653),[2654,2655),[2662,2679),[2689,2692),[2693,2702),[2703,2706),[2707,2729),[2730,2737),[2738,2740),[2741,2746),[2748,2758),[2759,2762),[2763,2766),[2768,2769),[2784,2788),[2790,2802),[2809,2816),[2817,2820),[2821,2829),[2831,2833),[2835,2857),[2858,2865),[2866,2868),[2869,2874),[2876,2885),[2887,2889),[2891,2894),[2901,2904),[2908,2910),[2911,2916),[2918,2936),[2946,2948),[2949,2955),[2958,2961),[2962,2966),[2969,2971),[2972,2973),[2974,2976),[2979,2981),[2984,2987),[2990,3002),[3006,3011),[3014,3017),[3018,3022),[3024,3025),[3031,3032),[3046,3067),[3072,3085),[3086,3089),[3090,3113),[3114,3130),[3132,3141),[3142,3145),[3146,3150),[3157,3159),[3160,3163),[3165,3166),[3168,3172),[3174,3184),[3191,3213),[3214,3217),[3218,3241),[3242,3252),[3253,3258),[3260,3269),[3270,3273),[3274,3278),[3285,3287),[3293,3295),[3296,3300),[3302,3312),[3313,3316),[3328,3341),[3342,3345),[3346,3397),[3398,3401),[3402,3408),[3412,3428),[3430,3456),[3457,3460),[3461,3479),[3482,3506),[3507,3516),[3517,3518),[3520,3527),[3530,3531),[3535,3541),[3542,3543),[3544,3552),[3558,3568),[3570,3573),[3585,3643),[3647,3676),[3713,3715),[3716,3717),[3718,3723),[3724,3748),[3749,3750),[3751,3774),[3776,3781),[3782,3783),[3784,3791),[3792,3802),[3804,3808),[3840,3912),[3913,3949),[3953,3992),[3993,4029),[4030,4045),[4046,4059),[4096,4294),[4295,4296),[4301,4302),[4304,4681),[4682,4686),[4688,4695),[4696,4697),[4698,4702),[4704,4745),[4746,4750),[4752,4785),[4786,4790),[4792,4799),[4800,4801),[4802,4806),[4808,4823),[4824,4881),[4882,4886),[4888,4955),[4957,4989),[4992,5018),[5024,5110),[5112,5118),[5120,5789),[5792,5881),[5888,5910),[5919,5943),[5952,5972),[5984,5997),[5998,6001),[6002,6004),[6016,6110),[6112,6122),[6128,6138),[6144,6170),[6176,6265),[6272,6315),[6320,6390),[6400,6431),[6432,6444),[6448,6460),[6464,6465),[6468,6510),[6512,6517),[6528,6572),[6576,6602),[6608,6619),[6622,6684),[6686,6751),[6752,6781),[6783,6794),[6800,6810),[6816,6830),[6832,6863),[6912,6989),[6992,7039),[7040,7156),[7164,7224),[7227,7242),[7245,7305),[7312,7355),[7357,7368),[7376,7419),[7424,7958),[7960,7966),[7968,8006),[8008,8014),[8016,8024),[8025,8026),[8027,8028),[8029,8030),[8031,8062),[8064,8117),[8118,8133),[8134,8148),[8150,8156),[8157,8176),[8178,8181),[8182,8191),[8192,8293),[8294,8306),[8308,8335),[8336,8349),[8352,8385),[8400,8433),[8448,8588),[8592,9255),[9280,9291),[9312,11124),[11126,11158),[11159,11508),[11513,11558),[11559,11560),[11565,11566),[11568,11624),[11631,11633),[11647,11671),[11680,11687),[11688,11695),[11696,11703),[11704,11711),[11712,11719),[11720,11727),[11728,11735),[11736,11743),[11744,11870),[11904,11930),[11931,12020),[12032,12246),[12272,12284),[12288,12352),[12353,12439),[12441,12544),[12549,12592),[12593,12687),[12688,12772),[12784,12831),[12832,42125),[42128,42183),[42192,42540),[42560,42744),[42752,42955),[42960,42962),[42963,42964),[42965,42970),[42994,43053),[43056,43066),[43072,43128),[43136,43206),[43214,43226),[43232,43348),[43359,43389),[43392,43470),[43471,43482),[43486,43519),[43520,43575),[43584,43598),[43600,43610),[43612,43715),[43739,43767),[43777,43783),[43785,43791),[43793,43799),[43808,43815),[43816,43823),[43824,43884),[43888,44014),[44016,44026),[44032,55204),[55216,55239),[55243,55292),[57344,64110),[64112,64218),[64256,64263),[64275,64280),[64285,64311),[64312,64317),[64318,64319),[64320,64322),[64323,64325),[64326,64451),[64467,64912),[64914,64968),[64975,64976),[65008,65050),[65056,65107),[65108,65127),[65128,65132),[65136,65141),[65142,65277),[65279,65280),[65281,65471),[65474,65480),[65482,65488),[65490,65496),[65498,65501),[65504,65511),[65512,65519),[65529,65534),[65536,65548),[65549,65575),[65576,65595),[65596,65598),[65599,65614),[65616,65630),[65664,65787),[65792,65795),[65799,65844),[65847,65935),[65936,65949),[65952,65953),[66000,66046),[66176,66205),[66208,66257),[66272,66300),[66304,66340),[66349,66379),[66384,66427),[66432,66462),[66463,66500),[66504,66518),[66560,66718),[66720,66730),[66736,66772),[66776,66812),[66816,66856),[66864,66916),[66927,66939),[66940,66955),[66956,66963),[66964,66966),[66967,66978),[66979,66994),[66995,67002),[67003,67005),[67072,67383),[67392,67414),[67424,67432),[67456,67462),[67463,67505),[67506,67515),[67584,67590),[67592,67593),[67594,67638),[67639,67641),[67644,67645),[67647,67670),[67671,67743),[67751,67760),[67808,67827),[67828,67830),[67835,67868),[67871,67898),[67903,67904),[67968,68024),[68028,68048),[68050,68100),[68101,68103),[68108,68116),[68117,68120),[68121,68150),[68152,68155),[68159,68169),[68176,68185),[68192,68256),[68288,68327),[68331,68343),[68352,68406),[68409,68438),[68440,68467),[68472,68498),[68505,68509),[68521,68528),[68608,68681),[68736,68787),[68800,68851),[68858,68904),[68912,68922),[69216,69247),[69248,69290),[69291,69294),[69296,69298),[69373,69416),[69424,69466),[69488,69514),[69552,69580),[69600,69623),[69632,69710),[69714,69750),[69759,69827),[69837,69838),[69840,69865),[69872,69882),[69888,69941),[69942,69960),[69968,70007),[70016,70112),[70113,70133),[70144,70162),[70163,70210),[70272,70279),[70280,70281),[70282,70286),[70287,70302),[70303,70314),[70320,70379),[70384,70394),[70400,70404),[70405,70413),[70415,70417),[70419,70441),[70442,70449),[70450,70452),[70453,70458),[70459,70469),[70471,70473),[70475,70478),[70480,70481),[70487,70488),[70493,70500),[70502,70509),[70512,70517),[70656,70748),[70749,70754),[70784,70856),[70864,70874),[71040,71094),[71096,71134),[71168,71237),[71248,71258),[71264,71277),[71296,71354),[71360,71370),[71424,71451),[71453,71468),[71472,71495),[71680,71740),[71840,71923),[71935,71943),[71945,71946),[71948,71956),[71957,71959),[71960,71990),[71991,71993),[71995,72007),[72016,72026),[72096,72104),[72106,72152),[72154,72165),[72192,72264),[72272,72355),[72368,72441),[72448,72458),[72704,72713),[72714,72759),[72760,72774),[72784,72813),[72816,72848),[72850,72872),[72873,72887),[72960,72967),[72968,72970),[72971,73015),[73018,73019),[73020,73022),[73023,73032),[73040,73050),[73056,73062),[73063,73065),[73066,73103),[73104,73106),[73107,73113),[73120,73130),[73440,73465),[73472,73489),[73490,73531),[73534,73562),[73648,73649),[73664,73714),[73727,74650),[74752,74863),[74864,74869),[74880,75076),[77712,77811),[77824,78934),[82944,83527),[92160,92729),[92736,92767),[92768,92778),[92782,92863),[92864,92874),[92880,92910),[92912,92918),[92928,92998),[93008,93018),[93019,93026),[93027,93048),[93053,93072),[93760,93851),[93952,94027),[94031,94088),[94095,94112),[94176,94181),[94192,94194),[94208,100344),[100352,101590),[101632,101641),[110576,110580),[110581,110588),[110589,110591),[110592,110883),[110898,110899),[110928,110931),[110933,110934),[110948,110952),[110960,111356),[113664,113771),[113776,113789),[113792,113801),[113808,113818),[113820,113828),[118528,118574),[118576,118599),[118608,118724),[118784,119030),[119040,119079),[119081,119275),[119296,119366),[119488,119508),[119520,119540),[119552,119639),[119648,119673),[119808,119893),[119894,119965),[119966,119968),[119970,119971),[119973,119975),[119977,119981),[119982,119994),[119995,119996),[119997,120004),[120005,120070),[120071,120075),[120077,120085),[120086,120093),[120094,120122),[120123,120127),[120128,120133),[120134,120135),[120138,120145),[120146,120486),[120488,120780),[120782,121484),[121499,121504),[121505,121520),[122624,122655),[122661,122667),[122880,122887),[122888,122905),[122907,122914),[122915,122917),[122918,122923),[122928,122990),[123023,123024),[123136,123181),[123184,123198),[123200,123210),[123214,123216),[123536,123567),[123584,123642),[123647,123648),[124112,124154),[124896,124903),[124904,124908),[124909,124911),[124912,124927),[124928,125125),[125127,125143),[125184,125260),[125264,125274),[125278,125280),[126065,126133),[126209,126270),[126464,126468),[126469,126496),[126497,126499),[126500,126501),[126503,126504),[126505,126515),[126516,126520),[126521,126522),[126523,126524),[126530,126531),[126535,126536),[126537,126538),[126539,126540),[126541,126544),[126545,126547),[126548,126549),[126551,126552),[126553,126554),[126555,126556),[126557,126558),[126559,126560),[126561,126563),[126564,126565),[126567,126571),[126572,126579),[126580,126584),[126585,126589),[126590,126591),[126592,126602),[126603,126620),[126625,126628),[126629,126634),[126635,126652),[126704,126706),[126976,127020),[127024,127124),[127136,127151),[127153,127168),[127169,127184),[127185,127222),[127232,127406),[127462,127491),[127504,127548),[127552,127561),[127568,127570),[127584,127590),[127744,128728),[128732,128749),[128752,128765),[128768,128887),[128891,128986),[128992,129004),[129008,129009),[129024,129036),[129040,129096),[129104,129114),[129120,129160),[129168,129198),[129200,129202),[129280,129620),[129632,129646),[129648,129661),[129664,129673),[129680,129726),[129727,129734),[129742,129756),[129760,129769),[129776,129785),[129792,129939),[129940,129995),[130032,130042),[131072,173792),[173824,177978),[177984,178206),[178208,183970),[183984,191457),[194560,195102),[196608,201547),[201552,205744),[917505,917506),[917536,917632),[917760,918000),[983040,1048574),[1048576,1114110)}'::int4multirange
    )
  );
$function$;

revoke all on function private.agent_discovery_unicode15_text_is_supported(text)
  from public, anon, authenticated, service_role;
create or replace function private.agent_prompt_text_is_safe(
  p_value text,
  p_allow_text_whitespace boolean
) returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_character text;
  v_code integer;
begin
  for v_character in
    select regexp_split_to_table(p_value, '')
  loop
    v_code := ascii(v_character);
    if (
      (v_code between 0 and 31 and not (
        p_allow_text_whitespace and v_code in (9, 10)
      ))
      or v_code between 127 and 159
      or v_code in (173, 847, 1564, 6158, 8203, 8206, 8207, 8288, 65279)
      or v_code between 8234 and 8238
      or v_code between 8289 and 8303
      or v_code between 65529 and 65531
      or v_code between 917504 and 917631
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;
create or replace function private.agent_normalize_discovery_text(
  p_value text
) returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_value text;
begin
  if not private.agent_discovery_unicode15_text_is_supported(p_value)
     or octet_length(p_value) > 8192
     or p_value collate "und-x-icu" ~ '[[:cntrl:]]'
     or position(chr(1564) in p_value) > 0
     or position(chr(8206) in p_value) > 0
     or position(chr(8207) in p_value) > 0
     or position(chr(8234) in p_value) > 0
     or position(chr(8235) in p_value) > 0
     or position(chr(8236) in p_value) > 0
     or position(chr(8237) in p_value) > 0
     or position(chr(8238) in p_value) > 0
     or position(chr(8294) in p_value) > 0
     or position(chr(8295) in p_value) > 0
     or position(chr(8296) in p_value) > 0
     or position(chr(8297) in p_value) > 0
     or position(chr(65279) in p_value) > 0 then
    return null;
  end if;
  v_value := lower(private.agent_trim_discovery_display_text(
    regexp_replace(
      normalize(p_value, NFKC) collate "und-x-icu",
      '[[:space:]]+',
      ' ',
      'g'
    )
  ) collate "und-x-icu");
  if v_value = '' then
    return null;
  end if;
  return v_value;
end;
$function$;

revoke all on function private.agent_normalize_discovery_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_normalize_discovery_email(
  p_value text
) returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_value text;
begin
  v_value := private.agent_normalize_discovery_text(p_value);
  if v_value is null
     or char_length(v_value) not between 3 and 200
     or v_value ~ '[[:space:]]'
     or position('@' in v_value) not between 2 and 65
     or octet_length(split_part(v_value, '@', 1)) > 64
     or v_value !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(?:[.][a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    return null;
  end if;
  return v_value;
end;
$function$;

revoke all on function private.agent_normalize_discovery_email(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_normalize_discovery_phone(
  p_value text
) returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_value text;
  v_national text;
begin
  v_value := private.agent_normalize_discovery_text(p_value);
  if v_value is null or v_value !~ '^[+0-9(). -]+$' then
    return null;
  end if;
  v_value := regexp_replace(v_value, '[(). -]', '', 'g');
  if left(v_value, 2) = '+1' then
    v_national := substr(v_value, 3);
  elsif char_length(v_value) = 10 and left(v_value, 1) <> '+' then
    v_national := v_value;
  else
    return null;
  end if;
  if v_national !~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then
    return null;
  end if;
  return '+1' || v_national;
end;
$function$;

revoke all on function private.agent_normalize_discovery_phone(text)
  from public, anon, authenticated, service_role;
create or replace function private.agent_currency_minor_exponent(
  p_currency_code text
) returns smallint
language plpgsql
immutable
strict
set search_path = pg_catalog
as $function$
begin
  case upper(p_currency_code)
    when 'JPY' then return 0;
    when 'CAD' then return 2;
    when 'BHD' then return 3;
    when 'CLF' then return 4;
    when 'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'KMF', 'KRW', 'PYG',
         'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF' then
      return 0;
    when 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND' then return 3;
    when 'UYW' then return 4;
    when 'AED', 'AFN', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
         'BAM', 'BBD', 'BDT', 'BGN', 'BMD', 'BND', 'BOB', 'BOV', 'BRL',
         'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CDF', 'CHE', 'CHW',
         'CNY', 'COP', 'COU', 'CRC', 'CUP', 'CVE', 'CZK', 'DKK', 'DOP',
         'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL',
         'GHS', 'GIP', 'GMD', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF',
         'IDR', 'ILS', 'INR', 'IRR', 'JMD', 'KES', 'KGS', 'KHR', 'KPW',
         'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'MAD', 'MDL',
         'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK',
         'MXN', 'MXV', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR',
         'NZD', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'QAR', 'RON',
         'RSD', 'RUB', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP',
         'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB',
         'TJS', 'TMT', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'USD',
         'USN', 'UYU', 'UZS', 'VED', 'VES', 'WST', 'XCD', 'YER', 'ZAR',
         'ZMW', 'ZWL' then
      return 2;
    else
      raise exception 'agent_currency_minor_exponent_unknown: %',
        p_currency_code using errcode = '22023';
  end case;
end;
$function$;

revoke all on function private.agent_currency_minor_exponent(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_currency_minor_exponent_or_null(
  p_currency_code text
) returns smallint
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $function$
begin
  return private.agent_currency_minor_exponent(p_currency_code);
exception
  when sqlstate '22023' then return null;
end;
$function$;

revoke all on function private.agent_currency_minor_exponent_or_null(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_money_to_minor_units(
  p_amount numeric,
  p_currency_code text
) returns bigint
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $function$
declare
  v_scaled numeric;
begin
  v_scaled := p_amount * power(10::numeric,
    private.agent_currency_minor_exponent(p_currency_code));
  if v_scaled::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'agent_money_minor_units_out_of_range'
      using errcode = '22003';
  end if;
  if trunc(v_scaled) is distinct from v_scaled then
    raise exception 'agent_money_minor_units_not_exact'
      using errcode = '22023';
  end if;
  if abs(v_scaled) > 9007199254740991::numeric then
    raise exception 'agent_money_minor_units_out_of_range'
      using errcode = '22003';
  end if;
  return v_scaled::bigint;
end;
$function$;

revoke all on function private.agent_money_to_minor_units(numeric, text)
  from public, anon, authenticated, service_role;
create or replace function private.agent_uuid_from_legacy_text(
  p_value text
) returns uuid
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $helper$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then lower(p_value)::uuid
  end;
$helper$;

revoke all on function private.agent_uuid_from_legacy_text(text)
  from public, anon, authenticated, service_role;
grant execute on function private.agent_uuid_from_legacy_text(text)
  to anon, authenticated, service_role;
create or replace function private.agent_unambiguous_local_instant(
  p_local timestamp without time zone,
  p_timezone text
) returns timestamptz
language sql
stable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  with guessed as materialized (
    select p_local at time zone p_timezone as instant
  ), probes as materialized (
    select guessed.instant from guessed
    union all
    select guessed.instant - interval '36 hours' from guessed
    union all
    select guessed.instant + interval '36 hours' from guessed
  ), possible_offset as materialized (
    select distinct
           (probe.instant at time zone p_timezone) -
             (probe.instant at time zone 'UTC') as utc_offset
    from probes probe
  ), matching as (
    select distinct
           (p_local - tz.utc_offset) at time zone 'UTC' as instant
    from possible_offset tz
    where (
      (p_local - tz.utc_offset) at time zone 'UTC'
    ) at time zone p_timezone = p_local
  )
  select case when count(*) = 1 then min(instant) else null end
  from matching;
$function$;

revoke all on function private.agent_unambiguous_local_instant(
  timestamp without time zone, text
) from public, anon, authenticated, service_role;

create or replace function private.agent_civil_date_start(
  p_date date,
  p_timezone text
) returns timestamptz
language sql
stable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  with local_value as materialized (
    select p_date::timestamp without time zone as value
  ), guessed as materialized (
    select local.value at time zone p_timezone as instant
    from local_value local
  ), probes as materialized (
    select guessed.instant from guessed
    union all
    select guessed.instant - interval '36 hours' from guessed
    union all
    select guessed.instant + interval '36 hours' from guessed
  ), possible_offset as materialized (
    select distinct
           (probe.instant at time zone p_timezone) -
             (probe.instant at time zone 'UTC') as utc_offset
    from probes probe
  ), exact_match as materialized (
    select distinct
           (local.value - tz.utc_offset) at time zone 'UTC' as instant
    from local_value local
    cross join possible_offset tz
    where (
      (local.value - tz.utc_offset) at time zone 'UTC'
    ) at time zone p_timezone = local.value
  ), boundary as materialized (
    select min(match.instant) as instant from exact_match match
  )
  select coalesce(
    boundary.instant,
    case when (guessed.instant at time zone p_timezone)::date = p_date
      then guessed.instant
      else null
    end
  )
  from boundary
  cross join guessed;
$function$;

revoke all on function private.agent_civil_date_start(date, text)
  from public, anon, authenticated, service_role;

-- Install the exact pre-P2 OAuth authorization-server schema, then preserve a
-- pre-versioning client/code/grant for the consent migration's backfill proof.
\ir ../../supabase/migrations/20260818155813_mcp_oauth_authorization_server.sql

insert into public.companies(id,name) values (
  'f0260000-0000-4000-8000-000000000001','OAuth fixture company'
);
insert into public.companies(id,name) values (
  '6a100000-0000-4000-8000-000000000001','Revision backfill fixture company'
);
insert into public.companies(id,name) values (
  '33333333-3333-4333-8333-333333333333','OAuth runtime company'
);
insert into public.users(id,company_id,first_name,last_name,email) values (
  'f0260000-0000-4000-8000-000000000002',
  'f0260000-0000-4000-8000-000000000001',
  'OAuth','Operator','oauth@example.test'
);
insert into public.users(id,company_id,first_name,last_name,email) values (
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'Runtime','Operator','runtime-oauth@example.test'
);
insert into private.mcp_oauth_clients(
  client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,
  response_types,scope,registration_source
) values (
  '11111111-1111-4111-8111-111111111111','Existing client',
  array['https://example.test/callback'],'none',
  array['authorization_code','refresh_token'],array['code'],
  'ops.jobs.read ops.schedule.read','dynamic'
);
revoke all on table private.agent_operational_read_revisions,
  private.agent_job_history_revisions,
  private.agent_contactability_address_revisions
  from public, anon, authenticated, service_role;

revoke all on function private.user_is_active_company_member(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_agent_actor_authority(
  uuid, uuid, text[]
) from public, anon, authenticated, service_role;
revoke all on function private.agent_user_can_access_entity(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_inbox_connection(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.agent_rfc3339_utc(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_prompt_text_is_safe(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.user_is_company_admin(uuid, uuid),
  private.raw_permission_scope_for_user(uuid, uuid, text),
  private.should_use_pipeline_manage_compat(uuid, uuid, text),
  private.least_permissive_pipeline_scope(text, text),
  private.effective_pipeline_scope_for_user(uuid, uuid, text),
  private.should_use_inbox_view_company_compat(uuid, uuid),
  private.effective_inbox_scope_for_user(uuid, uuid, text),
  private.effective_permission_scope_for_user(uuid, uuid, text),
  private.user_can_view_opportunity(uuid, uuid),
  private.user_can_view_project(uuid, uuid),
  private.user_can_view_task(uuid, uuid),
  private.user_can_view_client(uuid, uuid, uuid),
  private.user_can_view_sub_client(uuid, uuid, uuid),
  private.user_can_edit_opportunity(uuid, uuid),
  private.user_can_edit_project(uuid, uuid),
  private.user_is_project_member_for_task(uuid, uuid, uuid),
  private.user_can_edit_task(uuid, uuid),
  private.user_can_change_task_status(uuid, uuid),
  private.user_can_edit_client(uuid, uuid, uuid),
  private.user_can_edit_sub_client(uuid, uuid, uuid),
  private.user_can_view_calendar_event(uuid, uuid, uuid),
  private.user_can_edit_calendar_event(uuid, uuid, uuid),
  private.user_can_view_calendar_user_event(uuid, uuid, uuid),
  private.user_can_edit_calendar_user_event(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.has_permission(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.has_permission(uuid, text, text)
  to service_role;
revoke all on function private.try_parse_uuid(text)
  from public, anon, authenticated, service_role;
grant execute on function private.try_parse_uuid(text)
  to anon, authenticated;

do $agent_p2_full_wave_baseline_acl$
declare
  v_untrusted_grantees oid[] := array[
    0::oid,
    (select oid from pg_catalog.pg_roles where rolname = 'anon'),
    (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
    (select oid from pg_catalog.pg_roles where rolname = 'service_role')
  ];
begin
  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.normalize_project_opportunity_link()'::pg_catalog.regprocedure,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.normalize_project_opportunity_link()'::pg_catalog.regprocedure,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.normalize_project_opportunity_link()'::pg_catalog.regprocedure,
       'EXECUTE'
     ) then
    raise exception
      'agent_p2_full_wave_baseline_project_normalizer_acl_invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language
      on language.oid = procedure.prolang
    where procedure.oid = pg_catalog.to_regprocedure(
            'private.user_is_project_member_for_task(uuid,uuid,uuid)'
          )
      and language.lanname = 'sql'
      and procedure.provolatile = 's'
      and procedure.prosecdef
      and not procedure.proisstrict
      and procedure.proparallel = 'u'
      and procedure.proconfig = array[
        'search_path=pg_catalog, public, pg_temp'
      ]::text[]
  ) then
    raise exception
      'agent_p2_full_wave_baseline_task_membership_metadata_invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'private.user_is_active_company_member(uuid,uuid)',
      'private.user_is_company_admin(uuid,uuid)',
      'private.raw_permission_scope_for_user(uuid,uuid,text)',
      'private.should_use_pipeline_manage_compat(uuid,uuid,text)',
      'private.least_permissive_pipeline_scope(text,text)',
      'private.effective_pipeline_scope_for_user(uuid,uuid,text)',
      'private.should_use_inbox_view_company_compat(uuid,uuid)',
      'private.effective_inbox_scope_for_user(uuid,uuid,text)',
      'private.effective_permission_scope_for_user(uuid,uuid,text)',
      'private.resolve_agent_actor_authority(uuid,uuid,text[])',
      'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)',
      'private.user_can_view_opportunity(uuid,uuid)',
      'private.user_can_view_project(uuid,uuid)',
      'private.user_can_view_task(uuid,uuid)',
      'private.user_can_view_client(uuid,uuid,uuid)',
      'private.user_can_view_sub_client(uuid,uuid,uuid)',
      'private.user_can_edit_opportunity(uuid,uuid)',
      'private.user_can_edit_project(uuid,uuid)',
      'private.user_is_project_member_for_task(uuid,uuid,uuid)',
      'private.user_can_edit_task(uuid,uuid)',
      'private.user_can_change_task_status(uuid,uuid)',
      'private.user_can_edit_client(uuid,uuid,uuid)',
      'private.user_can_edit_sub_client(uuid,uuid,uuid)',
      'private.user_can_view_calendar_event(uuid,uuid,uuid)',
      'private.user_can_edit_calendar_event(uuid,uuid,uuid)',
      'private.user_can_view_calendar_user_event(uuid,uuid,uuid)',
      'private.user_can_edit_calendar_user_event(uuid,uuid,uuid)',
      'private.user_can_view_inbox_connection(uuid,uuid,uuid,uuid)',
      'private.agent_rfc3339_utc(timestamp with time zone)',
      'private.agent_prompt_text_is_safe(text,boolean)'
    ]::text[]) signature(value)
    join pg_catalog.pg_proc procedure
      on procedure.oid = pg_catalog.to_regprocedure(signature.value)
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) privilege
    where privilege.grantee = any(v_untrusted_grantees)
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'agent_p2_full_wave_baseline_function_acl_invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'private.agent_operational_read_revisions',
      'private.agent_job_history_revisions',
      'private.agent_contactability_address_revisions'
    ]::text[]) relation(value)
    join pg_catalog.pg_class class
      on class.oid = pg_catalog.to_regclass(relation.value)
    cross join lateral pg_catalog.aclexplode(
      coalesce(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) privilege
    where privilege.grantee = any(v_untrusted_grantees)
  ) then
    raise exception 'agent_p2_full_wave_baseline_table_acl_invalid';
  end if;
end;
$agent_p2_full_wave_baseline_acl$;

insert into private.mcp_oauth_authorization_codes(
  code_hash,client_id,user_id,company_id,scopes,redirect_uri,code_challenge,
  code_challenge_method,resource,expires_at
) values (
  repeat('a',64),'11111111-1111-4111-8111-111111111111',
  'f0260000-0000-4000-8000-000000000002',
  'f0260000-0000-4000-8000-000000000001',array['ops.jobs.read'],
  'https://example.test/callback',repeat('A',43),'S256',
  'https://example.test/mcp',statement_timestamp() + interval '5 minutes'
);
insert into private.mcp_oauth_grants(
  id,user_id,company_id,client_id,scopes,revision
) values (
  '44444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  array['ops.jobs.read','ops.schedule.read'],
  '0123456789abcdef0123456789abcdef'
);

do $agent_p2_full_wave_baseline_ready$
begin
  raise notice 'agent_p2_full_wave_baseline_ready';
end;
$agent_p2_full_wave_baseline_ready$;
