-- Preserve nonterminal Gmail continuation state without claiming the mailbox
-- completed a sync cycle. Only the current global mailbox lease owner may
-- publish this checkpoint.

begin;

create or replace function public.persist_email_connection_sync_checkpoint_as_system(
  p_connection_id uuid,
  p_owner_id uuid,
  p_history_id text,
  p_clear_recovery boolean default false
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_written_at timestamptz := clock_timestamp();
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null
    or p_owner_id is null
    or nullif(btrim(p_history_id), '') is null
    or p_history_id is distinct from btrim(p_history_id)
    or p_clear_recovery is null
  then
    raise exception 'invalid sync continuation checkpoint'
      using errcode = '22023';
  end if;

  perform 1
    from private.email_provider_mailbox_sync_leases as lease
   where lease.connection_id = p_connection_id
     and lease.owner_id = p_owner_id
     and lease.expires_at > v_written_at
   for update;

  if not found then
    return false;
  end if;

  update public.email_connections
     set history_id = p_history_id,
         history_recovery_anchor = case
           when p_clear_recovery then null
           else history_recovery_anchor
         end,
         history_recovery_page_token = case
           when p_clear_recovery then null
           else history_recovery_page_token
         end,
         history_recovery_target_token = case
           when p_clear_recovery then null
           else history_recovery_target_token
         end
   where id = p_connection_id
     and sync_lock_owner = p_owner_id
     and sync_in_progress_at is not null
     and sync_enabled is true
     and status in ('active', 'setup_incomplete');

  get diagnostics v_updated_count = row_count;
  return v_updated_count = 1;
end;
$function$;

revoke all on function public.persist_email_connection_sync_checkpoint_as_system(
  uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.persist_email_connection_sync_checkpoint_as_system(
  uuid, uuid, text, boolean
) to service_role;

comment on function public.persist_email_connection_sync_checkpoint_as_system(
  uuid, uuid, text, boolean
) is
  'Owner-fenced publication of a nonterminal mailbox cursor. Deliberately does not advance last_synced_at; only terminal completion may do that.';

commit;
