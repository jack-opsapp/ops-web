begin;

alter table public.activities
  add column if not exists provider_mutations_disabled boolean
    not null default false;

comment on column public.activities.provider_mutations_disabled is
  'Durable fence proving this activity was persisted under a no-provider-mutation ingestion policy.';

-- Exact-message recovery is allowed to reuse the canonical personal-mailbox
-- assignment RPC, but that assignment event must never cascade into the
-- provider-draft queue. A BEFORE INSERT guard covers both queue producers:
-- assignment-event inserts and later inbound-activity inserts.
create or replace function private.suppress_email_recovery_provider_draft_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment_provider_mutations_disabled boolean := false;
  v_activity_provider_mutations_disabled boolean := false;
begin
  select coalesce((
    select lower(
      coalesce(assignment_event.metadata ->> 'provider_mutations_disabled', 'false')
    ) in ('true', 't', '1', 'yes')
    from public.opportunity_assignment_events assignment_event
    where assignment_event.id = new.assignment_event_id
  ), false)
  into v_assignment_provider_mutations_disabled;

  select coalesce((
    select coalesce(activity.provider_mutations_disabled, false)
    from public.activities activity
    where activity.id = new.source_activity_id
  ), false)
  into v_activity_provider_mutations_disabled;

  if v_assignment_provider_mutations_disabled
     or v_activity_provider_mutations_disabled then
    return null;
  end if;

  return new;
end;
$function$;

revoke all on function private.suppress_email_recovery_provider_draft_queue()
  from public, anon, authenticated, service_role;

drop trigger if exists suppress_email_recovery_provider_draft_queue
  on public.email_assignment_contact_form_draft_queue;
create trigger suppress_email_recovery_provider_draft_queue
before insert on public.email_assignment_contact_form_draft_queue
for each row
execute function private.suppress_email_recovery_provider_draft_queue();

commit;
