-- Preserve immutable provider-thread ownership for ordinary writers while
-- allowing two explicit, audited mutation paths:
--   1. the existing guarded opportunity merge, backed by an exact pending
--      duplicate-review row; and
--   2. the operator data-review action, executed as one service-only RPC.
--
-- The attachment-persistence migration observes activities.opportunity_id and
-- requeues attachment attribution. Keeping all three thread projections in one
-- transaction therefore also keeps durable attachment ownership convergent.

begin;

-- The original merge implementation is already transactional and exhaustively
-- tested. Keep it intact behind a new wrapper instead of copying hundreds of
-- lines into a second implementation. Renaming preserves the function body;
-- privileges are revoked below so it cannot be called around the wrapper.
alter function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) rename to execute_opportunity_merge_guarded_internal;

revoke all on function public.execute_opportunity_merge_guarded_internal(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated, service_role;

-- Replace the immutable-owner trigger with a context-fenced version. A service
-- role by itself is deliberately insufficient: the transaction must also carry
-- an exact context installed by one of the two guarded functions below.
create or replace function public.require_same_company_opportunity_email_thread()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_connection_company_id uuid;
  v_opportunity_company_id uuid;
  v_mode text := nullif(current_setting('ops.email_thread_reassignment_mode', true), '');
  v_review_id text := nullif(current_setting('ops.email_thread_reassignment_review_id', true), '');
  v_winner_id text := nullif(current_setting('ops.email_thread_reassignment_winner_id', true), '');
  v_loser_id text := nullif(current_setting('ops.email_thread_reassignment_loser_id', true), '');
  v_connection_id text := nullif(current_setting('ops.email_thread_reassignment_connection_id', true), '');
  v_thread_id text := nullif(current_setting('ops.email_thread_reassignment_thread_id', true), '');
  v_review_allows boolean := false;
begin
  if new.connection_id is not null then
    select nullif(connection.company_id, '')::uuid
      into v_connection_company_id
      from public.email_connections connection
     where connection.id = new.connection_id;
  end if;

  select opportunity.company_id
    into v_opportunity_company_id
    from public.opportunities opportunity
   where opportunity.id = new.opportunity_id;

  if new.connection_id is not null
     and (
       v_connection_company_id is null
       or v_opportunity_company_id is null
       or v_connection_company_id is distinct from v_opportunity_company_id
     ) then
    raise exception 'opportunity email thread must reference a mailbox and opportunity in the same company';
  end if;

  if tg_op = 'UPDATE'
     and old.opportunity_id is distinct from new.opportunity_id then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
      raise exception 'opportunity email thread ownership is immutable';
    end if;

    if v_mode = 'guarded_merge'
       and v_review_id is not null
       and v_winner_id = new.opportunity_id::text
       and v_loser_id = old.opportunity_id::text then
      select exists (
        select 1
          from public.duplicate_reviews review
         where review.id::text = v_review_id
           and review.company_id = v_opportunity_company_id
           and review.entity_type = 'opportunity'
           and review.status = 'pending'
           and (
             (review.entity_a_id = old.opportunity_id and review.entity_b_id = new.opportunity_id)
             or
             (review.entity_a_id = new.opportunity_id and review.entity_b_id = old.opportunity_id)
           )
      ) into v_review_allows;

      if not v_review_allows then
        raise exception 'opportunity email thread ownership is immutable';
      end if;
    elsif v_mode = 'data_review'
       and v_connection_id = coalesce(new.connection_id::text, '')
       and v_thread_id = new.thread_id
       and v_winner_id = new.opportunity_id::text then
      -- Exact connection/thread/target values were installed by the guarded
      -- RPC after its owner-membership and same-client checks.
      null;
    else
      raise exception 'opportunity email thread ownership is immutable';
    end if;
  end if;

  return new;
end;
$$;

-- Recreate the public RPC name as a narrow wrapper. The existing implementation
-- is callable only inside this SECURITY DEFINER function, and a supplied review
-- must still be pending and cover the exact winner/loser pair.
create or replace function public.execute_opportunity_merge_guarded(
  p_company_id            uuid,
  p_winner_id             uuid,
  p_loser_id              uuid,
  p_merge_key             text,
  p_review_id             uuid default null,
  p_expected_winner_stage text default null,
  p_expected_loser_stage  text default null,
  p_field_fill            jsonb default '{}'::jsonb,
  p_confirmed_overrides   jsonb default '{}'::jsonb,
  p_resolved_by           uuid default null,
  p_run_id                text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_review_valid boolean := false;
  v_previous_mode text := current_setting('ops.email_thread_reassignment_mode', true);
  v_previous_review text := current_setting('ops.email_thread_reassignment_review_id', true);
  v_previous_winner text := current_setting('ops.email_thread_reassignment_winner_id', true);
  v_previous_loser text := current_setting('ops.email_thread_reassignment_loser_id', true);
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_review_id is not null then
    select exists (
      select 1
        from public.duplicate_reviews review
       where review.id = p_review_id
         and review.company_id = p_company_id
         and review.entity_type = 'opportunity'
         and review.status = 'pending'
         and (
           (review.entity_a_id = p_winner_id and review.entity_b_id = p_loser_id)
           or
           (review.entity_a_id = p_loser_id and review.entity_b_id = p_winner_id)
         )
    ) into v_review_valid;

    if not v_review_valid then
      raise exception 'merge requires an exact pending opportunity duplicate review'
        using errcode = '23514';
    end if;

    perform set_config('ops.email_thread_reassignment_mode', 'guarded_merge', true);
    perform set_config('ops.email_thread_reassignment_review_id', p_review_id::text, true);
    perform set_config('ops.email_thread_reassignment_winner_id', p_winner_id::text, true);
    perform set_config('ops.email_thread_reassignment_loser_id', p_loser_id::text, true);
  end if;

  v_result := public.execute_opportunity_merge_guarded_internal(
    p_company_id,
    p_winner_id,
    p_loser_id,
    p_merge_key,
    p_review_id,
    p_expected_winner_stage,
    p_expected_loser_stage,
    p_field_fill,
    p_confirmed_overrides,
    p_resolved_by,
    p_run_id
  );

  perform set_config('ops.email_thread_reassignment_mode', coalesce(v_previous_mode, ''), true);
  perform set_config('ops.email_thread_reassignment_review_id', coalesce(v_previous_review, ''), true);
  perform set_config('ops.email_thread_reassignment_winner_id', coalesce(v_previous_winner, ''), true);
  perform set_config('ops.email_thread_reassignment_loser_id', coalesce(v_previous_loser, ''), true);
  return v_result;
exception when others then
  perform set_config('ops.email_thread_reassignment_mode', coalesce(v_previous_mode, ''), true);
  perform set_config('ops.email_thread_reassignment_review_id', coalesce(v_previous_review, ''), true);
  perform set_config('ops.email_thread_reassignment_winner_id', coalesce(v_previous_winner, ''), true);
  perform set_config('ops.email_thread_reassignment_loser_id', coalesce(v_previous_loser, ''), true);
  raise;
end;
$$;

revoke all on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated;
grant execute on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) to service_role;

-- One atomic mutation for an operator-confirmed data-review action. The RPC
-- derives every guard from live rows, locks the exact mailbox/thread projection,
-- and refuses cross-mailbox ambiguity, fabricated targets, hidden targets, and
-- cross-client movement before changing any row.
create or replace function public.reassign_opportunity_email_thread_guarded(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_target_opportunity_id uuid,
  p_kind text default 'split'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_company_id uuid;
  v_target_client_id uuid;
  v_target_hidden boolean;
  v_canonical_owner_id uuid;
  v_owner_ids uuid[] := '{}'::uuid[];
  v_thread_connection_count integer := 0;
  v_activity_count integer := 0;
  v_activities_repointed integer := 0;
  v_thread_rows_repointed integer := 0;
  v_link_rows_repointed integer := 0;
  v_previous_mode text := current_setting('ops.email_thread_reassignment_mode', true);
  v_previous_connection text := current_setting('ops.email_thread_reassignment_connection_id', true);
  v_previous_thread text := current_setting('ops.email_thread_reassignment_thread_id', true);
  v_previous_winner text := current_setting('ops.email_thread_reassignment_winner_id', true);
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null
     or p_connection_id is null
     or p_target_opportunity_id is null
     or nullif(btrim(p_provider_thread_id), '') is null then
    raise exception 'company, connection, provider thread, and target opportunity are required'
      using errcode = '22023';
  end if;

  if p_kind not in ('split', 'terminal_live') then
    raise exception 'unsupported data-review item kind' using errcode = '22023';
  end if;

  p_provider_thread_id := btrim(p_provider_thread_id);

  select nullif(connection.company_id, '')::uuid
    into v_connection_company_id
    from public.email_connections connection
   where connection.id = p_connection_id;

  if v_connection_company_id is null
     or v_connection_company_id is distinct from p_company_id then
    raise exception 'mailbox connection is outside company scope'
      using errcode = '23514';
  end if;

  select opportunity.client_id,
         opportunity.archived_at is not null or opportunity.deleted_at is not null
    into v_target_client_id, v_target_hidden
    from public.opportunities opportunity
   where opportunity.id = p_target_opportunity_id
     and opportunity.company_id = p_company_id;

  if not found then
    raise exception 'target opportunity not found in company scope'
      using errcode = 'P0002';
  end if;
  if v_target_hidden then
    raise exception 'target opportunity is archived or deleted'
      using errcode = '23514';
  end if;

  perform 1
    from public.email_threads thread
   where thread.company_id = p_company_id
     and thread.connection_id = p_connection_id
     and thread.provider_thread_id = p_provider_thread_id
   for update;
  if not found then
    raise exception 'exact mailbox thread not found' using errcode = 'P0002';
  end if;

  select count(distinct thread.connection_id)::integer
    into v_thread_connection_count
    from public.email_threads thread
   where thread.company_id = p_company_id
     and thread.provider_thread_id = p_provider_thread_id;

  if v_thread_connection_count <> 1 then
    raise exception 'provider thread resolves to more than one mailbox connection'
      using errcode = '23514';
  end if;

  select link.opportunity_id
    into v_canonical_owner_id
    from public.opportunity_email_threads link
   where link.connection_id = p_connection_id
     and link.thread_id = p_provider_thread_id
   for update;

  perform 1
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_thread_id = p_provider_thread_id
     and (
       activity.email_connection_id = p_connection_id
       or activity.email_connection_id is null
     )
   for update;

  select
    coalesce(
      array_agg(distinct activity.opportunity_id)
        filter (where activity.opportunity_id is not null),
      '{}'::uuid[]
    ),
    count(*)::integer
    into v_owner_ids, v_activity_count
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_thread_id = p_provider_thread_id
     and (
       activity.email_connection_id = p_connection_id
       or activity.email_connection_id is null
     );

  if p_kind = 'split'
     and not (p_target_opportunity_id = any(v_owner_ids)) then
    raise exception 'target opportunity is not a current owner of this thread'
      using errcode = '23514';
  end if;

  if p_kind = 'terminal_live'
     and v_canonical_owner_id is distinct from p_target_opportunity_id
     and not (p_target_opportunity_id = any(v_owner_ids)) then
    raise exception 'target opportunity is not a current owner of this thread'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from unnest(v_owner_ids) owner(opportunity_id)
      join public.opportunities opportunity on opportunity.id = owner.opportunity_id
     where opportunity.company_id <> p_company_id
        or opportunity.client_id is distinct from v_target_client_id
  ) then
    raise exception 'reassignment would cross client ownership'
      using errcode = '23514';
  end if;

  perform set_config('ops.email_thread_reassignment_mode', 'data_review', true);
  perform set_config('ops.email_thread_reassignment_connection_id', p_connection_id::text, true);
  perform set_config('ops.email_thread_reassignment_thread_id', p_provider_thread_id, true);
  perform set_config('ops.email_thread_reassignment_winner_id', p_target_opportunity_id::text, true);

  if v_canonical_owner_id is null then
    insert into public.opportunity_email_threads (
      opportunity_id, thread_id, connection_id
    ) values (
      p_target_opportunity_id, p_provider_thread_id, p_connection_id
    );
    v_link_rows_repointed := 1;
  else
    update public.opportunity_email_threads
       set opportunity_id = p_target_opportunity_id
     where connection_id = p_connection_id
       and thread_id = p_provider_thread_id
       and opportunity_id is distinct from p_target_opportunity_id;
    get diagnostics v_link_rows_repointed = row_count;
  end if;

  update public.email_threads
     set opportunity_id = p_target_opportunity_id,
         updated_at = now()
   where company_id = p_company_id
     and connection_id = p_connection_id
     and provider_thread_id = p_provider_thread_id
     and opportunity_id is distinct from p_target_opportunity_id;
  get diagnostics v_thread_rows_repointed = row_count;

  update public.activities
     set opportunity_id = p_target_opportunity_id
   where company_id = p_company_id
     and type = 'email'
     and email_thread_id = p_provider_thread_id
     and (
       email_connection_id = p_connection_id
       or email_connection_id is null
     )
     and opportunity_id is distinct from p_target_opportunity_id;
  get diagnostics v_activities_repointed = row_count;

  perform set_config('ops.email_thread_reassignment_mode', coalesce(v_previous_mode, ''), true);
  perform set_config('ops.email_thread_reassignment_connection_id', coalesce(v_previous_connection, ''), true);
  perform set_config('ops.email_thread_reassignment_thread_id', coalesce(v_previous_thread, ''), true);
  perform set_config('ops.email_thread_reassignment_winner_id', coalesce(v_previous_winner, ''), true);

  return jsonb_build_object(
    'provider_thread_id', p_provider_thread_id,
    'target_opportunity_id', p_target_opportunity_id,
    'activities_repointed', v_activities_repointed,
    'email_threads_repointed', v_thread_rows_repointed,
    'opportunity_email_threads_repointed', v_link_rows_repointed,
    'activity_count', v_activity_count
  );
exception when others then
  perform set_config('ops.email_thread_reassignment_mode', coalesce(v_previous_mode, ''), true);
  perform set_config('ops.email_thread_reassignment_connection_id', coalesce(v_previous_connection, ''), true);
  perform set_config('ops.email_thread_reassignment_thread_id', coalesce(v_previous_thread, ''), true);
  perform set_config('ops.email_thread_reassignment_winner_id', coalesce(v_previous_winner, ''), true);
  raise;
end;
$$;

revoke all on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, text, uuid, text
) to service_role;

comment on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, text, uuid, text
) is
  'Atomically resolves an operator-reviewed provider-thread owner across canonical link, inbox cache, and exact email activities; service-role only and fail-closed.';

commit;
