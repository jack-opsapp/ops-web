-- Canonical growth milestones come from business records. Client analytics
-- events remain diagnostic and cannot create or remove funnel membership.

begin;

create or replace view public.growth_company_milestones
with (security_invoker = true) as
with first_project as (
  select p.company_id, min(p.created_at) as first_project_at
  from public.projects p
  where p.deleted_at is null
  group by p.company_id
), first_task_completion_event as (
  select e.company_id, min(e.created_at) as completed_at
  from public.task_mutation_events e
  where e.event_type = 'task_completed'
  group by e.company_id
), first_task_completion_fallback as (
  select t.company_id, min(t.updated_at) as completed_at
  from public.project_tasks t
  where t.deleted_at is null
    and t.status = 'completed'
  group by t.company_id
), first_task_completion as (
  select
    companies.company_id,
    coalesce(events.completed_at, fallback.completed_at) as completed_at,
    case when events.completed_at is null and fallback.completed_at is not null
      then 'current_record_fallback'
      when events.completed_at is not null then 'task_mutation_event'
      else null
    end as evidence
  from (
    select company_id from first_task_completion_event
    union
    select company_id from first_task_completion_fallback
  ) companies
  left join first_task_completion_event events
    on events.company_id = companies.company_id
  left join first_task_completion_fallback fallback
    on fallback.company_id = companies.company_id
), first_active_project_event as (
  select o.company_id, min(o.requested_at) as activated_at
  from public.project_status_lifecycle_outbox o
  where o.new_status in ('accepted', 'in_progress', 'completed', 'closed')
  group by o.company_id
), first_active_project_fallback as (
  select p.company_id, min(p.updated_at) as activated_at
  from public.projects p
  where p.deleted_at is null
    and p.status in ('accepted', 'in_progress', 'completed', 'closed')
  group by p.company_id
), first_active_project as (
  select
    companies.company_id,
    coalesce(events.activated_at, fallback.activated_at) as activated_at,
    case when events.activated_at is null and fallback.activated_at is not null
      then 'current_record_fallback'
      when events.activated_at is not null then 'project_status_event'
      else null
    end as evidence
  from (
    select company_id from first_active_project_event
    union
    select company_id from first_active_project_fallback
  ) companies
  left join first_active_project_event events
    on events.company_id = companies.company_id
  left join first_active_project_fallback fallback
    on fallback.company_id = companies.company_id
), first_value_candidate as (
  select
    c.id as company_id,
    c.trial_start_date as trial_started_at,
    task.completed_at as first_task_completed_at,
    task.evidence as task_evidence,
    project.activated_at as first_active_project_at,
    project.evidence as project_evidence
  from public.companies c
  left join first_task_completion task on task.company_id = c.id
  left join first_active_project project on project.company_id = c.id
  where c.deleted_at is null
    and c.trial_start_date is not null
), first_paid as (
  select
    b.company_id,
    min(b.occurred_at) as first_paid_at,
    sum(b.amount_cents) filter (where b.amount_cents > 0) as revenue_cents
  from public.billing_events b
  where b.company_id is not null
    and b.event_type = 'invoice.paid'
    and b.amount_cents > 0
  group by b.company_id
)
select
  candidate.company_id,
  candidate.trial_started_at,
  coalesce(attribution.attributed_channel, 'unknown') as canonical_channel,
  coalesce(attribution.attribution_basis, 'unknown') as attribution_basis,
  attribution.attribution_confidence,
  first_project.first_project_at,
  case
    when candidate.first_task_completed_at >= candidate.trial_started_at
      and candidate.first_task_completed_at
        < candidate.trial_started_at + interval '14 days'
      and candidate.first_active_project_at >= candidate.trial_started_at
      and candidate.first_active_project_at
        < candidate.trial_started_at + interval '14 days'
      then least(
        candidate.first_task_completed_at,
        candidate.first_active_project_at
      )
    when candidate.first_task_completed_at >= candidate.trial_started_at
      and candidate.first_task_completed_at
        < candidate.trial_started_at + interval '14 days'
      then candidate.first_task_completed_at
    when candidate.first_active_project_at >= candidate.trial_started_at
      and candidate.first_active_project_at
        < candidate.trial_started_at + interval '14 days'
      then candidate.first_active_project_at
    else null
  end as first_value_at,
  case
    when candidate.first_task_completed_at >= candidate.trial_started_at
      and candidate.first_task_completed_at
        < candidate.trial_started_at + interval '14 days'
      and (
        candidate.first_active_project_at is null
        or candidate.first_active_project_at < candidate.trial_started_at
        or candidate.first_active_project_at
          >= candidate.trial_started_at + interval '14 days'
        or candidate.first_task_completed_at <= candidate.first_active_project_at
      ) then 'completed_task'
    when candidate.first_active_project_at >= candidate.trial_started_at
      and candidate.first_active_project_at
        < candidate.trial_started_at + interval '14 days'
      then 'active_project'
    else null
  end as first_value_kind,
  case
    when candidate.first_task_completed_at >= candidate.trial_started_at
      and candidate.first_task_completed_at
        < candidate.trial_started_at + interval '14 days'
      and (
        candidate.first_active_project_at is null
        or candidate.first_active_project_at < candidate.trial_started_at
        or candidate.first_active_project_at
          >= candidate.trial_started_at + interval '14 days'
        or candidate.first_task_completed_at <= candidate.first_active_project_at
      ) then candidate.task_evidence
    when candidate.first_active_project_at >= candidate.trial_started_at
      and candidate.first_active_project_at
        < candidate.trial_started_at + interval '14 days'
      then candidate.project_evidence
    else null
  end as first_value_evidence,
  paid.first_paid_at,
  coalesce(paid.revenue_cents, 0)::bigint as revenue_cents
