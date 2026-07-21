-- Forward-only repair: let mailbox ingestion project an already-proven
-- opportunity owner onto an existing unlinked email_threads cache row.
-- This is not a general re-parent operation. It permits only NULL -> target
-- when the immutable mailbox link and a delivered activity independently
-- prove the exact same company/connection/thread/opportunity relationship.

create or replace function public.attach_email_thread_to_opportunity_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_opportunity_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_thread public.email_threads%rowtype;
  v_link_opportunity_id uuid;
  v_target_client_id uuid;
  v_already_attached boolean := false;
  v_rows integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_connection_id is null
     or p_opportunity_id is null
     or nullif(btrim(p_provider_thread_id), '') is null then
    raise exception 'company, connection, provider thread, and opportunity are required'
      using errcode = '22023';
  end if;

  p_provider_thread_id := btrim(p_provider_thread_id);
  if left(p_provider_thread_id, length('legacy:')) = 'legacy:' then
    raise exception 'email_thread_parent_proof_missing' using errcode = '42501';
  end if;

  -- Match guarded reassignment's lock order so this projection cannot race a
  -- human data-review resolution or an assignment/permission transition.
  perform private.lock_lead_assignment_company(p_company_id);
  perform private.lock_email_thread_data_review(
    p_company_id,
    p_connection_id,
    p_provider_thread_id
  );

  -- The connection proves tenant/mailbox scope. Company mailbox connector
  -- user_id is intentionally irrelevant and confers no actor authority. Lock
  -- the parent connection before its thread child so connection deletion and
  -- routine projection use the same parent-to-child row-lock order.
  perform 1
    from public.email_connections connection
   where connection.id = p_connection_id
     and private.try_parse_uuid(connection.company_id) = p_company_id
     and connection.status = 'active'
     and connection.sync_enabled = true
   for update;
  if not found then
    raise exception 'email_thread_parent_proof_missing' using errcode = '42501';
  end if;

  select thread.*
    into v_thread
    from public.email_threads thread
   where thread.company_id = p_company_id
     and thread.connection_id = p_connection_id
     and thread.provider_thread_id = p_provider_thread_id
   for update;
  if not found then
    raise exception 'email_thread_parent_proof_missing' using errcode = '42501';
  end if;

  v_already_attached := v_thread.opportunity_id = p_opportunity_id;
  if not v_already_attached and v_thread.opportunity_id is not null then
    raise exception 'email_thread_parent_conflict' using errcode = '23514';
  end if;

  select link.opportunity_id
    into v_link_opportunity_id
    from public.opportunity_email_threads link
   where link.connection_id = p_connection_id
     and link.thread_id = p_provider_thread_id
   for update;
  if not found or v_link_opportunity_id is distinct from p_opportunity_id then
    raise exception 'email_thread_parent_proof_missing' using errcode = '42501';
  end if;

  -- Lock all delivered rows in the same order used by guarded data review,
  -- reject split ownership, then require at least one exact target proof.
  perform 1
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id
   order by activity.id
   for update;

  if exists (
    select 1
      from public.activities activity
     where activity.company_id = p_company_id
       and activity.type = 'email'
       and activity.email_connection_id = p_connection_id
       and activity.email_thread_id = p_provider_thread_id
       and activity.opportunity_id is not null
       and activity.opportunity_id is distinct from p_opportunity_id
  ) then
    raise exception 'email_thread_parent_conflict' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from public.activities activity
     where activity.company_id = p_company_id
       and activity.email_connection_id = p_connection_id
       and activity.email_thread_id = p_provider_thread_id
       and activity.opportunity_id = p_opportunity_id
       and activity.type = 'email'
       and nullif(btrim(activity.email_message_id), '') is not null
  ) then
    raise exception 'email_thread_parent_proof_missing' using errcode = '42501';
  end if;

  select opportunity.client_id
    into v_target_client_id
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
   for update;
  if not found then
    raise exception 'email_thread_parent_proof_missing' using errcode = '42501';
  end if;
  if v_thread.client_id is not null
     and v_target_client_id is not null
     and v_thread.client_id is distinct from v_target_client_id then
    raise exception 'email_thread_client_conflict' using errcode = '23514';
  end if;

  if v_already_attached then
    return jsonb_build_object(
      'ok', true,
      'attached', false,
      'email_thread_id', v_thread.id,
      'opportunity_id', p_opportunity_id
    );
  end if;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id,
    backend_pid,
    table_name,
    row_id,
    old_opportunity_id,
    new_opportunity_id
  ) values (
    txid_current(),
    pg_backend_pid(),
    'email_threads',
    v_thread.id,
    null::uuid,
    p_opportunity_id
  )
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  update public.email_threads thread
     set opportunity_id = p_opportunity_id,
         updated_at = now()
   where id = v_thread.id
     and opportunity_id is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'email_thread_parent_conflict' using errcode = '40001';
  end if;

  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid()
     and token.table_name = 'email_threads'
     and token.row_id = v_thread.id;

  return jsonb_build_object(
    'ok', true,
    'attached', true,
    'email_thread_id', v_thread.id,
    'opportunity_id', p_opportunity_id
  );
exception when others then
  if v_thread.id is not null then
    delete from private.opportunity_child_reparent_tokens token
     where token.transaction_id = txid_current()
       and token.backend_pid = pg_backend_pid()
       and token.table_name = 'email_threads'
       and token.row_id = v_thread.id;
  end if;
  raise;
end;
$function$;

revoke all on function public.attach_email_thread_to_opportunity_as_system(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.attach_email_thread_to_opportunity_as_system(
  uuid, uuid, text, uuid
) to service_role;

comment on function public.attach_email_thread_to_opportunity_as_system(
  uuid, uuid, text, uuid
) is
  'Service-only NULL-to-parent projection for email_threads after exact active mailbox, immutable opportunity_email_threads, delivered provider activity, tenant, and client proof. Never re-parents an existing owner.';
