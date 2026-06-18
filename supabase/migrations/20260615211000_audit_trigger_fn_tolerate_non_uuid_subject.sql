-- audit_trigger_fn: tolerate a non-uuid request.jwt subject.
--
-- public.audit_trigger_fn() (the shared SECURITY DEFINER audit trigger on
-- estimates, invoices, payments) recorded changed_by as a bare
-- (auth.jwt() ->> 'sub')::uuid. Post crit3_phase_c the 'sub' claim is the
-- Firebase subject (a non-uuid) for every bridged client session AND for the
-- synthetic QBO estimate-acceptance actor (set by
-- accept_estimate_to_job_from_quickbooks). The bare cast raised 22P02
-- ("invalid input syntax for type uuid") and aborted the whole write -- which
-- is why QBO acceptance failed on the estimates status update with
-- integration_acceptance_bridge_failed even after the actor-subject fix
-- (20260615210000), and why any Firebase-subject write to these three audited
-- tables would fail.
--
-- FIX: record the subject only when it is uuid-shaped (the legacy Supabase
-- auth.users id, or the null service-role subject); otherwise record NULL.
-- audit_log.changed_by is nullable with no FK, so NULL is safe. Behavior is
-- UNCHANGED for uuid and null subjects -- this only removes the throw for
-- non-uuid subjects. Idempotent + sentinel-guarded.

begin;

create or replace function public.audit_trigger_fn()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  -- crit3: 'sub' is the Firebase subject (non-uuid) for bridged sessions and the
  -- synthetic acceptance actor. Cast only when uuid-shaped (legacy auth.users
  -- id); otherwise NULL, so the audited write is never aborted by a 22P02.
  v_changed_by uuid := case
    when nullif(auth.jwt() ->> 'sub', '') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (auth.jwt() ->> 'sub')::uuid
    else null
  end;
begin
  if tg_op = 'INSERT' then
    insert into audit_log (table_name, record_id, company_id, action, new_data, changed_by)
    values (tg_table_name, new.id, new.company_id, 'INSERT', to_jsonb(new), v_changed_by);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into audit_log (table_name, record_id, company_id, action, old_data, new_data, changed_by)
    values (tg_table_name, new.id, new.company_id, 'UPDATE', to_jsonb(old), to_jsonb(new), v_changed_by);
    return new;
  elsif tg_op = 'DELETE' then
    insert into audit_log (table_name, record_id, company_id, action, old_data, changed_by)
    values (tg_table_name, old.id, old.company_id, 'DELETE', to_jsonb(old), v_changed_by);
    return old;
  end if;
  return null;
end;
$function$;

-- Sentinel: assert the guard is in place and the function is still definer.
do $do$
declare
  v_def text := pg_get_functiondef('public.audit_trigger_fn()'::regprocedure);
  v_secdef boolean;
begin
  select prosecdef into v_secdef from pg_proc where oid = 'public.audit_trigger_fn()'::regprocedure;
  if v_secdef is distinct from true then
    raise exception 'audit_trigger_non_uuid_subject_sentinel: audit_trigger_fn is not SECURITY DEFINER';
  end if;
  if v_def not like '%v_changed_by%' then
    raise exception 'audit_trigger_non_uuid_subject_sentinel: changed_by is not routed through the guarded variable';
  end if;
  if v_def not like '%[0-9a-fA-F]{8}-%' then
    raise exception 'audit_trigger_non_uuid_subject_sentinel: uuid-shape guard missing';
  end if;
end
$do$;

commit;