from first_value_candidate candidate
left join public.trial_attributions attribution
  on attribution.company_id = candidate.company_id
left join first_project on first_project.company_id = candidate.company_id
left join first_paid paid on paid.company_id = candidate.company_id;

create or replace view public.growth_funnel_daily
with (security_invoker = true) as
select
  milestone.trial_started_at::date as reporting_date,
  'trial_start_cohort'::text as grain,
  count(*)::bigint as trials_started,
  count(*) filter (
    where milestone.canonical_channel <> 'unknown'
      and milestone.attribution_basis <> 'unknown'
  )::bigint as classified_trials,
  count(*) filter (
    where milestone.first_project_at is not null
  )::bigint as first_project_companies,
  count(*) filter (
    where milestone.first_paid_at is not null
  )::bigint as paid_companies,
  count(*) filter (
    where milestone.first_value_at is not null
  )::bigint as first_value_companies,
  coalesce(sum(milestone.revenue_cents), 0)::bigint as revenue_cents
from public.growth_company_milestones milestone
group by milestone.trial_started_at::date;

create or replace view public.growth_channel_performance
with (security_invoker = true) as
select
  milestone.trial_started_at::date as reporting_date,
  'trial_start_cohort'::text as grain,
  milestone.canonical_channel,
  milestone.attribution_basis,
  count(*)::bigint as trials_started,
  count(*) filter (
    where milestone.first_project_at is not null
  )::bigint as first_project_companies,
  count(*) filter (
    where milestone.first_paid_at is not null
  )::bigint as paid_companies,
  coalesce(sum(milestone.revenue_cents), 0)::bigint as revenue_cents,
  count(*) filter (
    where milestone.first_value_at is not null
  )::bigint as first_value_companies
from public.growth_company_milestones milestone
group by
  milestone.trial_started_at::date,
  milestone.canonical_channel,
  milestone.attribution_basis;

create or replace view public.growth_attribution_coverage
with (security_invoker = true) as
select
  milestone.trial_started_at::date as reporting_date,
  count(*)::bigint as total_trials,
  count(*) filter (
    where milestone.attribution_basis in (
      'verified_click_id',
      'deterministic_first_party',
      'utm_referrer',
      'app_store'
    )
  )::bigint as deterministic_trials,
  count(*) filter (
    where milestone.attribution_basis = 'self_reported'
  )::bigint as self_reported_trials,
  count(*) filter (
    where milestone.attribution_basis = 'direct'
  )::bigint as direct_trials,
  count(*) filter (
    where milestone.attribution_basis = 'unknown'
  )::bigint as unknown_trials,
  round(
    count(*) filter (
      where milestone.attribution_basis <> 'unknown'
    )::numeric / nullif(count(*), 0),
    4
  ) as coverage_ratio
from public.growth_company_milestones milestone
group by milestone.trial_started_at::date;

revoke all on table public.growth_company_milestones
  from public, anon, authenticated;
revoke all on table public.growth_funnel_daily
  from public, anon, authenticated;
revoke all on table public.growth_channel_performance
  from public, anon, authenticated;
revoke all on table public.growth_attribution_coverage
  from public, anon, authenticated;

grant select on table public.growth_company_milestones to service_role;
grant select on table public.growth_funnel_daily to service_role;
grant select on table public.growth_channel_performance to service_role;
grant select on table public.growth_attribution_coverage to service_role;

commit;
