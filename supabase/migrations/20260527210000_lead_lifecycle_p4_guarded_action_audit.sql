-- Lead Lifecycle P4 guarded action audit.
--
-- Additive only. This records reviewed archive/lost/reactivation execution
-- attempts without changing historical opportunity data.

create table if not exists public.opportunity_lifecycle_action_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  opportunity_id uuid not null,
  action text not null check (
    action in (
      'archive_after_two_unanswered_followups',
      'archive_no_meaningful_correspondence',
      'move_to_lost_operator_no_response',
      'reactivate_on_related_inbound'
    )
  ),
  approved_action_key text,
  execution_mode text not null check (execution_mode in ('dry-run', 'apply')),
  status text not null check (status in ('skipped', 'applied', 'failed')),
  guard_reason text,
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  decision_reason text,
  decision_evidence jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  run_id text,
  created_at timestamptz not null default now()
);

create index if not exists opportunity_lifecycle_action_audit_opportunity_idx
  on public.opportunity_lifecycle_action_audit (opportunity_id, created_at desc);

create index if not exists opportunity_lifecycle_action_audit_company_action_idx
  on public.opportunity_lifecycle_action_audit (company_id, action, status, created_at desc);

create unique index if not exists opportunity_lifecycle_action_audit_applied_action_uidx
  on public.opportunity_lifecycle_action_audit (
    company_id,
    opportunity_id,
    action,
    approved_action_key
  )
  where status = 'applied' and approved_action_key is not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.opportunity_lifecycle_action_audit'::regclass
       and conname = 'opportunity_lifecycle_action_audit_company_fkey'
  ) then
    alter table public.opportunity_lifecycle_action_audit
      add constraint opportunity_lifecycle_action_audit_company_fkey
      foreign key (company_id)
      references public.companies(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.opportunity_lifecycle_action_audit'::regclass
       and conname = 'opportunity_lifecycle_action_audit_opportunity_company_fkey'
  ) then
    alter table public.opportunity_lifecycle_action_audit
      add constraint opportunity_lifecycle_action_audit_opportunity_company_fkey
      foreign key (company_id, opportunity_id)
      references public.opportunities(company_id, id)
      on delete cascade;
  end if;
end;
$$;

alter table public.opportunity_lifecycle_action_audit enable row level security;

drop policy if exists opportunity_lifecycle_action_audit_company_select
  on public.opportunity_lifecycle_action_audit;

create policy opportunity_lifecycle_action_audit_company_select
  on public.opportunity_lifecycle_action_audit
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));
