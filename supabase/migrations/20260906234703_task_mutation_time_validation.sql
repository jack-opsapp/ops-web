-- Repair the canonical task RPC's validation of native time columns.
-- Source fingerprint prevents overwriting an independently changed function.
begin;
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('private.update_task_with_event_for_actor(uuid,uuid,timestamptz,jsonb)'::regprocedure);
  if md5(definition) <> '6511f1a0732408c8ef45d94c729c7d31' then
    raise exception 'TASK_MUTATION_TIME_SOURCE_CHANGED';
  end if;
  definition := replace(definition, 'v_next.start_time !~', 'v_next.start_time::text !~');
  definition := replace(definition, 'v_next.end_time !~', 'v_next.end_time::text !~');
  execute definition;
end;
$migration$;
commit;
