begin;

-- Canonical authorization for non-send email interactions. The helper holds
-- the thread, relationship, mailbox, opportunity, and assignment snapshot for
-- the caller's transaction so a reassignment cannot land between permission
-- evaluation and the protected write.
create or replace function private.user_can_edit_email_thread(
  p_actor_user_id uuid,
  p_thread_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.users%rowtype;
  v_thread public.email_threads%rowtype;
  v_connection public.email_connections%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_linked_opportunity_id uuid;
  v_opportunity_id uuid;
begin
  if p_actor_user_id is null or p_thread_id is null then
    return false;
  end if;

  select u.*
    into v_actor
    from public.users u
   where u.id = p_actor_user_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for share;
  if not found then
    return false;
  end if;

  select t.*
    into v_thread
    from public.email_threads t
   where t.id = p_thread_id
     and t.company_id = v_actor.company_id
   for share;
  if not found then
    return false;
  end if;

  select c.*
    into v_connection
    from public.email_connections c
   where c.id = v_thread.connection_id
     and c.company_id = v_actor.company_id::text
   for share;
  if not found then
    return false;
  end if;

  select link.opportunity_id
    into v_linked_opportunity_id
    from public.opportunity_email_threads link
   where link.connection_id = v_thread.connection_id
     and link.thread_id = v_thread.provider_thread_id
   for share;

  if v_thread.opportunity_id is not null
     and v_linked_opportunity_id is not null
     and v_thread.opportunity_id is distinct from v_linked_opportunity_id then
    return false;
  end if;
  v_opportunity_id := coalesce(
    v_thread.opportunity_id,
    v_linked_opportunity_id
  );
  if v_opportunity_id is null then
    return false;
  end if;

  select o.*
    into v_opportunity
    from public.opportunities o
   where o.id = v_opportunity_id
     and o.company_id = v_actor.company_id
     and o.deleted_at is null
   for share;
  if not found
     or not private.user_can_edit_opportunity(
       p_actor_user_id,
       v_opportunity.id
     ) then
    return false;
  end if;

  return private.user_can_view_opportunity_inbox(
    p_actor_user_id,
    v_opportunity.id,
    v_connection.id
  );
end;
$$;

create or replace function public.resolve_email_commitment_as_system(
  p_actor_user_id uuid,
  p_memory_id uuid,
  p_resolved_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_memory public.agent_memories%rowtype;
  v_actor_company_id uuid;
  v_thread_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_memory_id is null then
    raise exception 'actor and commitment are required' using errcode = '22023';
  end if;

  select m.*
    into v_memory
    from public.agent_memories m
   where m.id = p_memory_id
   for update;
  if not found
     or v_memory.category <> 'commitment'
     or nullif(btrim(v_memory.source_id), '') is null
     or v_memory.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  select u.company_id
    into v_actor_company_id
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id = v_memory.company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for share;
  if not found then
    return false;
  end if;

  v_thread_id := v_memory.source_id::uuid;
  if not private.user_can_edit_email_thread(
    p_actor_user_id,
    v_thread_id
  ) then
    return false;
  end if;

  update public.agent_memories
     set resolved_at = p_resolved_at
   where id = v_memory.id
     and company_id = v_actor_company_id
     and category = 'commitment'
     and source_id = v_memory.source_id;
  return found;
end;
$$;

create or replace function public.answer_email_agent_question_as_system(
  p_actor_user_id uuid,
  p_thread_id uuid,
  p_answer text,
  p_option_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.email_threads%rowtype;
  v_question jsonb;
  v_option jsonb;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_option_id text := nullif(btrim(coalesce(p_option_id, '')), '');
  v_answered_at timestamptz := clock_timestamp();
  v_memory_id uuid;
  v_rows integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_thread_id is null
     or length(v_answer) not between 1 and 10000
     or length(coalesce(v_option_id, '')) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select t.*
    into v_thread
    from public.email_threads t
   where t.id = p_thread_id
   for update;
  if not found
     or not private.user_can_edit_email_thread(
       p_actor_user_id,
       p_thread_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_question := v_thread.agent_blocking_question;
  if v_question is null
     or jsonb_typeof(v_question) <> 'object'
     or nullif(btrim(v_question ->> 'question'), '') is null then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'no_pending_question'
    );
  end if;

  if v_option_id is not null then
    if jsonb_typeof(v_question -> 'options') <> 'array' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_option');
    end if;
    select option_row.value
      into v_option
      from jsonb_array_elements(v_question -> 'options') option_row(value)
     where option_row.value ->> 'id' = v_option_id
     limit 1;
    if not found
       or nullif(btrim(v_option ->> 'label'), '') is null
       or btrim(v_option ->> 'label') <> v_answer then
      return jsonb_build_object('ok', false, 'reason', 'invalid_option');
    end if;
  end if;

  insert into public.agent_memories (
    company_id,
    user_id,
    memory_type,
    category,
    content,
    confidence,
    source,
    source_id
  ) values (
    v_thread.company_id,
    p_actor_user_id::text,
    'fact',
    'answered_question',
    jsonb_build_object(
      'question', v_question -> 'question',
      'options', v_question -> 'options',
      'asked_at', v_question -> 'asked_at',
      'answer', v_answer,
      'option_id', v_option_id,
      'answered_at', v_answered_at,
      'answered_by_user_id', p_actor_user_id
    )::text,
    1.0,
    'inbox_ui',
    p_thread_id::text
  )
  returning id into v_memory_id;

  update public.email_threads
     set agent_blocking_question = null
   where id = p_thread_id
     and company_id = v_thread.company_id
     and agent_blocking_question = v_question;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'EMAIL_AGENT_QUESTION_CHANGED';
  end if;

  return jsonb_build_object(
    'ok',
    true,
    'memory_id',
    v_memory_id,
    'answered_at',
    v_answered_at
  );
end;
$$;

revoke all on function private.user_can_edit_email_thread(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.resolve_email_commitment_as_system(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_email_commitment_as_system(
  uuid, uuid, timestamptz
) to service_role;

revoke all on function public.answer_email_agent_question_as_system(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.answer_email_agent_question_as_system(
  uuid, uuid, text, text
) to service_role;

commit;
