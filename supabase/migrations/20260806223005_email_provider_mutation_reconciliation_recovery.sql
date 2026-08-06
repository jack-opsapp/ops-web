-- Email provider mutation reconciliation — recovery
--
-- `reconciliation_required` had no exit. `mark_email_provider_mutation_rejected`
-- refuses every status outside (attempting, provider_rejected), nothing else
-- transitioned out of it, and `prepare_email_provider_mutation_attempt` returns
-- the same quarantined row to every later caller on that
-- (connection_id_snapshot, operation_kind, operation_key). One quarantined
-- attempt therefore blocked its operation permanently, and both productions
-- clears on 2026-08-06 were hand-written UPDATE statements.
--
-- Two changes here:
--   1. `resolve_email_provider_mutation_reconciliation` — the exit. It is
--      deliberately narrow. The caller supplies a verdict backed by a positive
--      provider read plus the evidence text, and an "it isn't there" verdict
--      must name the exact resource it disproves. Absence of evidence resolves
--      nothing, which is the standard the manual recovery held itself to.
--   2. The operator alert stops being a dead end: it retires on ANY exit from
--      quarantine (not just `completed`, which a rejected attempt never
--      reaches), and an individual-mailbox draft alert now deep-links to the
--      conversation instead of hard-setting action_url/action_label to null.

begin;

