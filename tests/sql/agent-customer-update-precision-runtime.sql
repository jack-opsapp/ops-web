\set ON_ERROR_STOP on
set timezone='UTC';
set request.jwt.claim.role='service_role';
select runtime.assert(runtime.read_version()='2026-08-11T15:55:03.630086Z', 'identity preserves the exact microsecond version');
do $$ declare request jsonb; begin
  request:=jsonb_set(runtime.request('{"title":"Fixture lead"}', 'precision-nochange-001'),'{expected_updated_at}',to_jsonb(runtime.read_version()));
  perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',request), 'AGENT_CUSTOMER_UPDATE_NO_CHANGE', 'fresh read reaches the real no-change guard');
  request:=jsonb_set(request,'{expected_updated_at}',to_jsonb('2026-08-11T08:55:03.630086-07:00'::text));
  perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',request), 'AGENT_CUSTOMER_UPDATE_NO_CHANGE', 'equivalent precise offset version remains valid');
  request:=jsonb_set(request,'{expected_updated_at}',to_jsonb(runtime.read_version()));
  update public.opportunities set updated_at='2026-08-11T15:55:03.630087Z' where id='30000000-0000-4000-8000-000000000001';
  perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',request), 'AGENT_CUSTOMER_UPDATE_SOURCE_STALE', 'one-microsecond concurrent change remains stale');
  update public.opportunities set updated_at='2026-08-11T15:55:03.630086Z' where id='30000000-0000-4000-8000-000000000001';
  request:=jsonb_set(request,'{expected_updated_at}',to_jsonb('2026-08-11T15:55:03.630Z'::text));
  perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',request), 'AGENT_CUSTOMER_UPDATE_SOURCE_STALE', 'rounded source versions still fail closed');
end $$;
-- A changed synthetic request must also prepare successfully with the reader's
-- exact version. Roll back its preview before checking no-change invariants.
begin;
do $$ declare preview jsonb; begin
  preview:=runtime.prepare(jsonb_set(runtime.request('{"title":"Updated fixture title"}', 'precision-preview-001'),'{expected_updated_at}',to_jsonb(runtime.read_version())));
  perform runtime.assert(preview->>'status'='approval_required' and (preview#>>'{proposal,before,updated_at}')::timestamptz='2026-08-11T15:55:03.630086Z'::timestamptz, 'exact read version prepares a real synthetic preview');
  perform runtime.assert(preview#>>'{proposal,after,title}'='Updated fixture title' and (select title='Fixture lead' from public.opportunities where id='30000000-0000-4000-8000-000000000001'), 'preparation leaves the business title unchanged');
end $$;
rollback;
select runtime.assert((select count(*)=0 from private.agent_customer_updates), 'no change sets created');
select runtime.assert((select count(*)=0 from public.agent_actions), 'no approval actions created');
select runtime.assert((select md5(to_jsonb(o)::text)=(select digest from runtime.source_before) from public.opportunities o where id='30000000-0000-4000-8000-000000000001'), 'business row unchanged');
select runtime.assert((select (p.proowner,p.proacl,p.proconfig,p.prosecdef,p.provolatile) is not distinct from (i.proowner,i.proacl,i.proconfig,i.prosecdef,i.provolatile) from runtime.invariants i join pg_proc p using(oid)), 'function identity and security preserved');
select runtime.assert(private.agent_rfc3339_utc('2026-08-11T15:55:03.630086Z')='2026-08-11T15:55:03.630Z', 'shared millisecond formatter unchanged');
