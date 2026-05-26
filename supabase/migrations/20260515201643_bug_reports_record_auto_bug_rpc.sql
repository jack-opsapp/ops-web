begin;

-- record_auto_bug: SECURITY DEFINER RPC the iOS AutoBugReporter calls when a
-- silent-catch site fires. Dedupes via the partial unique index added in the
-- previous migration; increments times_reported on re-fire of an active row.
-- Pgcrypto is already enabled in this project (extensions schema); digest()
-- is referenced unqualified so it resolves via the function's search_path.

create extension if not exists pgcrypto;

create or replace function public.record_auto_bug(
  p_category text,
  p_priority text,
  p_screen text,
  p_suspected_file text,
  p_error_code text,
  p_summary text,
  p_metadata jsonb,
  p_app_version text,
  p_build_number text,
  p_os_version text,
  p_device_model text,
  p_network_type text
) returns jsonb
language plpgsql security definer
set search_path = 'public', 'extensions', 'pg_temp'
as $$
declare
  v_user_id uuid;
  v_company_id uuid;
  v_user_email text;
  v_dedupe_key text;
  v_existing_id uuid;
  v_new_count integer;
begin
  v_user_id := private.get_current_user_id();
  v_company_id := private.get_user_company_id();
  if v_user_id is null or v_company_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select email into v_user_email from public.users where id = v_user_id;

  v_dedupe_key := 'auto:' || encode(
    digest(
      coalesce(p_category, '_') || ':' ||
      coalesce(p_screen, '_') || ':' ||
      coalesce(p_suspected_file, '_') || ':' ||
      coalesce(p_error_code, '_'),
      'sha256'
    ),
    'hex'
  );

  select id into v_existing_id
  from public.bug_reports
  where company_id = v_company_id
    and dedupe_key = v_dedupe_key
    and status in ('new', 'triaged', 'in_progress')
  limit 1;

  if v_existing_id is not null then
    update public.bug_reports
       set times_reported   = times_reported + 1,
           last_reported_at = now(),
           updated_at       = now()
     where id = v_existing_id
     returning times_reported into v_new_count;

    return jsonb_build_object(
      'id', v_existing_id,
      'created', false,
      'times_reported', v_new_count
    );
  end if;

  insert into public.bug_reports (
    company_id, reporter_id, reporter_email, reporter_name,
    description, category, priority, platform, screen_name,
    app_version, build_number, os_version, os_name, device_model, network_type,
    custom_metadata, status, dedupe_key, times_reported, last_reported_at
  ) values (
    v_company_id, v_user_id, v_user_email, 'OPS iOS (auto-filed)',
    p_summary, p_category, p_priority, 'ios', p_screen,
    p_app_version, p_build_number, p_os_version, 'iOS', p_device_model, p_network_type,
    p_metadata, 'new', v_dedupe_key, 1, now()
  )
  returning id into v_existing_id;

  return jsonb_build_object(
    'id', v_existing_id,
    'created', true,
    'times_reported', 1
  );
end;
$$;

grant execute on function public.record_auto_bug(
  text, text, text, text, text, text, jsonb, text, text, text, text, text
) to authenticated;

commit;
