begin;

-- Phase C schedule optimization and invoice intelligence have always read
-- company-scoped JSON settings from public.companies. The application shipped
-- those reads before the backing columns, so every enabled company currently
-- fails before its automation can evaluate the default policy.
alter table public.companies
  add column if not exists schedule_settings jsonb not null default $json$
  {
    "enabled": true,
    "optimization_window_days": 2,
    "travel_optimization": true,
    "conflict_detection": true,
    "weather_awareness": true,
    "climate_zone": "auto",
    "cascade_detection": true,
    "outdoor_task_type_ids": []
  }
  $json$::jsonb,
  add column if not exists invoice_settings jsonb not null default $json$
  {
    "default_payment_terms": "NET-30",
    "default_tax_rate": 0,
    "auto_suggest_on_completion": true,
    "auto_suggest_from_estimate": true,
    "high_value_threshold": 5000,
    "include_cover_email": true,
    "financial_intelligence": {
      "enabled": true,
      "overdue_pct_threshold": 30,
      "concentration_pct_threshold": 40,
      "aging_days_threshold": 60,
      "aging_min_count": 3,
      "win_rate_increase_threshold": 80,
      "win_rate_decrease_threshold": 40,
      "min_estimates_for_analysis": 5
    }
  }
  $json$::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_schedule_settings_object_check'
  ) then
    alter table public.companies
      add constraint companies_schedule_settings_object_check
      check (jsonb_typeof(schedule_settings) = 'object');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_invoice_settings_object_check'
  ) then
    alter table public.companies
      add constraint companies_invoice_settings_object_check
      check (jsonb_typeof(invoice_settings) = 'object');
  end if;
end
$$;

comment on column public.companies.schedule_settings is
  'Company-scoped Phase C schedule optimization policy.';
comment on column public.companies.invoice_settings is
  'Company-scoped invoice automation policy with nested financial intelligence thresholds.';

-- Invoice automation and financial intelligence share one JSON document but
-- are edited by separate settings surfaces. Merge inside PostgreSQL so two
-- concurrent section saves cannot erase one another between a client read and
-- update. The server route validates the patch before invoking this function.
create or replace function public.merge_company_invoice_settings(
  p_company_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if p_company_id is null then
    raise exception 'merge_company_invoice_settings: company_id is required';
  end if;

  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'merge_company_invoice_settings: patch must be a json object';
  end if;

  update public.companies
  set invoice_settings =
    pg_catalog.coalesce(invoice_settings, '{}'::jsonb)
    || (p_patch - 'financial_intelligence')
    || case
      when p_patch ? 'financial_intelligence' then pg_catalog.jsonb_build_object(
        'financial_intelligence',
        pg_catalog.coalesce(invoice_settings -> 'financial_intelligence', '{}'::jsonb)
        || pg_catalog.coalesce(p_patch -> 'financial_intelligence', '{}'::jsonb)
      )
      else '{}'::jsonb
    end
  where id = p_company_id
  returning invoice_settings into v_settings;

  if not found then
    raise exception 'merge_company_invoice_settings: company not found';
  end if;

  return v_settings;
end;
$$;

revoke all on function public.merge_company_invoice_settings(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_company_invoice_settings(uuid, jsonb)
  to service_role;

comment on function public.merge_company_invoice_settings(uuid, jsonb) is
  'Atomically merges a validated service-role patch into companies.invoice_settings.';

commit;
