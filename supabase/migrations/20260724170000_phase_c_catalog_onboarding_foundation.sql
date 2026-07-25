begin;

-- Phase C catalog onboarding is deliberately split into durable interview,
-- proposed-action, verification, purchasing-cost, recipe-rule, capability, and
-- opening-inventory records. The model never writes catalog rows directly.

create table if not exists public.catalog_guided_setup_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  operator_id uuid not null references public.users(id) on delete restrict,
  mode text not null default 'guided' check (mode = 'guided'),
  status text not null default 'interviewing' check (
    status in (
      'interviewing',
      'review',
      'approved',
      'committing',
      'attention',
      'complete',
      'abandoned'
    )
  ),
  version integer not null default 0 check (version >= 0),
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  unresolved_questions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(unresolved_questions) = 'array'),
  contradictions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(contradictions) = 'array'),
  live_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(live_snapshot) = 'object'),
  live_snapshot_hash text not null check (char_length(live_snapshot_hash) between 1 and 128),
  proposed_plan jsonb check (proposed_plan is null or jsonb_typeof(proposed_plan) = 'object'),
  proposed_plan_hash text check (
    proposed_plan_hash is null or char_length(proposed_plan_hash) between 1 and 128
  ),
  validation_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(validation_issues) = 'array'),
  approval_hash text check (approval_hash is null or char_length(approval_hash) between 1 and 128),
  commit_operation_id uuid,
  commit_journal jsonb not null default '[]'::jsonb
    check (jsonb_typeof(commit_journal) = 'array'),
  readback jsonb check (readback is null or jsonb_typeof(readback) = 'object'),
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalog_guided_setup_sessions_one_active_company
  on public.catalog_guided_setup_sessions(company_id)
  where status in ('interviewing', 'review', 'approved', 'committing', 'attention');

create index if not exists catalog_guided_setup_sessions_company_updated
  on public.catalog_guided_setup_sessions(company_id, updated_at desc);

create index if not exists catalog_guided_setup_sessions_operator_updated
  on public.catalog_guided_setup_sessions(operator_id, updated_at desc);

create table if not exists public.catalog_guided_setup_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.catalog_guided_setup_sessions(id) on delete cascade,
  action_key text not null check (char_length(btrim(action_key)) between 1 and 180),
  action_hash text not null check (char_length(action_hash) between 1 and 128),
  action_type text not null check (char_length(btrim(action_type)) between 1 and 100),
  target_kind text not null check (char_length(btrim(target_kind)) between 1 and 100),
  target_id uuid,
  status text not null default 'planned' check (
    status in ('planned', 'running', 'committed', 'verified', 'failed')
  ),
  source_fingerprint text,
  commit_operation_id uuid,
  request jsonb not null default '{}'::jsonb check (jsonb_typeof(request) = 'object'),
  response jsonb check (response is null or jsonb_typeof(response) in ('object', 'array')),
  error jsonb check (error is null or jsonb_typeof(error) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  committed_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, action_key),
  unique (session_id, action_hash)
);

create index if not exists catalog_guided_setup_actions_company_status
  on public.catalog_guided_setup_actions(company_id, status);

create index if not exists catalog_guided_setup_actions_session_status
  on public.catalog_guided_setup_actions(session_id, status);

create table if not exists public.catalog_setup_verification_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid references public.catalog_guided_setup_sessions(id) on delete set null,
  item_key text not null check (char_length(btrim(item_key)) between 1 and 180),
  subject_kind text not null check (char_length(btrim(subject_kind)) between 1 and 100),
  subject_id uuid,
  status text not null default 'pending' check (
    status in ('pending', 'verified', 'dismissed')
  ),
  severity text not null default 'verification' check (
    severity in ('verification', 'warning', 'blocker')
  ),
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, item_key)
);

create index if not exists catalog_setup_verification_items_company_status
  on public.catalog_setup_verification_items(company_id, status, created_at);

create index if not exists catalog_setup_verification_items_session
  on public.catalog_setup_verification_items(session_id);

create table if not exists public.catalog_supplier_cost_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  catalog_variant_id uuid not null references public.catalog_variants(id) on delete cascade,
  profile_key text not null check (char_length(btrim(profile_key)) between 1 and 80),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  currency_code text not null default 'CAD' check (currency_code ~ '^[A-Z]{3}$'),
  is_default boolean not null default false,
  activation_rule jsonb not null default '{}'::jsonb
    check (jsonb_typeof(activation_rule) = 'object'),
  source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, catalog_variant_id, profile_key)
);

create unique index if not exists catalog_supplier_cost_profiles_one_default
  on public.catalog_supplier_cost_profiles(company_id, catalog_variant_id)
  where is_default and deleted_at is null;

create index if not exists catalog_supplier_cost_profiles_company_variant
  on public.catalog_supplier_cost_profiles(company_id, catalog_variant_id)
  where deleted_at is null;

