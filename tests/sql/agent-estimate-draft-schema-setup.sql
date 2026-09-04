\set ON_ERROR_STOP on

-- Extends the Phase 7 proof fixture with the production columns read by the
-- Phase 8 estimate-draft snapshot. This fixture is disposable and local only.

alter table public.companies
  add column updated_at timestamptz;

alter table public.clients
  add column updated_at timestamptz;

alter table public.projects
  add column completed_at timestamptz,
  add column title text,
  add column updated_at timestamptz;

alter table public.estimates
  add column project_id uuid references public.projects(id),
  add column opportunity_id uuid,
  add column title text,
  add column estimate_number text,
  add column subtotal numeric not null default 0,
  add column tax_rate numeric,
  add column tax_amount numeric not null default 0,
  add column total numeric not null default 0,
  add column client_ref text,
  add column project_ref text,
  add column deposit_type text,
  add column deposit_value numeric,
  add column deposit_amount numeric,
  add column updated_at timestamptz;

alter table public.tax_rates
  add column is_default boolean,
  add column created_at timestamptz;

alter table public.line_items
  add column name text,
  add column description text,
  add column line_total numeric,
  add column sort_order integer,
  add column category text,
  add column type text,
  add column resolved_options_label text,
  add column parent_line_item_id uuid references public.line_items(id),
  add column product_id uuid,
  add column unit_id uuid;

create table public.opportunities (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  client_id uuid references public.clients(id),
  client_ref text,
  title text not null,
  stage text not null,
  archived_at timestamptz,
  deleted_at timestamptz,
  merged_into_opportunity_id uuid references public.opportunities(id),
  updated_at timestamptz not null default statement_timestamp()
);

insert into private.test_authority_permissions(permission)
values ('estimates.create')
on conflict (permission) do nothing;
