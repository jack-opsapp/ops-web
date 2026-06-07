begin;

drop index if exists public.idx_notifications_unread_dedup;

create unique index if not exists idx_notifications_unread_dedup
  on public.notifications (
    user_id,
    company_id,
    type,
    coalesce(dedupe_key, title)
  )
  where is_read = false
    and resolved_at is null;

create or replace function public.create_notification_if_new(
  p_user_id text,
  p_company_id text,
  p_type text,
  p_title text,
  p_body text,
  p_persistent boolean default false,
  p_action_url text default null,
  p_action_label text default null,
  p_project_id text default null
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
    project_id
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
    p_project_id
  )
  on conflict do nothing;
end;
$$;

do $$
declare
  v_indexdef text;
  v_functiondef text;
begin
  select indexdef
  into v_indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'notifications'
    and indexname = 'idx_notifications_unread_dedup';

  if v_indexdef is null
     or v_indexdef not ilike '%COALESCE(dedupe_key, title)%'
     or v_indexdef not ilike '%resolved_at IS NULL%' then
    raise exception 'notifications_dedupe_key_scope_sentinel: notification dedupe index is not dedupe_key scoped';
  end if;

  select pg_get_functiondef('public.create_notification_if_new(text, text, text, text, text, boolean, text, text, text)'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%on conflict do nothing%' then
    raise exception 'notifications_dedupe_key_scope_sentinel: create_notification_if_new is not conflict-target agnostic';
  end if;
end $$;

commit;
