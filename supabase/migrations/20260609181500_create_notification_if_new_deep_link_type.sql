begin;

-- Lead/opportunity lifecycle notifications must carry a routable deep_link_type
-- so clients (iOS + web) never have to join email_threads at tap time. The
-- direct-insert builders (opportunity-lifecycle-action-service,
-- lead-lifecycle-cron-service) already stamp deep_link_type; this teaches the
-- dedup RPC — the path the inbox thread-classification notifications take — to
-- accept and persist it too.
--
-- The new parameter is appended with a default, but we DROP the prior 9-arg
-- signature first. Leaving it in place would make a call with the original nine
-- named arguments ambiguous between the old function and the new one (both
-- would be candidates because the tenth argument has a default).

drop function if exists public.create_notification_if_new(text, text, text, text, text, boolean, text, text, text);

create or replace function public.create_notification_if_new(
  p_user_id text,
  p_company_id text,
  p_type text,
  p_title text,
  p_body text,
  p_persistent boolean default false,
  p_action_url text default null,
  p_action_label text default null,
  p_project_id text default null,
  p_deep_link_type text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (
    user_id,
    company_id,
    type,
    title,
    body,
    is_read,
    persistent,
    action_url,
    action_label,
    project_id,
    deep_link_type
  )
  values (
    p_user_id,
    p_company_id,
    p_type,
    p_title,
    p_body,
    false,
    p_persistent,
    p_action_url,
    p_action_label,
    p_project_id,
    p_deep_link_type
  )
  on conflict do nothing;
end;
$$;

-- The DROP discarded the old function's explicit grants; restore them so the
-- service-role cron, the authenticated client, and the Firebase-bridged anon
-- role can all keep firing notifications.
grant execute on function public.create_notification_if_new(
  text, text, text, text, text, boolean, text, text, text, text
) to anon, authenticated, service_role;

do $$
declare
  v_reg regprocedure;
  v_functiondef text;
begin
  -- to_regprocedure returns NULL (instead of throwing) when the signature is
  -- absent, so the missing-function guard below is actually reachable.
  v_reg := to_regprocedure(
    'public.create_notification_if_new(text, text, text, text, text, boolean, text, text, text, text)'
  );
  if v_reg is null then
    raise exception 'create_notification_if_new_deep_link_sentinel: 10-arg create_notification_if_new is missing';
  end if;

  v_functiondef := pg_get_functiondef(v_reg);

  -- Assert the bare `deep_link_type` COLUMN is written, not merely the
  -- `p_deep_link_type` parameter. The regex matches the column token only when
  -- it is NOT preceded by `_` (which would make it part of the param name), so
  -- a future edit that declares the param but drops the insert column fails here.
  if v_functiondef !~ '[^_]deep_link_type' then
    raise exception 'create_notification_if_new_deep_link_sentinel: insert does not write the deep_link_type column';
  end if;

  if v_functiondef not ilike '%on conflict do nothing%' then
    raise exception 'create_notification_if_new_deep_link_sentinel: create_notification_if_new lost conflict-do-nothing dedup';
  end if;
end $$;

commit;
