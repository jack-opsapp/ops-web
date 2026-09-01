\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.companies (
  id uuid primary key,
  deleted_at timestamptz,
  trial_start_date timestamptz
);
create table public.projects (
  id uuid primary key,
  company_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  status text
);
create table public.task_mutation_events (
  company_id uuid not null,
  event_type text not null,
  created_at timestamptz not null
);
create table public.project_tasks (
  company_id uuid not null,
  status text not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);
create table public.project_status_lifecycle_outbox (
  company_id uuid not null,
  new_status text not null,
  requested_at timestamptz not null
);
create table public.billing_events (
  company_id uuid,
  event_type text not null,
  amount_cents bigint,
  occurred_at timestamptz not null
);
create table public.trial_attributions (
  company_id uuid primary key,
  attributed_channel text,
  attribution_basis text,
  attribution_confidence numeric
);

-- Reproduce the production upgrade path: the foundation migration already
-- owns these view contracts before the canonical milestone migration replaces
-- their queries. PostgreSQL only permits CREATE OR REPLACE VIEW to append new
-- columns, so every existing column must retain its ordinal position.
create view public.growth_funnel_daily as
select
  null::date as reporting_date,
  null::text as grain,
  null::bigint as trials_started,
  null::bigint as classified_trials,
  null::bigint as first_project_companies,
  null::bigint as paid_companies
where false;

create view public.growth_channel_performance as
select
  null::date as reporting_date,
  null::text as grain,
  null::text as canonical_channel,
  null::text as attribution_basis,
  null::bigint as trials_started,
  null::bigint as first_project_companies,
  null::bigint as paid_companies,
  null::bigint as revenue_cents
where false;

\ir ../../supabase/migrations/20260831050000_canonical_growth_milestones.sql
\ir ../../supabase/migrations/20260831050000_canonical_growth_milestones.sql

insert into public.companies (id, trial_start_date) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-01T00:00:00Z'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-08-01T00:00:00Z'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2026-08-01T00:00:00Z');

insert into public.trial_attributions (
  company_id,
  attributed_channel,
  attribution_basis,
  attribution_confidence
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'organic_search', 'utm_referrer', 0.9),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'direct', 'direct', 1),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'unknown', 'unknown', null);

insert into public.projects (
  id,
  company_id,
  created_at,
  updated_at,
  status
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '2026-08-03T00:00:00Z',
    '2026-08-03T00:00:00Z',
    'accepted'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2026-08-09T00:00:00Z',
    '2026-08-09T00:00:00Z',
    'draft'
  );

insert into public.task_mutation_events (
  company_id,
  event_type,
  created_at
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'task_completed',
    '2026-08-05T00:00:00Z'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'task_completed',
    '2026-08-04T00:00:00Z'
  );

insert into public.billing_events (
  company_id,
  event_type,
  amount_cents,
  occurred_at
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'invoice.paid',
  4900,
  '2026-08-10T00:00:00Z'
);

do $assert_milestones$
declare
  v_row record;
begin
  select * into v_row
  from public.growth_funnel_daily
  where reporting_date = '2026-08-01';

  if v_row.trials_started <> 3 then
    raise exception 'trial count did not reconcile';
  end if;
  if v_row.first_project_companies <> 2 then
    raise exception 'first-project count did not reconcile';
  end if;
  if v_row.activated_companies <> 1 then
    raise exception 'seven-day activation boundary did not reconcile';
  end if;
  if v_row.first_value_companies <> 2 then
    raise exception 'fourteen-day first-value boundary did not reconcile';
  end if;
  if v_row.paid_companies <> 1 or v_row.revenue_cents <> 4900 then
    raise exception 'paid or revenue totals did not reconcile';
  end if;
  if (
    select count(*)
    from public.growth_company_milestones
    where activated_at is not null
  ) <> 1 then
    raise exception 'company activation milestone did not reconcile';
  end if;
end
$assert_milestones$;
