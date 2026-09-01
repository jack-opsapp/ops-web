begin;

-- Rollback-only executable contract for atomic external analytics lifecycle
-- evidence. Run only on a local database or explicitly approved disposable
-- branch.

set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.companies (
  id,
  bubble_id,
  name,
  subscription_status,
  subscription_plan
) values (
  'e5000000-0000-4000-8000-000000000001',
  'external-analytics-lifecycle-contract',
  'External Analytics Lifecycle Contract',
  'trial',
  'trial'
);

insert into public.users (
  id,
  bubble_id,
  company_id,
  first_name,
  last_name,
  email,
  role,
  is_company_admin,
  is_active,
  deleted_at
) values (
  'e5000000-0000-4000-8000-000000000101',
  'external-analytics-lifecycle-owner',
  'e5000000-0000-4000-8000-000000000001',
  'Lifecycle',
  'Owner',
  'lifecycle-owner@example.invalid',
  'owner',
  true,
  true,
  null
);

insert into public.clients (
  id,
  company_id,
  name,
  email,
  created_at,
  updated_at
) values (
  'e5000000-0000-4000-8000-000000000201',
  'e5000000-0000-4000-8000-000000000001',
  'Lifecycle Customer',
  'lifecycle-customer@example.invalid',
  clock_timestamp(),
  clock_timestamp()
);

insert into public.opportunities (
  id,
  company_id,
  client_id,
  client_ref,
  title,
  contact_name,
  contact_email,
  stage,
  stage_entered_at,
  source,
  created_at,
  updated_at
) values (
  'e5000000-0000-4000-8000-000000000301',
  'e5000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000201',
  'e5000000-0000-4000-8000-000000000201',
  'Lifecycle evidence lead',
  'Lifecycle Customer',
  'lifecycle-customer@example.invalid',
  'new_lead',
  clock_timestamp(),
  'website',
  clock_timestamp(),
  clock_timestamp()
);

-- atomic_stage_and_evidence: a forced failure rolls back both the business row
-- and its trigger-written lifecycle event.
do $contract$
begin
  begin
    perform public.move_opportunity_stage(
      'e5000000-0000-4000-8000-000000000301',
      'qualifying',
      null
    );
    raise exception 'forced_atomic_stage_rollback';
  exception
    when others then
      if sqlerrm <> 'forced_atomic_stage_rollback' then
        raise;
      end if;
  end;

  if (
    select opportunity.stage
    from public.opportunities opportunity
    where opportunity.id = 'e5000000-0000-4000-8000-000000000301'
  ) <> 'new_lead' then
    raise exception 'atomic_stage_and_evidence_business_row_failed';
  end if;

  if exists (
    select 1
    from private.external_lead_lifecycle_events event
    where event.opportunity_id =
      'e5000000-0000-4000-8000-000000000301'
      and event.event_kind = 'stage_changed'
  ) then
    raise exception 'atomic_stage_and_evidence_event_rollback_failed';
  end if;
end;
$contract$;

select public.move_opportunity_stage(
  'e5000000-0000-4000-8000-000000000301',
  'qualifying',
  null,
  42
);

do $contract$
begin
  if not exists (
    select 1
    from public.opportunities opportunity
    join private.external_lead_lifecycle_events event
      on event.company_id = opportunity.company_id
     and event.opportunity_id = opportunity.id
    where opportunity.id = 'e5000000-0000-4000-8000-000000000301'
      and opportunity.stage = 'qualifying'
      and opportunity.win_probability = 42
      and event.event_kind = 'stage_changed'
      and event.to_stage = 'qualifying'
  ) then
    raise exception 'atomic_stage_and_evidence_commit_failed';
  end if;
end;
$contract$;

-- A manual handled marker is not response evidence.
update public.opportunities
set handled_at = clock_timestamp(),
    updated_at = clock_timestamp()
where id = 'e5000000-0000-4000-8000-000000000301';

insert into public.email_connections (
  id,
  company_id,
  type,
  email,
  access_token,
  refresh_token,
  expires_at,
  status
) values (
  'e5000000-0000-4000-8000-000000000701',
  'e5000000-0000-4000-8000-000000000001',
  'company',
  'lifecycle-mailbox@example.invalid',
  'rollback-access-token',
  'rollback-refresh-token',
  clock_timestamp() + interval '1 day',
  'active'
);

