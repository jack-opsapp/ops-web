begin;

-- Live migration version: 20260726195234.
-- PL/pgSQL resolves composite record fields and SQL aliases in the same
-- namespace. The original helper declared a record variable named `prior`
-- and reused `prior` as a table alias, so the first claim failed before any
-- queue work could be leased. Keep the durable placement rules unchanged and
-- give the SQL alias an unambiguous name.
create or replace function private.email_assignment_contact_form_draft_prior_placement(
  p_queue_id uuid
) returns table (
  disposition text,
  prior_draft_history_id uuid,
  mailbox_draft_id text,
  provider_thread_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  queue public.email_assignment_contact_form_draft_queue%rowtype;
  prior public.email_assignment_contact_form_draft_queue%rowtype;
  active_draft public.ai_draft_history%rowtype;
  v_has_prior_completed boolean := false;
  v_active_count integer := 0;
begin
  select work.* into queue
  from public.email_assignment_contact_form_draft_queue work
  where work.id = p_queue_id;
  if not found then
    return query select 'blocked_missing_queue'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.email_assignment_contact_form_draft_queue prior_candidate
    where prior_candidate.company_id = queue.company_id
      and prior_candidate.opportunity_id = queue.opportunity_id
      and prior_candidate.id <> queue.id
      and prior_candidate.assignment_version <> queue.assignment_version
      and prior_candidate.provider_create_started_at is not null
      and prior_candidate.status <> 'completed'
  ) then
    return query select 'blocked_unresolved'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select previous.* into prior
  from public.email_assignment_contact_form_draft_queue previous
  where previous.company_id = queue.company_id
    and previous.opportunity_id = queue.opportunity_id
    and previous.id <> queue.id
    and previous.assignment_version <> queue.assignment_version
    and previous.status = 'completed'
  order by previous.assignment_version desc, previous.created_at desc, previous.id desc
  limit 1;
  v_has_prior_completed := found;

  select count(*)::integer into v_active_count
  from public.ai_draft_history draft
  where draft.company_id = queue.company_id
    and draft.connection_id = queue.connection_id
    and draft.opportunity_id = queue.opportunity_id
    and draft.origin = 'phase_c'
    and draft.status = 'auto_drafted'
    and nullif(btrim(coalesce(draft.mailbox_draft_id, '')), '') is not null
    and nullif(btrim(coalesce(draft.thread_id, '')), '') is not null;

  if v_active_count > 1 then
    return query select 'blocked_ambiguous'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_active_count = 1 then
    select draft.* into active_draft
    from public.ai_draft_history draft
    where draft.company_id = queue.company_id
      and draft.connection_id = queue.connection_id
      and draft.opportunity_id = queue.opportunity_id
      and draft.origin = 'phase_c'
      and draft.status = 'auto_drafted'
      and nullif(btrim(coalesce(draft.mailbox_draft_id, '')), '') is not null
      and nullif(btrim(coalesce(draft.thread_id, '')), '') is not null;
  end if;

  if v_has_prior_completed and (
    prior.connection_id <> queue.connection_id
    or v_active_count <> 1
    or active_draft.id <> prior.draft_history_id
    or active_draft.mailbox_draft_id <> prior.mailbox_draft_id
    or active_draft.thread_id <> prior.outreach_provider_thread_id
  ) then
    return query select
      'blocked_prior_unconfirmed'::text,
      null::uuid,
      null::text,
      null::text;
    return;
  end if;

  if v_active_count = 1 then
    return query select
      'update'::text,
      active_draft.id,
      btrim(active_draft.mailbox_draft_id),
      btrim(active_draft.thread_id);
    return;
  end if;

  return query select 'create'::text, null::uuid, null::text, null::text;
end;
$function$;

revoke all on function private.email_assignment_contact_form_draft_prior_placement(uuid)
  from public, anon, authenticated, service_role;

commit;
