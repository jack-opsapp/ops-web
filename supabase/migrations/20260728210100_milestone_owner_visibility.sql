-- Milestone owner visibility (MY LEADS day sheet).
-- Approved by Jackson 2026-07-28; reviewed staged artifact (full rationale,
-- gate analysis, and safety review):
--   ops-ios docs/migrations/2026-07-28-milestone-owner-visibility.staged.sql
--
-- When a DELEGATE (pipeline.view scope 'assigned') advances a lead through one
-- of the three day-sheet milestone pairs, full-pipeline owners get one rail
-- notification (type 'lead_stage_advanced'):
--   new_lead -> qualifying  CONTACTED
--   qualifying -> quoting   SITE VISITED
--   quoting -> quoted       QUOTE SENT
-- WON is deliberately absent (conversion has its own live delivery chain).
-- Owner actors, corrections, skips, and machine-written transitions
-- (transitioned_by IS NULL) stay silent. Fan-out follows the role_needed
-- precedent (users_with_permission 'all', same-company, active, minus actor);
-- inserts ride create_notification_if_new (dedupe 'milestone:<transition id>');
-- a notification failure warns and never rolls back the milestone.
-- Register 'lead_stage_advanced' in web notification-meta + iOS icon map in
-- the same ship (unregistered it falls back to default icons; deep link
-- already resolves via deep_link_type 'lead').

do $do$
begin
  if to_regclass('public.stage_transitions') is null
     or to_regclass('public.opportunities') is null
     or to_regclass('public.notifications') is null
     or to_regprocedure(
          'private.effective_pipeline_scope_for_user(uuid,uuid,text)'
        ) is null
     or to_regprocedure(
          'public.users_with_permission(uuid,text,text)'
        ) is null
     or to_regprocedure(
          'public.create_notification_if_new(text,text,text,text,text,boolean,text,text,text,text,text)'
        ) is null
  then
    raise exception 'milestone owner visibility prerequisites are missing';
  end if;
end
$do$;

create or replace function private.notify_delegate_milestone_advance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_verb text;
  v_actor_scope text;
  v_opportunity record;
  v_recipient record;
  v_lead_name text;
  v_actor_name text;
  v_address text;
  v_job_line text;
  v_title text;
  v_title_prefix text;
  v_title_budget integer;
  v_body text;
  v_dedupe_key text;
  v_action_url text;
begin
  -- (1) Milestone gate: exactly the three pairs the day-sheet button emits.
  -- Anything else — corrections, skips, WON, lost, discarded — falls through
  -- silently. No string matching, nothing to keep in sync with the client.
  v_verb := case
    when new.from_stage = 'new_lead'   and new.to_stage = 'qualifying' then 'CONTACTED'
    when new.from_stage = 'qualifying' and new.to_stage = 'quoting'    then 'SITE VISITED'
    when new.from_stage = 'quoting'    and new.to_stage = 'quoted'     then 'QUOTE SENT'
    else null
  end;
  if v_verb is null then
    return new;
  end if;

  if new.transitioned_by is null or new.company_id is null then
    return new;
  end if;

  -- (2) Delegate gate: only a user scoped to their own assigned leads.
  v_actor_scope := private.effective_pipeline_scope_for_user(
    new.transitioned_by,
    new.company_id,
    'pipeline.view'
  );
  if v_actor_scope is distinct from 'assigned' then
    return new;
  end if;

  select
    o.contact_name,
    o.title,
    o.address
    into v_opportunity
    from public.opportunities o
   where o.id = new.opportunity_id
     and o.company_id = new.company_id
     and o.deleted_at is null;
  if not found then
    return new;
  end if;

  -- (3) Copy. Every fragment is whitespace-collapsed first: addresses are
  -- stored multi-line and a raw newline renders as a broken notification.
  v_lead_name := coalesce(
    nullif(btrim(regexp_replace(
      coalesce(v_opportunity.contact_name, ''), '\s+', ' ', 'g'
    )), ''),
    nullif(btrim(regexp_replace(
      coalesce(v_opportunity.title, ''), '\s+', ' ', 'g'
    )), ''),
    'New lead'
  );

  -- '<VERB> — <NAME>' capped at 32 characters. Only the name is cut, and a
  -- cut name ends in '…' so a truncated lead never reads as a real name.
  v_title_prefix := v_verb || ' — ';
  if char_length(v_title_prefix || upper(v_lead_name)) <= 32 then
    v_title := v_title_prefix || upper(v_lead_name);
  else
    v_title_budget := 32 - char_length(v_title_prefix) - 1;
    v_title :=
      v_title_prefix
      || rtrim(left(upper(v_lead_name), v_title_budget))
      || '…';
  end if;

  -- '<address> · <job line>', capped at 140. The separator only appears
  -- between two present halves. When the lead carries neither, the body
  -- names WHO advanced it — the title already names the lead, so the actor
  -- is the one new fact the owner doesn't have (lead name = terminal
  -- fallback if the actor row is gone).
  select nullif(btrim(regexp_replace(
           coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, ''),
           '\s+', ' ', 'g'
         )), '')
    into v_actor_name
    from public.users u
   where u.id = new.transitioned_by;
  v_address := nullif(btrim(regexp_replace(
    coalesce(v_opportunity.address, ''), '\s+', ' ', 'g'
  )), '');
  v_job_line := nullif(btrim(regexp_replace(
    coalesce(v_opportunity.title, ''), '\s+', ' ', 'g'
  )), '');
  v_body := left(
    case
      when v_address is not null and v_job_line is not null
        then v_address || ' · ' || v_job_line
      when v_address is not null then v_address
      when v_job_line is not null then v_job_line
      else 'BY ' || upper(coalesce(v_actor_name, v_lead_name))
    end,
    140
  );

  v_action_url := '/pipeline?opportunityId=' || new.opportunity_id::text;
  v_dedupe_key := 'milestone:' || new.id::text;

  -- (4) Fan out to full-pipeline owners, minus the actor. Isolated: a
  -- notification failure must never roll back the delegate's milestone.
  begin
    for v_recipient in
      select u.id
        from public.users_with_permission(
               new.company_id,
               'pipeline.view',
               'all'
             ) permitted(user_id)
        join public.users u
          on u.id = permitted.user_id
       where u.company_id = new.company_id
         and u.id <> new.transitioned_by
         and u.deleted_at is null
         and coalesce(u.is_active, false) = true
    loop
      perform public.create_notification_if_new(
        v_recipient.id::text,
        new.company_id::text,
        'lead_stage_advanced',
        v_title,
        v_body,
        false,
        v_action_url,
        'OPEN LEAD',
        null,
        'lead',
        v_dedupe_key
      );
    end loop;
  exception
    when others then
      raise warning
        'milestone owner visibility notification failed for transition %: %',
        new.id,
        sqlerrm;
  end;

  return new;
end;
$function$;

revoke all on function private.notify_delegate_milestone_advance()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_stage_transitions_notify_delegate_milestone
  on public.stage_transitions;
create trigger trg_stage_transitions_notify_delegate_milestone
after insert on public.stage_transitions
for each row execute function private.notify_delegate_milestone_advance();

comment on function private.notify_delegate_milestone_advance() is
  'Notifies full-pipeline owners when a delegate advances a lead through one of the three day-sheet milestone stage pairs. Silent for owner actors, corrections, skips, and WON (which has its own conversion delivery chain).';
