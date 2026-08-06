-- Applied to production 2026-08-06. Mirror of the live migration.
--
-- private.notify_email_provider_mutation_reconciliation declares a plpgsql
-- variable `user_row public.users%rowtype`, and its company branch then aliased
-- the users table with that SAME name:
--
--     select user_row.id::text, ... from public.users user_row
--
-- Postgres cannot tell the record variable from the table alias, so every
-- execution raised 42702 "column reference user_row.id is ambiguous".
--
-- Impact was far larger than a missed notification, because this trigger fires
-- on the transition into `reconciliation_required`:
--   * mark_email_provider_mutation_reconciliation_required() always threw, so
--     EmailProviderMutationAttemptService could never quarantine a stalled
--     attempt — the row stayed `attempting`, which then blocks EVERY later
--     attempt for that operation key. Mailbox draft placement was dead for the
--     tenant from 2026-08-01 until this fix.
--   * markReconciliationRequired is also what persists `last_error`, so the
--     underlying provider error was destroyed on the way out (all stranded rows
--     carry an empty last_error).
--   * This trigger IS the "Draft placement needs review" operator notification,
--     so the one alert designed to surface a stranded draft was suppressed by
--     the same defect. Silent in both channels at once.
--
-- The `individual` branch was already correct (it aliases active_user); only the
-- `company` branch collided. Only the alias is renamed here — every other
-- statement is byte-identical to the previous definition.
CREATE OR REPLACE FUNCTION private.notify_email_provider_mutation_reconciliation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  user_row public.users%rowtype;
  v_dedupe_key text := 'email-provider-mutation-reconciliation:' || new.id::text;
  v_title text;
  v_body text;
  v_action_url text;
  v_action_label text;
begin
  if new.status = 'completed' and old.status <> 'completed' then
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
    v_body := 'OPS could not confirm one mailbox draft. Check Drafts before creating another.';
  else
    v_title := 'Email connection needs review';
    v_body := 'OPS could not confirm this mailbox update. Review the connection before retrying.';
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
    v_action_url := null;
    v_action_label := null;
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
    v_action_url := '/settings?tab=integrations';
    v_action_label := 'Review mailbox';
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
