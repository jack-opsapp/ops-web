-- The default strip is ledgered and reversible, and a refusal reaches the app
-- as readable text. LOCAL proving Postgres only, migration applied; ends in
-- ROLLBACK.
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=<db>" -v ON_ERROR_STOP=1 -f ledger-proof.sql
\set ON_ERROR_STOP 1
\pset footer off
begin;

\echo === LEDGER
select product_option_id, option_name, option_kind, default_value_before, updated_at_before
  from private.integer_option_defaults_cleared_20260917
 order by option_name;

\echo === PRODUCT OPTIONS NOW (selects keep their defaults, counts carry none)
select name, kind, required, affects_recipe, default_value
  from public.product_options
 where product_id = '3efc9582-ac59-4f13-919e-c1b3e3495cc3'
 order by sort_order;

\echo === APP ROLES CANNOT READ THE LEDGER
select role_name, has_table_privilege(role_name, 'private.integer_option_defaults_cleared_20260917', 'select') as can_select
  from unnest(array['anon', 'authenticated', 'service_role']) as role_name;

\echo === REVERSAL (the statement in the migration header), inside this rolled-back transaction
update public.product_options o
   set default_value = l.default_value_before
  from private.integer_option_defaults_cleared_20260917 l
 where o.id = l.product_option_id and o.default_value is null;
select name, default_value
  from public.product_options
 where product_id = '3efc9582-ac59-4f13-919e-c1b3e3495cc3' and kind = 'integer'
 order by sort_order;

\echo === THE ERROR BODY POSTGREST SENDS FOR A REFUSAL (keys as PostgREST names them)
set local session_replication_role = replica;
insert into public.opportunities (id, company_id, client_id, title)
values ('66666666-6666-4666-8666-0000000000e1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '33333333-3333-4333-8333-333333333333', 'Error body proof');
insert into public.estimates (id, company_id, client_id, opportunity_id, estimate_number, title, status)
values ('44444444-4444-4444-8444-0000000000e1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '33333333-3333-4333-8333-333333333333', '66666666-6666-4666-8666-0000000000e1',
        'ERR-BODY', 'Error body proof', 'draft');
insert into public.line_items (id, company_id, estimate_id, product_id, name, quantity, unit_price, type, sort_order, configured_options)
values ('55555555-5555-4555-8555-0000000000e1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '44444444-4444-4444-8444-0000000000e1', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
        'Picket Rail — Level', 40, 70, 'LABOR', 0,
        '{"3b9c6b74-f889-4027-9752-fe1cd3f838de": 1, "97cc24bb-1035-45f1-b070-6100fce716f7": 1,
          "fc1bafc4-0fe8-4012-8b85-ef974e9d43b3": 0}');
set local session_replication_role = origin;
create temp table error_body (body jsonb) on commit drop;
grant insert, select on error_body to anon;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"anon"}';
set local role anon;
do $body$
declare v_state text; v_message text; v_detail text; v_hint text;
begin
  perform public.accept_estimate_to_job('44444444-4444-4444-8444-0000000000e1', 'error-body-proof');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
                          v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  insert into error_body values (jsonb_build_object(
    'code', v_state, 'message', v_message, 'details', v_detail, 'hint', v_hint));
end
$body$;
reset role;
select body ->> 'code' as code, body ->> 'hint' as hint, body ->> 'message' as message from error_body;
select jsonb_pretty((body ->> 'details')::jsonb) as details from error_body;

rollback;
