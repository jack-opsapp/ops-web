-- The two refusals as PostgREST serialises them (code, message, details, hint),
-- and proof that the catalogue defaults are untouched. LOCAL proving Postgres
-- only, migration applied; ends in ROLLBACK.
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=<db>" -v ON_ERROR_STOP=1 -f refusal-body-proof.sql
\set ON_ERROR_STOP 1
\pset footer off
begin;

\echo === CATALOGUE DEFAULTS (unchanged by step 1)
select name, kind, required, default_value
  from public.product_options
 where product_id = '3efc9582-ac59-4f13-919e-c1b3e3495cc3'
 order by sort_order;

\echo === HOLD SWITCH AS INSTALLED
select private.estimate_recipe_count_hold_active() as hold_active;

-- A 40 ft run: Left and Right ends 1, 45° corners 0, Corners and Wall returns blank.
set local session_replication_role = replica;
insert into public.opportunities (id, company_id, client_id, title)
values ('66666666-6666-4666-8666-0000000000e1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '33333333-3333-4333-8333-333333333333', 'Refusal body proof');
insert into public.estimates (id, company_id, client_id, opportunity_id, estimate_number, title, status)
values ('44444444-4444-4444-8444-0000000000e1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '33333333-3333-4333-8333-333333333333', '66666666-6666-4666-8666-0000000000e1',
        'REFUSAL-BODY', 'Refusal body proof', 'draft');
insert into public.line_items (id, company_id, estimate_id, product_id, name, quantity, unit_price, type, sort_order, configured_options)
values ('55555555-5555-4555-8555-0000000000e1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '44444444-4444-4444-8444-0000000000e1', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
        'Picket Rail — Level', 40, 70, 'LABOR', 0,
        '{"3b9c6b74-f889-4027-9752-fe1cd3f838de": 1, "97cc24bb-1035-45f1-b070-6100fce716f7": 1,
          "fc1bafc4-0fe8-4012-8b85-ef974e9d43b3": 0}');
set local session_replication_role = origin;

create temp table error_body (refusal text, body jsonb) on commit drop;
grant insert, select on error_body to anon;

create function pg_temp.capture(p_refusal text) returns void language plpgsql as $$
declare v_state text; v_message text; v_detail text; v_hint text;
begin
  perform public.accept_estimate_to_job('44444444-4444-4444-8444-0000000000e1', 'refusal-body-proof');
  insert into error_body values (p_refusal, jsonb_build_object('accepted', true));
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
                          v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  insert into error_body values (p_refusal, jsonb_build_object(
    'code', v_state, 'message', v_message, 'details', v_detail, 'hint', v_hint));
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"anon"}';
set local role anon;
select pg_temp.capture('hold on');
reset role;

create or replace function private.estimate_recipe_count_hold_active()
returns boolean language sql stable set search_path = '' as $function$ select false $function$;
set local role anon;
select pg_temp.capture('hold off');
reset role;

\echo === REFUSALS
select refusal, body ->> 'code' as code, body ->> 'hint' as hint, body ->> 'message' as message
  from error_body order by refusal desc;
select refusal, jsonb_pretty((body ->> 'details')::jsonb) as details
  from error_body order by refusal desc;

rollback;
