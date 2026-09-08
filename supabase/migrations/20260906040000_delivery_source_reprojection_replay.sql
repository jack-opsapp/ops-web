-- Preserve idempotent delivery-source replay after normalization repair.
--
-- Migration 20260830113400 intentionally retained the capture-time evidence
-- hash while updating only the readable text projection. A later capture of
-- the same source bytes therefore computes the new projection hash and must
-- not compare it to that immutable historical hash. Every source-envelope
-- field is already compared directly before this branch, so removing this
-- redundant digest comparison preserves conflict detection for changed bytes.

do $repair$
declare
  v_function regprocedure := (
    'public.capture_agent_provider_delivery_source_as_system('
      || 'uuid,uuid,text,text,text,text,timestamptz,text,text,text,text,text,'
      || 'text,text[],text[],text,text,text,text,text,text,text,text,uuid,'
      || 'boolean,jsonb)'
  )::regprocedure;
  v_definition text;
  v_old text := $old$
         or (
           -- The stored digest covers the projection, so it can only be
           -- compared byte-exactly while the projection stands still. The
           -- re-projection arm below deliberately leaves the digest at its
           -- capture-time value: it is the tenant hash key that immutable
           -- job conversation turns reference.
           not v_projection_drift
           and v_existing_source.source_sha256 is distinct from v_source_sha256
         )$old$;
begin
  select pg_catalog.pg_get_functiondef(v_function)
    into v_definition;

  if v_definition is null
     or pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(
       pg_catalog.substr(
         v_definition,
         pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)
       ),
       v_old
     ) > 0 then
    raise exception 'delivery_source_reprojection_replay_source_drift'
      using errcode = '55000';
  end if;

  execute pg_catalog.replace(v_definition, v_old, '');
end;
$repair$;
