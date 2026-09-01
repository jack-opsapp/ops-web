\set ON_ERROR_STOP on

\if :{?agent_mcp_catalog_bootstrap}
-- Disposable PostgreSQL 17 bootstrap for Task 18. It defines only the
-- production-shaped prerequisites used by the catalogue source/read slices.
-- Behavioral rows below are rollback-only.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function auth.role() returns text
language sql stable set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
$$;

create table if not exists public.companies (
  id uuid primary key,
  name text not null,
  currency_code text not null default 'CAD',
  deleted_at timestamptz
);
create table if not exists public.users (
  id uuid primary key,
  company_id uuid not null,
  first_name text not null default 'Catalogue',
  last_name text not null default 'Operator',
  is_active boolean not null default true,
  deleted_at timestamptz
);
create table if not exists public.user_permission_overrides (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  permission text not null,
  scope text,
  granted boolean not null default true
);
create table if not exists public.catalog_categories (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  default_critical_threshold double precision,
  default_warning_threshold double precision,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table if not exists public.catalog_units (
  id uuid primary key,
  company_id uuid not null,
  display text not null,
  abbreviation text,
  dimension text not null default 'count',
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table if not exists public.catalog_items (
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
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table if not exists public.catalog_variants (
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
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create index if not exists catalog_variants_company_item_runtime
  on public.catalog_variants(company_id, catalog_item_id, id)
  where deleted_at is null;
create table if not exists public.catalog_options (
  id uuid primary key,
  catalog_item_id uuid not null,
  name text not null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table if not exists public.catalog_option_values (
  id uuid primary key,
  option_id uuid not null,
  value text not null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table if not exists public.catalog_variant_option_values (
  id uuid primary key,
  variant_id uuid not null,
  option_value_id uuid not null,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table if not exists public.catalog_tags (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  warning_threshold double precision,
  critical_threshold double precision,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table if not exists public.catalog_item_tags (
  id uuid primary key,
  catalog_item_id uuid not null,
  tag_id uuid not null
);
create table if not exists public.catalog_stock_units (
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
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create index if not exists catalog_stock_units_company_variant_runtime
  on public.catalog_stock_units(company_id, catalog_variant_id, id)
  where deleted_at is null;
create table if not exists public.catalog_supplier_cost_profiles (
  id uuid primary key,
  company_id uuid not null,
  catalog_variant_id uuid not null,
  profile_key text not null,
  label text not null,
  unit_cost numeric(14,4) not null,
  currency_code text not null default 'CAD',
  is_default boolean not null default false,
  activation_rule jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table if not exists public.products (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  linked_catalog_item_id uuid,
  is_active boolean default true,
  deleted_at timestamptz,
  created_at timestamptz default pg_catalog.statement_timestamp(),
  updated_at timestamptz default pg_catalog.statement_timestamp()
);
create table if not exists public.product_materials (
  id uuid primary key,
  product_id uuid not null,
  catalog_item_id uuid,
  catalog_variant_id uuid,
  quantity_per_unit double precision not null default 1,
  unit_id uuid,
  notes text,
  deleted_at timestamptz,
  updated_at timestamptz not null default pg_catalog.statement_timestamp()
);
alter table public.product_materials
  drop constraint if exists task18_product_material_catalog_xor;
alter table public.product_materials
  add constraint task18_product_material_catalog_xor check (
    (catalog_variant_id is not null and catalog_item_id is null)
    or (catalog_variant_id is null and catalog_item_id is not null)
  );

create table if not exists private.agent_read_domains (
  domain text primary key
);
insert into private.agent_read_domains(domain) values ('catalog')
on conflict(domain) do nothing;
create table if not exists private.agent_read_domain_revisions (
  company_id uuid not null,
  domain text not null,
  source_revision bigint not null default 0,
  primary key(company_id, domain)
);
create table if not exists private.mcp_oauth_clients (
  client_id uuid primary key,
  client_name text not null,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null,
  grant_types text[] not null,
  response_types text[] not null,
  scope text not null,
  registration_source text not null,
  software_id text,
  software_version text,
  scope_ceiling text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  disabled_at timestamptz
);
create table if not exists private.mcp_oauth_grants (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  client_id uuid not null,
  scopes text[] not null,
  revision text not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  accepted_labels text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null
);

create or replace function private.agent_read_domain_uuid_from_text(
  p_value text
) returns uuid
language plpgsql immutable security invoker set search_path = ''
as $$
begin
  if p_value is null
     or p_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.advance_agent_read_domain_revisions(
  p_company_ids uuid[], p_domain text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.agent_read_domain_revisions(
    company_id, domain, source_revision
  )
  select distinct company_id, p_domain, 1
  from pg_catalog.unnest(coalesce(p_company_ids, array[]::uuid[])) company_id
  where company_id is not null
  on conflict(company_id, domain) do update
    set source_revision =
      private.agent_read_domain_revisions.source_revision + 1;
end;
$$;

create or replace function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_registered_permission_keys text[]
) returns table(
  permission_snapshot_revision text,
  effective_permissions jsonb
)
language sql stable security invoker set search_path = ''
as $$
  with permissions as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'permission', permission.permission,
                 'scope', permission.scope
               ) order by permission.permission collate "C"
             ),
             '[]'::jsonb
           ) as value
    from public.user_permission_overrides permission
    where permission.user_id = p_actor_user_id
      and permission.company_id = p_company_id
      and permission.granted
      and permission.permission = any(p_registered_permission_keys)
  )
  select 'sha256:' || pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               p_actor_user_id::text || ':' || p_company_id::text || ':' ||
                 permissions.value::text,
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         ),
         permissions.value
  from public.users actor
  cross join permissions
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and actor.is_active;
$$;

create or replace function private.mcp_oauth_labels_for_scopes(text[], text)
returns text[]
language sql immutable set search_path = ''
as $$ select coalesce($1, array[]::text[]) $$;

create or replace function private.agent_p2_optional_canonical_text(
  p_value text,
  p_max_scalars integer,
  p_max_bytes integer,
  p_allow_whitespace boolean
) returns text
language sql immutable security invoker set search_path = ''
as $$
  select case
    when p_value is null or p_value = '' then null
    when pg_catalog.char_length(p_value) > p_max_scalars then null
    when pg_catalog.octet_length(p_value) > p_max_bytes then null
    when not p_allow_whitespace
      and p_value is distinct from pg_catalog.btrim(p_value) then null
    else p_value
  end;
$$;

create or replace function private.agent_rfc3339_utc(p_value timestamptz)
returns text
language sql immutable strict security invoker set search_path = ''
as $$
  select pg_catalog.to_char(
    p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$$;

create or replace function private.canonical_agent_projection_json(
  p_value jsonb
) returns text
language sql immutable strict security invoker set search_path = ''
as $$ select p_value::text $$;

create or replace function private.agent_currency_minor_exponent_or_null(
  p_currency_code text
) returns smallint
language sql immutable strict security invoker set search_path = ''
as $$
  select case pg_catalog.upper(p_currency_code)
    when 'JPY' then 0::smallint
    when 'BHD' then 3::smallint
    when 'CAD' then 2::smallint
    when 'USD' then 2::smallint
    when 'EUR' then 2::smallint
    else null::smallint
  end;
$$;

create or replace function private.agent_money_to_minor_units(
  p_amount numeric,
  p_currency_code text
) returns bigint
language plpgsql immutable strict security invoker set search_path = ''
as $$
declare
  v_exponent smallint;
  v_scaled numeric;
begin
  v_exponent := private.agent_currency_minor_exponent_or_null(
    p_currency_code
  );
  if v_exponent is null then
    raise exception 'agent_currency_minor_exponent_unknown'
      using errcode = '22023';
  end if;
  v_scaled := p_amount * pg_catalog.power(10::numeric, v_exponent);
  if pg_catalog.trunc(v_scaled) is distinct from v_scaled then
    raise exception 'agent_money_minor_units_not_exact'
      using errcode = '22023';
  end if;
  if pg_catalog.abs(v_scaled) > 9007199254740991::numeric then
    raise exception 'agent_money_minor_units_out_of_range'
      using errcode = '22003';
  end if;
  return v_scaled::bigint;
end;
$$;

\ir ../../supabase/migrations/20260829061203_agent_catalog_sources.sql
\ir ../../supabase/migrations/20260829061214_agent_catalog_reads.sql
\endif

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

-- Required proof ledger markers: runtime_requires_postgresql_17,
-- base_catalog_authority, supplier_cost_authority,
-- supplier_cost_empty_is_canonical,
-- supplier_cost_redacted_by_default, source_501_fails_closed, page_25_26,
-- keyset_has_no_duplicates, detail_child_bounds,
-- exact_money_rejects_fractional_minor, attention_is_bounded,
-- variant_nested_sources_are_bounded, proof_binding, private_acl.

do $runtime_requires_postgresql_17$
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'runtime_requires_postgresql_17';
  end if;
end;
$runtime_requires_postgresql_17$;

insert into public.companies(id, name, currency_code) values
  ('c1800000-0000-4000-8000-000000000001', 'Catalogue alpha', 'CAD'),
  ('c1800000-0000-4000-8000-000000000002', 'Catalogue bravo', 'CAD');
insert into public.users(id, company_id, first_name, last_name) values (
  'c1801000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'Ada', 'Owner'
);
insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values
  (
    'c1802000-0000-4000-8000-000000000001',
    'c1801000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000001',
    'catalog.products.view', 'all', true
  ),
  (
    'c1802000-0000-4000-8000-000000000002',
    'c1801000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000001',
    'catalog.view', 'all', true
  ),
  (
    'c1802000-0000-4000-8000-000000000003',
    'c1801000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000001',
    'finances.view', 'all', true
  );
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  'c1803000-0000-4000-8000-000000000001',
  'Catalog runtime',
  array['https://catalog-runtime.ops.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.catalog.read ops.catalog_costs.read',
  'manual',
  array['ops.catalog.read', 'ops.catalog_costs.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  'c1804000-0000-4000-8000-000000000001',
  'c1801000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'c1803000-0000-4000-8000-000000000001',
  array['ops.catalog.read', 'ops.catalog_costs.read'],
  '0123456789abcdef0123456789abcdef',
  private.mcp_oauth_labels_for_scopes(
    array['ops.catalog.read', 'ops.catalog_costs.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into public.catalog_categories(
  id, company_id, name, default_warning_threshold,
  default_critical_threshold, updated_at
) values (
  'c1810000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'Decking', 20, 5, '2026-08-22 12:00:00+00'
);
insert into public.catalog_units(
  id, company_id, display, abbreviation, dimension, updated_at
) values (
  'c1820000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'Linear foot', 'LF', 'length', '2026-08-22 12:00:00+00'
);
insert into public.catalog_items(
  id, company_id, category_id, default_unit_id, name, description, notes,
  external_id, external_source, default_price, image_url, is_active,
  updated_at
) values (
  'c1830000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'c1810000-0000-4000-8000-000000000001',
  'c1820000-0000-4000-8000-000000000001',
  'Vinyl board', 'Public board description', 'PRIVATE FAMILY NOTE',
  'PRIVATE-EXTERNAL-ID', 'PRIVATE-PROVIDER', 12.50,
  'private/storage/family.jpg', true, '2026-08-22 12:00:00+00'
);
insert into public.catalog_variants(
  id, company_id, catalog_item_id, sku, quantity, unit_id,
  warning_threshold, critical_threshold, is_active, updated_at
)
select (
         'c1840000-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       'c1800000-0000-4000-8000-000000000001'::uuid,
       'c1830000-0000-4000-8000-000000000001'::uuid,
       'VINYL-' || pg_catalog.lpad(series.value::text, 2, '0'),
       10, 'c1820000-0000-4000-8000-000000000001'::uuid,
       20, 5, true,
       '2026-08-22 12:00:00+00'::timestamptz -
         pg_catalog.make_interval(secs => series.value)
from pg_catalog.generate_series(1, 26) series(value);
insert into public.catalog_options(id, catalog_item_id, name, sort_order)
values (
  'c1850000-0000-4000-8000-000000000001',
  'c1830000-0000-4000-8000-000000000001', 'Colour', 0
);
insert into public.catalog_option_values(id, option_id, value, sort_order)
values (
  'c1860000-0000-4000-8000-000000000001',
  'c1850000-0000-4000-8000-000000000001', 'Slate', 0
);
insert into public.catalog_variant_option_values(
  id, variant_id, option_value_id
) values (
  'c1870000-0000-4000-8000-000000000001',
  'c1840000-0000-4000-8000-000000000001',
  'c1860000-0000-4000-8000-000000000001'
);
insert into public.catalog_tags(id, company_id, name) values
  (
    'c1880000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000001', 'Zeta'
  ),
  (
    'c1880000-0000-4000-8000-000000000002',
    'c1800000-0000-4000-8000-000000000001', 'Alpha'
  );
insert into public.catalog_item_tags(id, catalog_item_id, tag_id) values
  (
    'c1890000-0000-4000-8000-000000000001',
    'c1830000-0000-4000-8000-000000000001',
    'c1880000-0000-4000-8000-000000000001'
  ),
  (
    'c1890000-0000-4000-8000-000000000002',
    'c1830000-0000-4000-8000-000000000001',
    'c1880000-0000-4000-8000-000000000002'
  );
insert into public.catalog_stock_units(
  id, company_id, catalog_variant_id, unit_kind, status, quantity_value,
  location, lot_code, notes, updated_at
) values
  (
    'c18a0000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000001',
    'c1840000-0000-4000-8000-000000000001',
    'length', 'partial', 3.25, 'Yard A', 'LOT-18', 'PRIVATE STOCK NOTE',
    '2026-08-22 12:00:00+00'
  ),
  (
    'c18a0000-0000-4000-8000-000000000002',
    'c1800000-0000-4000-8000-000000000001',
    'c1840000-0000-4000-8000-000000000001',
    'length', 'partial', 6.75, 'Yard A', 'LOT-18', null,
    '2026-08-22 12:00:00+00'
  );
insert into public.catalog_supplier_cost_profiles(
  id, company_id, catalog_variant_id, profile_key, label, unit_cost,
  currency_code, is_default, activation_rule, source, created_at, updated_at
) values (
  'c18b0000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'c1840000-0000-4000-8000-000000000001',
  'PRIVATE-PROFILE-KEY', 'CanPro', 8.25, 'CAD', true,
  '{"private":"activation"}', '{"provider":"private"}',
  '2026-08-22 12:00:00+00',
  '2026-08-22 12:00:00+00'
);
insert into public.products(
  id, company_id, name, linked_catalog_item_id, is_active, updated_at
) values (
  'c18c0000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'Vinyl deck package', 'c1830000-0000-4000-8000-000000000001', true,
  '2026-08-22 12:00:00+00'
);
insert into public.product_materials(
  id, product_id, catalog_item_id, catalog_variant_id,
  quantity_per_unit, unit_id, notes, updated_at
) values (
  'c18d0000-0000-4000-8000-000000000001',
  'c18c0000-0000-4000-8000-000000000001',
  null,
  'c1840000-0000-4000-8000-000000000001',
  2.5, 'c1820000-0000-4000-8000-000000000001',
  'PRIVATE RECIPE NOTE', '2026-08-22 12:00:00+00'
);

create temporary table task18_authority (
  snapshot_revision text not null,
  base_candidates jsonb not null,
  cost_candidates jsonb not null
);
insert into task18_authority(
  snapshot_revision, base_candidates, cost_candidates
)
select authority.permission_snapshot_revision,
       '[{"variant_key":"catalog","required_oauth_scopes":["ops.catalog.read"],"resolved_permission_scopes":{"catalog.products.view":"all","catalog.view":"all"},"satisfied_permission_group_indexes":[0]}]'::jsonb,
       '[{"variant_key":"catalog","required_oauth_scopes":["ops.catalog.read"],"resolved_permission_scopes":{"catalog.products.view":"all","catalog.view":"all"},"satisfied_permission_group_indexes":[0]},{"variant_key":"supplier_costs","required_oauth_scopes":["ops.catalog_costs.read"],"resolved_permission_scopes":{"catalog.products.view":"all","finances.view":"all"},"satisfied_permission_group_indexes":[0]}]'::jsonb
from private.resolve_agent_actor_authority(
  'c1801000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  array['catalog.products.view', 'catalog.view', 'finances.view']
) authority;

create or replace function pg_temp.task18_catalog_list(
  p_snapshot_revision text,
  p_candidates jsonb,
  p_query_kind text default null,
  p_query_value text default null,
  p_item_limit integer default 25,
  p_cursor_read_at timestamptz default null,
  p_cursor_source_revisions jsonb default '[]'::jsonb,
  p_after_updated_at timestamptz default null,
  p_after_variant_id uuid default null
) returns jsonb
language sql stable set search_path = ''
as $$
  select public.read_agent_catalog_items_as_system(
    'task18-runtime-list',
    'c1800000-0000-4000-8000-000000000001',
    'c1801000-0000-4000-8000-000000000001',
    'c1804000-0000-4000-8000-000000000001',
    'c1803000-0000-4000-8000-000000000001',
    '0123456789abcdef0123456789abcdef',
    array['ops.catalog.read', 'ops.catalog_costs.read'],
    p_snapshot_revision,
    array['catalog.products.view', 'catalog.view', 'finances.view'],
    '2026-08-22.capability-manifest.v8',
    'search_catalog_items',
    'search_catalog_items:2026-08-22.v1',
    p_candidates,
    p_query_kind,
    p_query_value,
    'active',
    array['critical', 'normal', 'untracked', 'warning'],
    false,
    null,
    p_item_limit,
    p_item_limit + 1,
    501,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_updated_at,
    p_after_variant_id
  );
$$;

create or replace function pg_temp.task18_catalog_detail(
  p_snapshot_revision text,
  p_candidates jsonb,
  p_item_kind text,
  p_item_id uuid,
  p_include_supplier_costs boolean
) returns jsonb
language sql stable set search_path = ''
as $$
  select public.read_agent_catalog_item_as_system(
    'task18-runtime-detail',
    'c1800000-0000-4000-8000-000000000001',
    'c1801000-0000-4000-8000-000000000001',
    'c1804000-0000-4000-8000-000000000001',
    'c1803000-0000-4000-8000-000000000001',
    '0123456789abcdef0123456789abcdef',
    array['ops.catalog.read', 'ops.catalog_costs.read'],
    p_snapshot_revision,
    array['catalog.products.view', 'catalog.view', 'finances.view'],
    '2026-08-22.capability-manifest.v8',
    'get_catalog_item',
    'get_catalog_item:2026-08-22.v1',
    p_candidates,
    p_item_kind,
    p_item_id,
    p_include_supplier_costs,
    501, 50, 51, 32, 33, 128, 129, 64, 65, 100, 101, 64, 65
  );
$$;

do $live_double_precision_values_fail_closed$
declare
  v_invalid boolean;
begin
  perform pg_catalog.set_config('extra_float_digits', '-15', true);
  if private.agent_p2_catalog_float8_milliunits_v1(1.234::double precision)
       is distinct from 1234
     or private.agent_p2_catalog_float8_milliunits_v1(0.1::double precision)
       is distinct from 100 then
    raise exception 'ordinary_float8_milliunit_roundtrip_mismatch';
  end if;
  if private.agent_p2_catalog_float8_milliunits_v1(
       1.0000000000000002::double precision
     ) is not null then
    raise exception 'ambient_guc_float8_precision_erasure_accepted';
  end if;
  if pg_catalog.current_setting('extra_float_digits') <> '-15' then
    raise exception 'float8_helper_did_not_restore_caller_guc';
  end if;
  if private.agent_p2_catalog_float8_milliunits_v1(
       9007199254740.992::double precision
     ) is not null then
    raise exception 'float8_safe_integer_overflow_accepted';
  end if;
  if private.agent_p2_catalog_float8_milliunits_v1(
       1000000000000.0004::double precision
     ) is not null then
    raise exception 'float8_fractional_milliunit_accepted';
  end if;

  update public.catalog_variants
     set quantity = 1.0000000000000002::double precision
   where id = 'c1840000-0000-4000-8000-000000000001';
  select source.source_invalid
    into strict v_invalid
    from private.agent_p2_catalog_variant_source_v1(
      'c1800000-0000-4000-8000-000000000001',
      null, null, null,
      'c1840000-0000-4000-8000-000000000001',
      501
    ) source;
  if not v_invalid then
    raise exception 'precision_erasing_catalog_quantity_did_not_fail_closed';
  end if;

  update public.catalog_variants
     set quantity = 9007199254740.992::double precision
   where id = 'c1840000-0000-4000-8000-000000000001';
  select source.source_invalid
    into strict v_invalid
    from private.agent_p2_catalog_variant_source_v1(
      'c1800000-0000-4000-8000-000000000001',
      null, null, null,
      'c1840000-0000-4000-8000-000000000001',
      501
    ) source;
  if not v_invalid then
    raise exception 'finite_float8_safe_integer_overflow_did_not_fail_closed';
  end if;

  update public.catalog_variants
     set quantity = 10,
         warning_threshold = 1.0000000000000002::double precision
   where id = 'c1840000-0000-4000-8000-000000000001';
  select source.source_invalid
    into strict v_invalid
    from private.agent_p2_catalog_variant_source_v1(
      'c1800000-0000-4000-8000-000000000001',
      null, null, null,
      'c1840000-0000-4000-8000-000000000001',
      501
    ) source;
  if not v_invalid then
    raise exception 'finite_float8_fractional_milliunit_did_not_fail_closed';
  end if;

  update public.catalog_variants
     set quantity = 'Infinity'::double precision,
         warning_threshold = 20
   where id = 'c1840000-0000-4000-8000-000000000001';
  select source.source_invalid
    into strict v_invalid
    from private.agent_p2_catalog_variant_source_v1(
      'c1800000-0000-4000-8000-000000000001',
      null, null, null,
      'c1840000-0000-4000-8000-000000000001',
      501
    ) source;
  if not v_invalid then
    raise exception 'infinite_catalog_quantity_did_not_fail_closed';
  end if;

  update public.catalog_variants
     set quantity = 10,
         warning_threshold = 'NaN'::double precision,
         critical_threshold = '-Infinity'::double precision
   where id = 'c1840000-0000-4000-8000-000000000001';
  select source.source_invalid
    into strict v_invalid
    from private.agent_p2_catalog_variant_source_v1(
      'c1800000-0000-4000-8000-000000000001',
      null, null, null,
      'c1840000-0000-4000-8000-000000000001',
      501
    ) source;
  if not v_invalid then
    raise exception 'nonfinite_catalog_threshold_did_not_fail_closed';
  end if;

  update public.catalog_variants
     set warning_threshold = 20,
         critical_threshold = 5
   where id = 'c1840000-0000-4000-8000-000000000001';
  update public.product_materials
     set quantity_per_unit = 1.0000000000000002::double precision
   where id = 'c18d0000-0000-4000-8000-000000000001';
  begin
    perform pg_temp.task18_catalog_detail(
      (select snapshot_revision from task18_authority),
      (select base_candidates from task18_authority),
      'catalog_family',
      'c1830000-0000-4000-8000-000000000001',
      false
    );
    raise exception 'precision_erasing_recipe_quantity_accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'agent_catalog_source_data_invalid' then
        raise;
      end if;
  end;
  update public.product_materials
     set quantity_per_unit = 2.5
   where id = 'c18d0000-0000-4000-8000-000000000001';
end;
$live_double_precision_values_fail_closed$;

do $base_catalog_authority$
declare
  v_snapshot text := (select snapshot_revision from task18_authority);
  v_candidates jsonb := (select base_candidates from task18_authority);
  v_result jsonb;
  v_kind text;
  v_value text;
begin
  for v_kind, v_value in
    values
      ('family', 'Vinyl board'),
      ('sku', 'VINYL-01'),
      ('category', 'Decking'),
      ('tag', 'Alpha')
  loop
    v_result := pg_temp.task18_catalog_list(
      v_snapshot, v_candidates, v_kind, v_value
    );
    if pg_catalog.jsonb_array_length(v_result -> 'rows') = 0
       or v_result #>> '{selected_authorization_variant}' is not null
       or v_result #>> '{rows,0,selected_authorization_variant}' <> 'catalog' then
      raise exception 'base_catalog_authority';
    end if;
  end loop;
end;
$base_catalog_authority$;

do $invalid_variant_sources_fail_closed$
begin
  begin
    insert into public.catalog_option_values(id, option_id, value, sort_order)
    values (
      'c1860000-0000-4000-8000-000000000002',
      'c1850000-0000-4000-8000-000000000001',
      pg_catalog.repeat('X', 257), 1
    );
    insert into public.catalog_variant_option_values(
      id, variant_id, option_value_id
    ) values (
      'c1870000-0000-4000-8000-000000000002',
      'c1840000-0000-4000-8000-000000000002',
      'c1860000-0000-4000-8000-000000000002'
    );
    perform pg_temp.task18_catalog_list(
      (select snapshot_revision from task18_authority),
      (select base_candidates from task18_authority),
      'sku', 'VINYL-02'
    );
    raise exception 'invalid_variant_sources_fail_closed accepted option label';
  exception when invalid_parameter_value then
    null;
  end;

  begin
    update public.catalog_variants
    set updated_at = 'infinity'::timestamptz
    where id = 'c1840000-0000-4000-8000-000000000002';
    perform pg_temp.task18_catalog_list(
      (select snapshot_revision from task18_authority),
      (select base_candidates from task18_authority),
      'sku', 'VINYL-02'
    );
    raise exception 'invalid_variant_sources_fail_closed accepted timestamp';
  exception when invalid_parameter_value then
    null;
  end;
end;
$invalid_variant_sources_fail_closed$;

do $variant_nested_sources_are_bounded$
declare
  v_invalid boolean;
begin
  insert into public.catalog_tags(id, company_id, name)
  select (
           'c1882000-0000-4000-8000-' ||
             pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
         )::uuid,
         'c1800000-0000-4000-8000-000000000001'::uuid,
         'Bound tag ' || series.value
  from pg_catalog.generate_series(1, 63) series(value);
  insert into public.catalog_item_tags(id, catalog_item_id, tag_id)
  select (
           'c1892000-0000-4000-8000-' ||
             pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
         )::uuid,
         'c1830000-0000-4000-8000-000000000001'::uuid,
         (
           'c1882000-0000-4000-8000-' ||
             pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
         )::uuid
  from pg_catalog.generate_series(1, 63) series(value);

  select source.source_invalid
    into strict v_invalid
  from private.agent_p2_catalog_variant_source_v1(
    'c1800000-0000-4000-8000-000000000001',
    null, null, null,
    'c1840000-0000-4000-8000-000000000003',
    501
  ) source;
  if not v_invalid then
    raise exception 'variant_nested_sources_are_bounded accepted 65 tags';
  end if;

  delete from public.catalog_item_tags
  where id::text like 'c1892000-0000-4000-8000-%';
  delete from public.catalog_tags
  where id::text like 'c1882000-0000-4000-8000-%';

  insert into public.catalog_option_values(id, option_id, value, sort_order)
  select (
           'c1862000-0000-4000-8000-' ||
             pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
         )::uuid,
         'c1850000-0000-4000-8000-000000000001'::uuid,
         'V' || series.value,
         series.value
  from pg_catalog.generate_series(1, 129) series(value);
  insert into public.catalog_variant_option_values(
    id, variant_id, option_value_id
  )
  select (
           'c1872000-0000-4000-8000-' ||
             pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
         )::uuid,
         'c1840000-0000-4000-8000-000000000003'::uuid,
         (
           'c1862000-0000-4000-8000-' ||
             pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
         )::uuid
  from pg_catalog.generate_series(1, 129) series(value);

  select source.source_invalid
    into strict v_invalid
  from private.agent_p2_catalog_variant_source_v1(
    'c1800000-0000-4000-8000-000000000001',
    null, null, null,
    'c1840000-0000-4000-8000-000000000003',
    501
  ) source;
  if not v_invalid then
    raise exception
      'variant_nested_sources_are_bounded accepted 129 option assignments';
  end if;

  delete from public.catalog_variant_option_values
  where id::text like 'c1872000-0000-4000-8000-%';
  delete from public.catalog_option_values
  where id::text like 'c1862000-0000-4000-8000-%';
end;
$variant_nested_sources_are_bounded$;

do $supplier_cost_redacted_by_default$
declare
  v_result jsonb;
begin
  v_result := pg_temp.task18_catalog_detail(
    (select snapshot_revision from task18_authority),
    (select base_candidates from task18_authority),
    'catalog_family',
    'c1830000-0000-4000-8000-000000000001',
    false
  );
  if v_result #> '{result,supplier_costs}' is not null
     or v_result #>> '{result,family,description}' <>
          'Public board description'
     or v_result #>> '{result,family,image_state}' <> 'available'
     or v_result #> '{result,family,tags}' <> '["Alpha", "Zeta"]'::jsonb
     or v_result #>> '{result,physical_stock,0,quantity_milliunits}' <>
          '10000'
     or v_result::text like '%PRIVATE FAMILY NOTE%'
     or v_result::text like '%PRIVATE-EXTERNAL-ID%'
     or v_result::text like '%PRIVATE-PROVIDER%'
     or v_result::text like '%private/storage/family.jpg%'
     or v_result::text like '%PRIVATE STOCK NOTE%'
     or v_result::text like '%PRIVATE RECIPE NOTE%'
     or v_result::text like '%PRIVATE-PROFILE-KEY%'
     or v_result::text like '%private%activation%'
     or v_result::text like '%provider%private%' then
    raise exception 'supplier_cost_redacted_by_default';
  end if;
end;
$supplier_cost_redacted_by_default$;

do $supplier_cost_authority$
declare
  v_result jsonb;
begin
  v_result := pg_temp.task18_catalog_detail(
    (select snapshot_revision from task18_authority),
    (select cost_candidates from task18_authority),
    'catalog_variant',
    'c1840000-0000-4000-8000-000000000001',
    true
  );
  if v_result #> '{selected_authorization_variants}' <>
       '["catalog", "supplier_costs"]'::jsonb
     or v_result #>> '{result,supplier_costs,0,supplier_label}' <> 'CanPro'
     or v_result #>> '{result,supplier_costs,0,unit_cost,amount_minor}' <>
          '825'
     or v_result #>> '{result,supplier_costs,0,unit_cost,currency}' <> 'CAD'
     or v_result #>> '{result,supplier_costs,0,default}' <> 'true'
     or v_result::text like '%PRIVATE-PROFILE-KEY%'
     or v_result::text like '%private%activation%'
     or v_result::text like '%provider%private%' then
    raise exception 'supplier_cost_authority';
  end if;

  begin
    perform pg_temp.task18_catalog_detail(
      (select snapshot_revision from task18_authority),
      (select base_candidates from task18_authority),
      'catalog_variant',
      'c1840000-0000-4000-8000-000000000001',
      true
    );
    raise exception 'supplier_cost_authority accepted base-only candidate';
  exception when insufficient_privilege then
    null;
  end;
end;
$supplier_cost_authority$;

\if :{?agent_catalog_empty_supplier_costs_repaired}
do $supplier_cost_empty_is_canonical$
declare
  v_result jsonb;
begin
  v_result := pg_temp.task18_catalog_detail(
    (select snapshot_revision from task18_authority),
    (select cost_candidates from task18_authority),
    'catalog_variant',
    'c1840000-0000-4000-8000-000000000002',
    true
  );
  if v_result #> '{result,supplier_costs}' is distinct from '[]'::jsonb
     or v_result #>> '{source_inspected,supplier_costs}' <> '0'
     or v_result #> '{selected_authorization_variants}' <>
          '["catalog", "supplier_costs"]'::jsonb then
    raise exception 'supplier_cost_empty_is_canonical';
  end if;
end;
$supplier_cost_empty_is_canonical$;
\endif

do $exact_money_rejects_fractional_minor$
begin
  begin
    update public.catalog_supplier_cost_profiles
    set unit_cost = 8.251
    where id = 'c18b0000-0000-4000-8000-000000000001';
    perform pg_temp.task18_catalog_detail(
      (select snapshot_revision from task18_authority),
      (select cost_candidates from task18_authority),
      'catalog_variant',
      'c1840000-0000-4000-8000-000000000001',
      true
    );
    raise exception 'exact_money_rejects_fractional_minor accepted';
  exception when invalid_parameter_value then
    null;
  end;
end;
$exact_money_rejects_fractional_minor$;

do $page_25_26$
declare
  v_first jsonb;
  v_second jsonb;
  v_predecessor jsonb;
begin
  v_first := pg_temp.task18_catalog_list(
    (select snapshot_revision from task18_authority),
    (select base_candidates from task18_authority)
  );
  if pg_catalog.jsonb_array_length(v_first -> 'rows') <> 25
     or v_first ->> 'source_has_more' <> 'true'
     or v_first ->> 'source_inspected' <> '26' then
    raise exception 'page_25_26';
  end if;
  v_predecessor := v_first #> '{rows,24,predecessor}';
  v_second := pg_temp.task18_catalog_list(
    (select snapshot_revision from task18_authority),
    (select base_candidates from task18_authority),
    null,
    null,
    25,
    (v_first ->> 'read_at')::timestamptz,
    v_first -> 'source_revisions',
    (v_predecessor #>> '{order,0}')::timestamptz,
    (v_predecessor #>> '{order,1}')::uuid
  );
  if pg_catalog.jsonb_array_length(v_second -> 'rows') <> 1
     or v_second ->> 'source_has_more' <> 'false'
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_first -> 'rows') first_row(value)
       join pg_catalog.jsonb_array_elements(v_second -> 'rows') second_row(value)
         on first_row.value #>> '{item,variant_ref,id}' =
              second_row.value #>> '{item,variant_ref,id}'
     ) then
    raise exception 'keyset_has_no_duplicates';
  end if;
end;
$page_25_26$;

do $proof_binding$
declare
  v_family jsonb;
  v_sku jsonb;
begin
  v_family := pg_temp.task18_catalog_list(
    (select snapshot_revision from task18_authority),
    (select base_candidates from task18_authority),
    'family', 'Vinyl board'
  );
  v_sku := pg_temp.task18_catalog_list(
    (select snapshot_revision from task18_authority),
    (select base_candidates from task18_authority),
    'sku', 'VINYL-01'
  );
  if v_family ->> 'collection_proof_ref' !~ '^ops_proof:v1:[0-9a-f]{64}$'
     or v_family #>> '{rows,0,evidence_ref}' !~
          '^ops_evidence:v1:[0-9a-f]{64}$'
     or v_family ->> 'collection_proof_ref' =
          v_sku ->> 'collection_proof_ref'
     or v_family #> '{query,query}' <>
          '{"kind":"family","value":"Vinyl board"}'::jsonb then
    raise exception 'proof_binding';
  end if;
end;
$proof_binding$;

do $attention_is_bounded$
declare
  v_result jsonb;
begin
  v_result := private.agent_p2_catalog_attention_v1(
    'c1801000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000001',
    'c1804000-0000-4000-8000-000000000001',
    'c1803000-0000-4000-8000-000000000001',
    '0123456789abcdef0123456789abcdef',
    array['ops.catalog.read', 'ops.catalog_costs.read'],
    (select snapshot_revision from task18_authority),
    array['catalog.products.view', 'catalog.view', 'finances.view'],
    (select base_candidates from task18_authority),
    false,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    25, 26, 501
  );
  if pg_catalog.jsonb_array_length(v_result -> 'items') <> 25
     or v_result ->> 'has_more' <> 'true'
     or v_result::text like '%supplier_costs%' then
    raise exception 'attention_is_bounded';
  end if;

  begin
    insert into public.catalog_supplier_cost_profiles(
      id, company_id, catalog_variant_id, profile_key, label, unit_cost,
      currency_code, is_default, created_at, updated_at
    )
    select (
             'c18b1000-0000-4000-8000-' ||
               pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
           )::uuid,
           'c1800000-0000-4000-8000-000000000001'::uuid,
           'c1840000-0000-4000-8000-000000000001'::uuid,
           'attention-' || series.value,
           'Supplier ' || series.value,
           8.25, 'CAD', false,
           '2026-08-22 12:00:00+00'::timestamptz,
           '2026-08-22 12:00:00+00'::timestamptz
    from pg_catalog.generate_series(1, 64) series(value);
    perform private.agent_p2_catalog_attention_v1(
      'c1801000-0000-4000-8000-000000000001',
      'c1800000-0000-4000-8000-000000000001',
      'c1804000-0000-4000-8000-000000000001',
      'c1803000-0000-4000-8000-000000000001',
      '0123456789abcdef0123456789abcdef',
      array['ops.catalog.read', 'ops.catalog_costs.read'],
      (select snapshot_revision from task18_authority),
      array['catalog.products.view', 'catalog.view', 'finances.view'],
      (select cost_candidates from task18_authority),
      true,
      pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
      25, 26, 501
    );
    raise exception 'attention_is_bounded accepted 65 supplier costs';
  exception when program_limit_exceeded then
    null;
  end;
end;
$attention_is_bounded$;

insert into public.catalog_items(
  id, company_id, category_id, default_unit_id, name, is_active, updated_at
) values (
  'c1830000-0000-4000-8000-000000000002',
  'c1800000-0000-4000-8000-000000000001',
  'c1810000-0000-4000-8000-000000000001',
  'c1820000-0000-4000-8000-000000000001',
  'Bounded family', true, '2026-08-21 12:00:00+00'
);
insert into public.catalog_variants(
  id, company_id, catalog_item_id, sku, quantity, unit_id,
  warning_threshold, critical_threshold, is_active, updated_at
)
select (
         'c18e0000-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       'c1800000-0000-4000-8000-000000000001'::uuid,
       'c1830000-0000-4000-8000-000000000002'::uuid,
       'BOUND-' || series.value,
       100, 'c1820000-0000-4000-8000-000000000001'::uuid,
       20, 5, true, '2026-08-21 12:00:00+00'::timestamptz
from pg_catalog.generate_series(1, 51) series(value);

do $detail_child_bounds$
begin
  begin
    perform pg_temp.task18_catalog_detail(
      (select snapshot_revision from task18_authority),
      (select base_candidates from task18_authority),
      'catalog_family',
      'c1830000-0000-4000-8000-000000000002',
      false
    );
    raise exception 'detail_child_bounds accepted 51 variants';
  exception when program_limit_exceeded then
    null;
  end;
end;
$detail_child_bounds$;

insert into public.catalog_items(
  id, company_id, category_id, default_unit_id, name, is_active, updated_at
) values (
  'c1830000-0000-4000-8000-000000000003',
  'c1800000-0000-4000-8000-000000000001',
  'c1810000-0000-4000-8000-000000000001',
  'c1820000-0000-4000-8000-000000000001',
  'Source bound family', true, '2026-08-20 12:00:00+00'
);
with needed as materialized (
  select 501 - pg_catalog.count(*)::integer as value
  from public.catalog_variants variant
  where variant.company_id = 'c1800000-0000-4000-8000-000000000001'
    and variant.deleted_at is null
)
insert into public.catalog_variants(
  id, company_id, catalog_item_id, sku, quantity, unit_id,
  warning_threshold, critical_threshold, is_active, updated_at
)
select (
         'c18f0000-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       'c1800000-0000-4000-8000-000000000001'::uuid,
       'c1830000-0000-4000-8000-000000000003'::uuid,
       'SOURCE-' || series.value,
       100, 'c1820000-0000-4000-8000-000000000001'::uuid,
       20, 5, true, '2026-08-20 12:00:00+00'::timestamptz
from needed
cross join lateral pg_catalog.generate_series(1, needed.value) series(value);

do $source_501_fails_closed$
begin
  begin
    perform pg_temp.task18_catalog_list(
      (select snapshot_revision from task18_authority),
      (select base_candidates from task18_authority)
    );
    raise exception 'source_501_fails_closed accepted';
  exception when program_limit_exceeded then
    null;
  end;
end;
$source_501_fails_closed$;

do $private_acl$
begin
  if pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_catalog_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.read_agent_catalog_items_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_catalog_items_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
       'EXECUTE'
     ) then
    raise exception 'private_acl';
  end if;
end;
$private_acl$;

rollback;
