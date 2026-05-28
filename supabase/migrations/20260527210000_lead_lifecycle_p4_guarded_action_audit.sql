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
  error_code text,
  error_message text,
  runner text,
  created_at timestamptz not null default now()
);

alter table public.opportunity_lifecycle_action_audit
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists runner text;

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

create or replace function public.execute_opportunity_lifecycle_guarded_action(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_action text,
  p_approved_action_key text,
  p_expected_stage text,
  p_expected_archived_at timestamptz,
  p_expected_deleted_at timestamptz,
  p_expected_project_id uuid,
  p_expected_project_ref uuid,
  p_before_values jsonb,
  p_after_values jsonb,
  p_decision_reason text default null,
  p_decision_evidence jsonb default '{}'::jsonb,
  p_approved_by text default null,
  p_approved_at timestamptz default null,
  p_run_id text default null,
  p_runner text default 'ops-web'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opportunity public.opportunities%rowtype;
  v_allowed_keys text[];
  v_key_count integer;
  v_audit_id uuid;
  v_updated_id uuid;
  v_archived_at timestamptz;
  v_actual_close_date date;
  v_before_values jsonb;
  v_after_values jsonb;
  v_expected_before_values jsonb;
  v_expected_after_values jsonb;
  v_lost_notes text :=
    'Guarded lifecycle approval: customer inbound went unanswered past the no-response window.';
  v_stage text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and p_company_id is distinct from (select private.get_user_company_id())
  then
    raise exception 'company scope mismatch'
      using errcode = '42501';
  end if;

  if p_approved_action_key is null or btrim(p_approved_action_key) = '' then
    raise exception 'approved action key is required'
      using errcode = '22023';
  end if;

  if p_action not in (
    'archive_after_two_unanswered_followups',
    'archive_no_meaningful_correspondence',
    'move_to_lost_operator_no_response',
    'reactivate_on_related_inbound'
  ) then
    raise exception 'unsupported guarded action: %', p_action
      using errcode = '22023';
  end if;

  if p_action in (
    'archive_after_two_unanswered_followups',
    'archive_no_meaningful_correspondence',
    'reactivate_on_related_inbound'
  ) then
    v_allowed_keys := array['archived_at'];
  else
    v_allowed_keys := array[
      'stage',
      'lost_reason',
      'lost_notes',
      'actual_close_date'
    ];
  end if;

  select count(*)
    into v_key_count
    from jsonb_object_keys(coalesce(p_before_values, '{}'::jsonb));
  if v_key_count <> array_length(v_allowed_keys, 1) then
    raise exception 'before_values keys do not match guarded action %', p_action
      using errcode = '22023';
  end if;

  select count(*)
    into v_key_count
    from jsonb_object_keys(coalesce(p_after_values, '{}'::jsonb));
  if v_key_count <> array_length(v_allowed_keys, 1) then
    raise exception 'after_values keys do not match guarded action %', p_action
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(coalesce(p_before_values, '{}'::jsonb)) as keys(key)
     where not (keys.key = any(v_allowed_keys))
  ) or exists (
    select 1
      from jsonb_object_keys(coalesce(p_after_values, '{}'::jsonb)) as keys(key)
     where not (keys.key = any(v_allowed_keys))
  ) then
    raise exception 'guarded action payload contains disallowed fields'
      using errcode = '22023';
  end if;

  select *
    into v_opportunity
    from public.opportunities
   where company_id = p_company_id
     and id = p_opportunity_id
   for update;

  if not found then
    insert into public.opportunity_lifecycle_action_audit (
      company_id,
      opportunity_id,
      action,
      approved_action_key,
      execution_mode,
      status,
      guard_reason,
      before_values,
      after_values,
      decision_reason,
      decision_evidence,
      approved_by,
      approved_at,
      run_id,
      error_code,
      error_message,
      runner
    ) values (
      p_company_id,
      p_opportunity_id,
      p_action,
      p_approved_action_key,
      'apply',
      'failed',
      'missing_opportunity_snapshot',
      '{}'::jsonb,
      '{}'::jsonb,
      p_decision_reason,
      coalesce(p_decision_evidence, '{}'::jsonb),
      p_approved_by,
      p_approved_at,
      p_run_id,
      'missing_opportunity_snapshot',
      'No opportunity matched the supplied company/action scope.',
      p_runner
    ) returning id into v_audit_id;

    return jsonb_build_object(
      'applied', false,
      'audit_id', v_audit_id,
      'guard_reason', 'missing_opportunity_snapshot',
      'error_code', 'missing_opportunity_snapshot',
      'error_message', 'No opportunity matched the supplied company/action scope.'
    );
  end if;

  v_stage := lower(btrim(coalesce(v_opportunity.stage, '')));

  if p_action in (
    'archive_after_two_unanswered_followups',
    'archive_no_meaningful_correspondence',
    'reactivate_on_related_inbound'
  ) then
    v_before_values := jsonb_build_object(
      'archived_at',
      case
        when v_opportunity.archived_at is null then null
        else to_char(
          v_opportunity.archived_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      end
    );

    v_expected_before_values := jsonb_build_object(
      'archived_at',
      case
        when p_expected_archived_at is null then null
        else to_char(
          p_expected_archived_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      end
    );
  else
    v_before_values := jsonb_build_object(
      'stage', v_opportunity.stage,
      'lost_reason', v_opportunity.lost_reason,
      'lost_notes', v_opportunity.lost_notes,
      'actual_close_date',
      case
        when v_opportunity.actual_close_date is null then null
        else to_char(v_opportunity.actual_close_date, 'YYYY-MM-DD')
      end
    );

    v_expected_before_values := jsonb_build_object(
      'stage', p_expected_stage,
      'lost_reason', p_before_values ->> 'lost_reason',
      'lost_notes', p_before_values ->> 'lost_notes',
      'actual_close_date', p_before_values ->> 'actual_close_date'
    );
  end if;

  if exists (
    select 1
      from public.opportunity_lifecycle_action_audit
     where company_id = p_company_id
       and opportunity_id = p_opportunity_id
       and action = p_action
       and approved_action_key = p_approved_action_key
       and status = 'applied'
     limit 1
  ) then
    insert into public.opportunity_lifecycle_action_audit (
      company_id,
      opportunity_id,
      action,
      approved_action_key,
      execution_mode,
      status,
      guard_reason,
      before_values,
      after_values,
      decision_reason,
      decision_evidence,
      approved_by,
      approved_at,
      run_id,
      error_code,
      error_message,
      runner
    ) values (
      p_company_id,
      p_opportunity_id,
      p_action,
      p_approved_action_key,
      'apply',
      'skipped',
      'duplicate_applied_action',
      v_before_values,
      v_before_values,
      p_decision_reason,
      coalesce(p_decision_evidence, '{}'::jsonb),
      p_approved_by,
      p_approved_at,
      p_run_id,
      'duplicate_applied_action',
      'Approved guarded action key has already been applied.',
      p_runner
    ) returning id into v_audit_id;

    return jsonb_build_object(
      'applied', false,
      'audit_id', v_audit_id,
      'guard_reason', 'duplicate_applied_action',
      'error_code', 'duplicate_applied_action',
      'error_message', 'Approved guarded action key has already been applied.'
    );
  end if;

  if v_opportunity.stage is distinct from p_expected_stage
    or v_opportunity.archived_at is distinct from p_expected_archived_at
    or v_opportunity.deleted_at is distinct from p_expected_deleted_at
    or v_opportunity.project_id is distinct from p_expected_project_id
    or v_opportunity.project_ref is distinct from p_expected_project_ref
    or v_before_values <> v_expected_before_values
    or v_before_values <> p_before_values
  then
    insert into public.opportunity_lifecycle_action_audit (
      company_id,
      opportunity_id,
      action,
      approved_action_key,
      execution_mode,
      status,
      guard_reason,
      before_values,
      after_values,
      decision_reason,
      decision_evidence,
      approved_by,
      approved_at,
      run_id,
      error_code,
      error_message,
      runner
    ) values (
      p_company_id,
      p_opportunity_id,
      p_action,
      p_approved_action_key,
      'apply',
      'skipped',
      'snapshot_mismatch',
      v_before_values,
      v_before_values,
      p_decision_reason,
      coalesce(p_decision_evidence, '{}'::jsonb),
      p_approved_by,
      p_approved_at,
      p_run_id,
      'snapshot_mismatch',
      'Live opportunity guard/audit fields no longer match the approved snapshot.',
      p_runner
    ) returning id into v_audit_id;

    return jsonb_build_object(
      'applied', false,
      'audit_id', v_audit_id,
      'guard_reason', 'snapshot_mismatch',
      'error_code', 'snapshot_mismatch',
      'error_message', 'Live opportunity guard/audit fields no longer match the approved snapshot.'
    );
  end if;

  if v_stage in (
    'won',
    'lost',
    'discarded',
    'deleted',
    'converted',
    'merged',
    'disqualified'
  ) or v_opportunity.deleted_at is not null
    or v_opportunity.project_id is not null
    or v_opportunity.project_ref is not null
  then
    insert into public.opportunity_lifecycle_action_audit (
      company_id,
      opportunity_id,
      action,
      approved_action_key,
      execution_mode,
      status,
      guard_reason,
      before_values,
      after_values,
      decision_reason,
      decision_evidence,
      approved_by,
      approved_at,
      run_id,
      error_code,
      error_message,
      runner
    ) values (
      p_company_id,
      p_opportunity_id,
      p_action,
      p_approved_action_key,
      'apply',
      'skipped',
      'terminal_or_protected_stage',
      v_before_values,
      v_before_values,
      p_decision_reason,
      coalesce(p_decision_evidence, '{}'::jsonb),
      p_approved_by,
      p_approved_at,
      p_run_id,
      'terminal_or_protected_stage',
      'Opportunity failed server-side terminal/deleted/project-linked guards.',
      p_runner
    ) returning id into v_audit_id;

    return jsonb_build_object(
      'applied', false,
      'audit_id', v_audit_id,
      'guard_reason', 'terminal_or_protected_stage',
      'error_code', 'terminal_or_protected_stage',
      'error_message', 'Opportunity failed server-side terminal/deleted/project-linked guards.'
    );
  end if;

  if p_action = 'move_to_lost_operator_no_response'
    and v_stage not in ('quoting', 'quoted', 'follow_up', 'negotiation')
  then
    insert into public.opportunity_lifecycle_action_audit (
      company_id,
      opportunity_id,
      action,
      approved_action_key,
      execution_mode,
      status,
      guard_reason,
      before_values,
      after_values,
      decision_reason,
      decision_evidence,
      approved_by,
      approved_at,
      run_id,
      error_code,
      error_message,
      runner
    ) values (
      p_company_id,
      p_opportunity_id,
      p_action,
      p_approved_action_key,
      'apply',
      'skipped',
      'lost_stage_not_allowed',
      v_before_values,
      v_before_values,
      p_decision_reason,
      coalesce(p_decision_evidence, '{}'::jsonb),
      p_approved_by,
      p_approved_at,
      p_run_id,
      'lost_stage_not_allowed',
      'Operator no-response lost action is not allowed for this stage.',
      p_runner
    ) returning id into v_audit_id;

    return jsonb_build_object(
      'applied', false,
      'audit_id', v_audit_id,
      'guard_reason', 'lost_stage_not_allowed',
      'error_code', 'lost_stage_not_allowed',
      'error_message', 'Operator no-response lost action is not allowed for this stage.'
    );
  end if;

  if p_action in (
    'archive_after_two_unanswered_followups',
    'archive_no_meaningful_correspondence'
  ) then
    if v_opportunity.archived_at is not null
      or (p_before_values ->> 'archived_at') is not null
      or (p_after_values ->> 'archived_at') is null
    then
      raise exception 'archive payload failed server-side guard'
        using errcode = '22023';
    end if;
    v_archived_at := (p_after_values ->> 'archived_at')::timestamptz;
    v_after_values := jsonb_build_object(
      'archived_at',
      to_char(
        v_archived_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );
  elsif p_action = 'reactivate_on_related_inbound' then
    if v_opportunity.archived_at is null
      or (p_before_values ->> 'archived_at') is null
      or jsonb_typeof(p_after_values -> 'archived_at') <> 'null'
    then
      raise exception 'reactivation payload failed server-side guard'
        using errcode = '22023';
    end if;
    v_after_values := jsonb_build_object('archived_at', null);
  elsif p_action = 'move_to_lost_operator_no_response' then
    if p_after_values ->> 'stage' <> 'lost'
      or p_after_values ->> 'lost_reason' <> 'operator_no_response'
      or p_after_values ->> 'lost_notes' <> v_lost_notes
      or (p_after_values ->> 'actual_close_date') is null
    then
      raise exception 'lost payload failed server-side guard'
        using errcode = '22023';
    end if;
    v_actual_close_date := (p_after_values ->> 'actual_close_date')::date;
    v_after_values := jsonb_build_object(
      'stage', 'lost',
      'lost_reason', 'operator_no_response',
      'lost_notes', v_lost_notes,
      'actual_close_date', to_char(v_actual_close_date, 'YYYY-MM-DD')
    );
  end if;

  v_expected_after_values := p_after_values;
  if v_after_values <> v_expected_after_values then
    insert into public.opportunity_lifecycle_action_audit (
      company_id,
      opportunity_id,
      action,
      approved_action_key,
      execution_mode,
      status,
      guard_reason,
      before_values,
      after_values,
      decision_reason,
      decision_evidence,
      approved_by,
      approved_at,
      run_id,
      error_code,
      error_message,
      runner
    ) values (
      p_company_id,
      p_opportunity_id,
      p_action,
      p_approved_action_key,
      'apply',
      'skipped',
      'snapshot_mismatch',
      v_before_values,
      v_before_values,
      p_decision_reason,
      coalesce(p_decision_evidence, '{}'::jsonb),
      p_approved_by,
      p_approved_at,
      p_run_id,
      'snapshot_mismatch',
      'Expected guarded action mutation payload no longer matches the server-computed mutation.',
      p_runner
    ) returning id into v_audit_id;

    return jsonb_build_object(
      'applied', false,
      'audit_id', v_audit_id,
      'guard_reason', 'snapshot_mismatch',
      'error_code', 'snapshot_mismatch',
      'error_message', 'Expected guarded action mutation payload no longer matches the server-computed mutation.'
    );
  end if;

  if p_action in (
    'archive_after_two_unanswered_followups',
    'archive_no_meaningful_correspondence'
  ) then
    update public.opportunities
       set archived_at = v_archived_at
     where company_id = p_company_id
       and id = p_opportunity_id
       and archived_at is null
       and deleted_at is null
       and project_id is null
       and project_ref is null
     returning id into v_updated_id;
  elsif p_action = 'move_to_lost_operator_no_response' then
    update public.opportunities
       set stage = 'lost',
           lost_reason = 'operator_no_response',
           lost_notes = v_lost_notes,
           actual_close_date = v_actual_close_date
     where company_id = p_company_id
       and id = p_opportunity_id
       and stage = p_expected_stage
       and archived_at is null
       and deleted_at is null
       and project_id is null
       and project_ref is null
     returning id into v_updated_id;
  elsif p_action = 'reactivate_on_related_inbound' then
    update public.opportunities
       set archived_at = null
     where company_id = p_company_id
       and id = p_opportunity_id
       and archived_at = p_expected_archived_at
       and deleted_at is null
       and project_id is null
       and project_ref is null
     returning id into v_updated_id;
  end if;

  if v_updated_id is null then
    raise exception 'guarded opportunity update matched zero rows'
      using errcode = 'P0002';
  end if;

  insert into public.opportunity_lifecycle_action_audit (
    company_id,
    opportunity_id,
    action,
    approved_action_key,
    execution_mode,
    status,
    guard_reason,
    before_values,
    after_values,
    decision_reason,
    decision_evidence,
    approved_by,
    approved_at,
    run_id,
    error_code,
    error_message,
    runner
  ) values (
    p_company_id,
    p_opportunity_id,
    p_action,
    p_approved_action_key,
    'apply',
    'applied',
    null,
    v_before_values,
    v_after_values,
    p_decision_reason,
    coalesce(p_decision_evidence, '{}'::jsonb),
    p_approved_by,
    p_approved_at,
    p_run_id,
    null,
    null,
    p_runner
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'applied', true,
    'audit_id', v_audit_id,
    'opportunity_id', v_updated_id
  );
end;
$$;

revoke execute on function public.execute_opportunity_lifecycle_guarded_action(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid,
  jsonb,
  jsonb,
  text,
  jsonb,
  text,
  timestamptz,
  text,
  text
) from public;

revoke execute on function public.execute_opportunity_lifecycle_guarded_action(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid,
  jsonb,
  jsonb,
  text,
  jsonb,
  text,
  timestamptz,
  text,
  text
) from anon;

revoke execute on function public.execute_opportunity_lifecycle_guarded_action(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid,
  jsonb,
  jsonb,
  text,
  jsonb,
  text,
  timestamptz,
  text,
  text
) from authenticated;

-- Intended caller: trusted OPS server-side code using the Supabase
-- service-role key. Ordinary authenticated users must not call this
-- destructive RPC directly through PostgREST.

grant execute on function public.execute_opportunity_lifecycle_guarded_action(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid,
  jsonb,
  jsonb,
  text,
  jsonb,
  text,
  timestamptz,
  text,
  text
) to service_role;