insert into public.opportunity_correspondence_events (
  id,
  company_id,
  opportunity_id,
  connection_id,
  provider_thread_id,
  provider_message_id,
  direction,
  party_role,
  is_meaningful,
  noise_reason,
  occurred_at,
  source,
  response_definition_version,
  response_kind,
  counts_as_first_response
) values (
  'e5000000-0000-4000-8000-000000000401',
  'e5000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000301',
  'e5000000-0000-4000-8000-000000000701',
  'historical-thread',
  'historical-message',
  'outbound',
  'ops',
  true,
  null,
  clock_timestamp(),
  'gmail_historical_import',
  1,
  'unknown',
  false
);

-- historical_unknown_reduces_coverage: neither a handled marker nor uncertain
-- historical outbound mail invents first-response coverage.
do $contract$
begin
  if exists (
    select 1
    from private.external_lead_lifecycle_facts facts
    where facts.opportunity_id =
      'e5000000-0000-4000-8000-000000000301'
      and facts.first_response_at is not null
  ) then
    raise exception 'historical_unknown_reduces_coverage_failed';
  end if;
end;
$contract$;

insert into public.opportunity_correspondence_events (
  id,
  company_id,
  opportunity_id,
  connection_id,
  provider_thread_id,
  provider_message_id,
  direction,
  party_role,
  is_meaningful,
  noise_reason,
  occurred_at,
  source,
  response_definition_version,
  response_kind,
  counts_as_first_response
) values (
  'e5000000-0000-4000-8000-000000000402',
  'e5000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000301',
  'e5000000-0000-4000-8000-000000000701',
  'operator-thread',
  'operator-message',
  'outbound',
  'ops',
  true,
  null,
  clock_timestamp() + interval '1 second',
  'email_send',
  1,
  'human',
  true
);

do $contract$
begin
  if not exists (
    select 1
    from private.external_lead_lifecycle_facts facts
    where facts.opportunity_id =
      'e5000000-0000-4000-8000-000000000301'
      and facts.first_response_event_id =
        'e5000000-0000-4000-8000-000000000402'
      and facts.first_response_definition_version = 1
      and facts.first_response_kind = 'human'
  ) then
    raise exception 'versioned_first_response_failed';
  end if;
end;
$contract$;

select public.move_opportunity_stage(
  'e5000000-0000-4000-8000-000000000301',
  'won',
  null
);

insert into public.projects (
  id,
  company_id,
  client_id,
  opportunity_id,
  title,
  status,
  created_at,
  updated_at
) values (
  'e5000000-0000-4000-8000-000000000501',
  'e5000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000201',
  'e5000000-0000-4000-8000-000000000301',
  'Lifecycle project',
  'in_progress',
  clock_timestamp(),
  clock_timestamp()
);

update public.opportunities
set project_ref = 'e5000000-0000-4000-8000-000000000501',
    project_id = 'e5000000-0000-4000-8000-000000000501',
    updated_at = clock_timestamp()
where id = 'e5000000-0000-4000-8000-000000000301';

-- conversion_is_distinct_from_win: winning and project conversion are separate
-- facts even when the canonical conversion command performs both atomically.
do $contract$
begin
  if not exists (
    select 1
    from private.external_lead_lifecycle_events event
    where event.opportunity_id =
      'e5000000-0000-4000-8000-000000000301'
      and event.event_kind = 'won'
  ) or not exists (
    select 1
    from private.external_lead_lifecycle_events event
    where event.opportunity_id =
      'e5000000-0000-4000-8000-000000000301'
      and event.event_kind = 'converted'
      and event.project_id =
        'e5000000-0000-4000-8000-000000000501'
  ) then
    raise exception 'conversion_is_distinct_from_win_failed';
  end if;
end;
$contract$;

select public.mutate_opportunity_lifecycle(
  'e5000000-0000-4000-8000-000000000301',
  'archive',
  null,
  'e5000000-0000-4000-8000-000000000001'
);

do $contract$
begin
  if not exists (
    select 1
    from public.opportunities opportunity
    join private.external_lead_lifecycle_events event
      on event.company_id = opportunity.company_id
     and event.opportunity_id = opportunity.id
    where opportunity.id = 'e5000000-0000-4000-8000-000000000301'
      and opportunity.archived_at is not null
      and event.event_kind = 'archived'
  ) then
    raise exception 'atomic_archive_and_evidence_failed';
  end if;
end;
$contract$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS';

rollback;