create table if not exists public.product_material_quantity_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_material_id uuid not null references public.product_materials(id) on delete cascade,
  calculation_kind text not null check (
    calculation_kind in ('product_quantity', 'coverage', 'edge_length', 'cut_plan')
  ),
  measure_source text not null check (char_length(btrim(measure_source)) between 1 and 120),
  required_inputs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_inputs) = 'array'),
  coverage_quantity numeric(14, 4) check (coverage_quantity is null or coverage_quantity > 0),
  waste_factor numeric(8, 6) not null default 1 check (waste_factor >= 1),
  purchase_rounding text not null default 'none' check (
    purchase_rounding in ('none', 'increment', 'whole_package', 'whole_length')
  ),
  rounding_increment numeric(14, 4) check (
    rounding_increment is null or rounding_increment > 0
  ),
  package_quantity numeric(14, 4) check (package_quantity is null or package_quantity > 0),
  fallback_rule jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fallback_rule) = 'object'),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, product_material_id)
);

create index if not exists product_material_quantity_rules_company
  on public.product_material_quantity_rules(company_id)
  where deleted_at is null;

create table if not exists public.catalog_product_capability_bindings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  capability_key text not null check (char_length(btrim(capability_key)) between 1 and 120),
  required_inputs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_inputs) = 'array'),
  fallback_behavior jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fallback_behavior) = 'object'),
  enabled boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, product_id, capability_key)
);

create index if not exists catalog_product_capability_bindings_company
  on public.catalog_product_capability_bindings(company_id)
  where deleted_at is null;

create table if not exists public.catalog_inventory_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  operator_id uuid not null references public.users(id) on delete restrict,
  setup_session_id uuid references public.catalog_guided_setup_sessions(id) on delete set null,
  status text not null default 'draft' check (
    status in ('draft', 'review', 'committing', 'attention', 'complete', 'abandoned')
  ),
  source_name text not null check (char_length(btrim(source_name)) between 1 and 255),
  source_mime_type text,
  source_hash text not null check (char_length(source_hash) between 1 and 128),
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  validation_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(validation_issues) = 'array'),
  commit_operation_id uuid,
  error jsonb check (error is null or jsonb_typeof(error) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_hash)
);

create index if not exists catalog_inventory_imports_company_updated
  on public.catalog_inventory_imports(company_id, updated_at desc);

create index if not exists catalog_inventory_imports_session
  on public.catalog_inventory_imports(setup_session_id);

create table if not exists public.catalog_inventory_import_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  import_id uuid not null references public.catalog_inventory_imports(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  row_fingerprint text not null check (char_length(row_fingerprint) between 1 and 128),
  status text not null default 'pending' check (
    status in ('pending', 'matched', 'needs_input', 'committed', 'failed', 'skipped')
  ),
  raw_data jsonb not null check (jsonb_typeof(raw_data) = 'object'),
  normalized_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(normalized_data) = 'object'),
  matched_variant_id uuid references public.catalog_variants(id) on delete set null,
  proposed_stock_unit jsonb check (
    proposed_stock_unit is null or jsonb_typeof(proposed_stock_unit) = 'object'
  ),
  validation_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(validation_issues) = 'array'),
  committed_stock_unit_id uuid references public.catalog_stock_units(id) on delete set null,
  committed_event_id uuid references public.catalog_stock_unit_events(id) on delete set null,
  error jsonb check (error is null or jsonb_typeof(error) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, row_number),
  unique (import_id, row_fingerprint)
);

create index if not exists catalog_inventory_import_rows_company_status
  on public.catalog_inventory_import_rows(company_id, status);

create index if not exists catalog_inventory_import_rows_import
  on public.catalog_inventory_import_rows(import_id, row_number);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'catalog_guided_setup_sessions',
    'catalog_guided_setup_actions',
    'catalog_setup_verification_items',
    'catalog_supplier_cost_profiles',
    'product_material_quantity_rules',
    'catalog_product_capability_bindings',
    'catalog_inventory_imports',
    'catalog_inventory_import_rows'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.fn_set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_company_isolation', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (
        company_id = (select private.get_user_company_id())
        and private.current_user_has_permission(''catalog.run_setup'', ''all'')
      ) with check (
        company_id = (select private.get_user_company_id())
        and private.current_user_has_permission(''catalog.run_setup'', ''all'')
      )',
      table_name || '_company_isolation',
      table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_firebase_bridge', table_name);
    execute format(
      'create policy %I on public.%I for all to anon using (
        company_id = private.get_user_company_id()
        and private.current_user_has_permission(''catalog.run_setup'', ''all'')
      ) with check (
        company_id = private.get_user_company_id()
        and private.current_user_has_permission(''catalog.run_setup'', ''all'')
      )',
      table_name || '_firebase_bridge',
      table_name
    );
  end loop;
end
$$;

revoke all on table
  public.catalog_guided_setup_sessions,
  public.catalog_guided_setup_actions,
  public.catalog_setup_verification_items,
  public.catalog_supplier_cost_profiles,
  public.product_material_quantity_rules,
  public.catalog_product_capability_bindings,
  public.catalog_inventory_imports,
  public.catalog_inventory_import_rows
from public;

grant select, insert, update
  on public.catalog_guided_setup_sessions,
  public.catalog_guided_setup_actions,
  public.catalog_setup_verification_items,
  public.catalog_supplier_cost_profiles,
  public.product_material_quantity_rules,
  public.catalog_product_capability_bindings,
  public.catalog_inventory_imports,
  public.catalog_inventory_import_rows
to anon, authenticated;

commit;
