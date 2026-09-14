-- Production ownership guard definitions verified read-only on 2026-09-14.
CREATE OR REPLACE FUNCTION public.require_same_company_opportunity_email_thread()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    select company.id
      into v_connection_company_id
      from public.email_connections connection
      join public.companies company
        on company.id::text = connection.company_id
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
$function$;

CREATE OR REPLACE FUNCTION private.guard_opportunity_child_reparent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_old_opportunity_id uuid;
  v_new_opportunity_id uuid;
  v_row_id uuid;
  v_consumed boolean;
begin
  if tg_nargs < 2 then
    raise exception 'child_reparent_guard_misconfigured'
      using errcode = '55000';
  end if;
  if tg_nargs >= 3
    and v_old ->> 'entity_type' is distinct from tg_argv[2]
    and v_new ->> 'entity_type' is distinct from tg_argv[2]
  then
    return new;
  end if;
  v_old_opportunity_id := private.try_parse_uuid(v_old ->> tg_argv[0]);
  v_new_opportunity_id := private.try_parse_uuid(v_new ->> tg_argv[0]);
  if v_old_opportunity_id is not distinct from v_new_opportunity_id then
    return new;
  end if;
  v_row_id := private.try_parse_uuid(v_old ->> tg_argv[1]);
  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid()
     and token.table_name = tg_table_name
     and token.row_id = v_row_id
     and token.old_opportunity_id is not distinct from v_old_opportunity_id
     and token.new_opportunity_id is not distinct from v_new_opportunity_id
  returning true into v_consumed;
  if not found or not coalesce(v_consumed, false) then
    raise exception 'child_reparent_forbidden'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger trg_opportunity_email_threads_guard_opportunity_reparent before update of opportunity_id on public.opportunity_email_threads for each row execute function private.guard_opportunity_child_reparent('opportunity_id','id');
create trigger trg_email_threads_guard_opportunity_reparent before update of opportunity_id on public.email_threads for each row execute function private.guard_opportunity_child_reparent('opportunity_id','id');
create trigger opportunity_email_threads_same_company before insert or update of opportunity_id,connection_id on public.opportunity_email_threads for each row execute function public.require_same_company_opportunity_email_thread();