create or replace function public.resolve_email_provider_mutation_reconciliation(
  p_attempt_id uuid,
  p_verdict text,
  p_provider_resource_id text default null,
  p_provider_secondary_resource_id text default null,
  p_provider_result jsonb default '{}'::jsonb,
  p_evidence text default null
)
returns public.email_provider_mutation_attempts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  existing public.email_provider_mutation_attempts%rowtype;
  v_resource_id text := nullif(btrim(coalesce(p_provider_resource_id, '')), '');
  v_secondary_id text := nullif(
    btrim(coalesce(p_provider_secondary_resource_id, '')),
    ''
  );
  v_result jsonb := coalesce(p_provider_result, '{}'::jsonb);
  v_evidence text := nullif(btrim(coalesce(p_evidence, '')), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  -- Evidence is mandatory for both verdicts. A resolution with nothing on the
  -- record behind it is exactly the guess this ledger exists to prevent.
  if p_attempt_id is null
     or p_verdict not in ('resource_exists', 'resource_absent')
     or v_evidence is null
     or jsonb_typeof(v_result) <> 'object' then
    raise exception 'invalid_email_provider_mutation_resolution'
      using errcode = '22023';
  end if;

  select attempt.* into existing
  from public.email_provider_mutation_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception 'email_provider_mutation_attempt_missing'
      using errcode = 'P0002';
  end if;

  -- Replay of a verdict already landed returns the row untouched. A resolver
  -- that crashed between its provider read and its own bookkeeping must be
  -- able to run again without fighting the state machine.
  if existing.status = 'completed' then
    return existing;
  end if;
  if p_verdict = 'resource_exists'
     and existing.status = 'provider_accepted'
     and existing.provider_resource_id is not distinct from v_resource_id then
    return existing;
  end if;
  if p_verdict = 'resource_absent'
     and existing.status = 'provider_rejected'
     and existing.provider_resource_id is null then
    return existing;
  end if;

  if existing.status <> 'reconciliation_required' then
    raise exception 'email_provider_mutation_resolution_invalid'
      using errcode = '55000';
  end if;

  if p_verdict = 'resource_exists' then
    if v_resource_id is null then
      raise exception 'invalid_email_provider_mutation_resolution'
        using errcode = '22023';
    end if;
    if existing.provider_resource_id is not null
       and existing.provider_resource_id is distinct from v_resource_id then
      raise exception 'email_provider_mutation_identity_conflict'
        using errcode = '23505';
    end if;

    -- provider_accepted, not completed: OPS still has to bind this identity to
    -- its own state, and `complete_email_provider_mutation_attempt` remains the
    -- only thing allowed to close the row once that binding lands.
    update public.email_provider_mutation_attempts attempt
    set status = 'provider_accepted',
        provider_resource_id = v_resource_id,
        provider_secondary_resource_id = coalesce(
          attempt.provider_secondary_resource_id,
          v_secondary_id
        ),
        provider_result = case
          when attempt.provider_result = '{}'::jsonb then v_result
          else attempt.provider_result
        end,
        provider_accepted_at = coalesce(
          attempt.provider_accepted_at,
          clock_timestamp()
        ),
        -- The proof that lifted the quarantine outlives the quarantine itself;
        -- completion clears it.
        last_error = left(v_evidence, 2000),
        updated_at = clock_timestamp()
    where attempt.id = p_attempt_id
    returning attempt.* into existing;
    return existing;
  end if;

  -- resource_absent. A recorded identity may only be withdrawn by a caller that
  -- names it, so a blind absence claim can never erase an acceptance it never
  -- looked at.
  if existing.provider_resource_id is not null
     and existing.provider_resource_id is distinct from v_resource_id then
    raise exception 'email_provider_mutation_absence_contradicted'
      using errcode = '23505';
  end if;

  -- The identity is cleared along with the status. A provider_rejected row that
  -- kept provider_resource_id would be read straight back by
  -- EmailProviderMutationAttemptService.execute as a durable acceptance, and
  -- reconciliation would bind a resource that has been proven gone.
  update public.email_provider_mutation_attempts attempt
  set status = 'provider_rejected',
      provider_resource_id = null,
      provider_secondary_resource_id = null,
      provider_result = '{}'::jsonb,
      provider_accepted_at = null,
      last_error = left(v_evidence, 2000),
      updated_at = clock_timestamp()
  where attempt.id = p_attempt_id
  returning attempt.* into existing;
  return existing;
end;
$function$;

create or replace function private.notify_email_provider_mutation_reconciliation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  user_row public.users%rowtype;
  v_dedupe_key text := 'email-provider-mutation-reconciliation:' || new.id::text;
  v_title text;
  v_body text;
  v_action_url text;
  v_action_label text;
  v_draft_history_id uuid;
  v_thread_id uuid;
  v_opportunity_id uuid;
begin
  -- Any exit from quarantine retires the alert. Scoping this to `completed`
  -- left a permanent, undismissable notification behind whenever an attempt
  -- unjammed to provider_rejected instead.
  if old.status = 'reconciliation_required'
     and new.status <> 'reconciliation_required' then
    update public.notifications notification
    set resolved_at = clock_timestamp(),
        is_read = true
    where notification.company_id = new.company_id::text
      and notification.type = 'system'
      and notification.dedupe_key = v_dedupe_key
      and notification.resolved_at is null;
    return new;
  end if;

  if new.status <> 'reconciliation_required'
     or old.status = 'reconciliation_required' then
    return new;
  end if;

  if new.operation_kind = 'draft_create' then
    v_title := 'Draft placement needs review';
    v_body := 'OPS could not confirm one mailbox draft. It retries on its own — check Drafts before writing this reply yourself.';
  else
    v_title := 'Email connection needs review';
    v_body := 'OPS could not confirm this mailbox update. Review the connection before retrying.';
  end if;

  -- A Phase C reply draft names its own ai_draft_history row in the operation
  -- key, which is the only handle the ledger carries back to a conversation.
  if new.operation_kind = 'draft_create'
     and new.operation_key like 'phase-c-reply-draft:%' then
    v_draft_history_id := private.email_provider_mutation_safe_uuid(
      substring(new.operation_key from length('phase-c-reply-draft:') + 1)
    );
    if v_draft_history_id is not null then
      select thread.id, thread.opportunity_id
      into v_thread_id, v_opportunity_id
      from public.ai_draft_history history
      left join public.email_threads thread
        on thread.provider_thread_id = history.thread_id
       and thread.connection_id = history.connection_id
       and thread.company_id = history.company_id
      where history.id = v_draft_history_id
        and history.company_id = new.company_id
      limit 1;
    end if;
  end if;

  if v_thread_id is not null then
    -- Same target the lead-review notifications use: the thread surface, with
    -- the lead riding along so it stays recoverable without a second join.
    v_action_url := '/inbox/' || v_thread_id::text
      || coalesce('?opportunityid=' || v_opportunity_id::text, '');
    v_action_label := 'Review draft';
  elsif v_opportunity_id is not null then
    v_action_url := '/pipeline?opportunityid=' || v_opportunity_id::text;
    v_action_label := 'Review draft';
  end if;

  if new.connection_type_snapshot = 'individual' then
    select active_user.* into user_row
    from public.users active_user
    where active_user.id = new.owner_user_id_snapshot
      and active_user.company_id = new.company_id
      and active_user.deleted_at is null
      and coalesce(active_user.is_active, false)
    limit 1;
    if not found then
      return new;
    end if;
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    ) values (
      user_row.id::text, new.company_id::text, 'system', v_title, v_body,
      false, true, v_action_url, v_action_label, v_dedupe_key
    ) on conflict do nothing;
    return new;
  end if;

  if new.connection_type_snapshot = 'company' then
    -- A shared mailbox has no single owner, so the settings surface stays the
    -- destination unless this attempt resolved to a specific conversation.
    if v_action_url is null then
      v_action_url := '/settings?tab=integrations';
      v_action_label := 'Review mailbox';
    end if;
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    )
    select
      recipient.id::text,
      new.company_id::text,
      'system',
      v_title,
      v_body,
      false,
      true,
      v_action_url,
      v_action_label,
      v_dedupe_key
    from public.users recipient
    where recipient.company_id = new.company_id
      and recipient.deleted_at is null
      and coalesce(recipient.is_active, false)
      and public.has_permission(
        recipient.id,
        'settings.integrations',
        'all'
      )
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

revoke all on function private.notify_email_provider_mutation_reconciliation()
  from public, anon, authenticated, service_role;

revoke all on function public.resolve_email_provider_mutation_reconciliation(
  uuid, text, text, text, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_email_provider_mutation_reconciliation(
  uuid, text, text, text, jsonb, text
) to service_role;

commit;
