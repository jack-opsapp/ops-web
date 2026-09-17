-- Canpro "Picket Rail — Level" acceptance proof for
-- 20260917010000_estimate_accept_refuses_missing_counts.sql.
--
-- LOCAL proving Postgres only (~/.ops-local-pg). Runs unchanged against a clone
-- WITHOUT the migration (before) and a clone WITH it (after); every case is
-- captured, nothing stops on a refusal, and the whole run ends in ROLLBACK.
-- Acceptance runs as `anon` with the synthetic Canpro operator's JWT subject,
-- the way the iOS app reaches PostgREST.
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=<db>" -v ON_ERROR_STOP=1 -f canpro-proof.sql
\set ON_ERROR_STOP 1
\pset footer off
begin;

select current_database() as database,
       (to_regprocedure('private.assert_estimate_accept_recipe_counts(uuid)') is not null) as migration_applied,
       md5(prosrc) as accept_estimate_to_job_md5
  from pg_proc where oid = 'public.accept_estimate_to_job(uuid,text)'::regprocedure;

-- Scenario A (docs/artifacts/canpro-recipe-test/scenario-A-options.json):
-- Black / Side mount / 42" / 3" lag, Left ends 1, Right ends 1, Corners 1,
-- 45° corners 0, Wall returns 0.
create function pg_temp.scenario_a() returns jsonb language sql immutable as $$
  select '{"faff8b46-c783-4267-b414-a74c6220b914":"8a417951-1351-4c7e-bc7d-ffb980dd2cf7",
           "154a3ea9-6ce7-4be1-9880-2f7fc929b0bf":"fbc6fbb1-c364-4060-b071-2a89f21b886f",
           "d7e68376-f083-4fd3-b63b-3123fafe5ee4":"d3fad1da-a112-431e-9d59-f0606100f458",
           "f33f9daf-e2e3-40aa-898b-dbfdc7c4b18f":"dff39513-8d9f-42e9-ab9d-bb96c3c1e5b4",
           "3b9c6b74-f889-4027-9752-fe1cd3f838de":1,
           "97cc24bb-1035-45f1-b070-6100fce716f7":1,
           "20a023c9-500e-4cf9-96a3-f518d9cee078":1,
           "fc1bafc4-0fe8-4012-8b85-ef974e9d43b3":0,
           "f1594fb3-92f2-4750-9f7c-c44ebfa49fe6":0}'::jsonb
$$;

-- One opportunity + draft estimate + one line per case. p_product null = a
-- custom line with no product.
create function pg_temp.canpro_case(p_case text, p_product uuid, p_options jsonb)
returns uuid language sql as $$
  insert into public.opportunities (id, company_id, client_id, title)
  values (('66666666-6666-4666-8666-0000000000' || p_case)::uuid, 'a612edc0-5c18-4c4d-af97-55b9410dd077',
          '33333333-3333-4333-8333-333333333333', 'Canpro acceptance proof ' || p_case);
  insert into public.estimates (id, company_id, client_id, opportunity_id, estimate_number, title, status)
  values (('44444444-4444-4444-8444-0000000000' || p_case)::uuid, 'a612edc0-5c18-4c4d-af97-55b9410dd077',
          '33333333-3333-4333-8333-333333333333', ('66666666-6666-4666-8666-0000000000' || p_case)::uuid,
          'PROOF-' || p_case, 'Canpro acceptance proof ' || p_case, 'draft');
  insert into public.line_items (id, company_id, estimate_id, product_id, name, quantity, unit_price, type, sort_order, configured_options)
  values (('55555555-5555-4555-8555-0000000000' || p_case)::uuid, 'a612edc0-5c18-4c4d-af97-55b9410dd077',
          ('44444444-4444-4444-8444-0000000000' || p_case)::uuid, p_product,
          coalesce((select name from public.products where id = p_product), 'Site cleanup'),
          20, 70, 'LABOR', 0, p_options)
  returning estimate_id
$$;

select pg_temp.canpro_case('0a', '3efc9582-ac59-4f13-919e-c1b3e3495cc3', pg_temp.scenario_a()) as a_all_counts,
       pg_temp.canpro_case('0b', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
         pg_temp.scenario_a() - '20a023c9-500e-4cf9-96a3-f518d9cee078') as b_corners_removed,
       pg_temp.canpro_case('0c', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
         pg_temp.scenario_a() - array['3b9c6b74-f889-4027-9752-fe1cd3f838de', '97cc24bb-1035-45f1-b070-6100fce716f7',
                                      '20a023c9-500e-4cf9-96a3-f518d9cee078', 'fc1bafc4-0fe8-4012-8b85-ef974e9d43b3',
                                      'f1594fb3-92f2-4750-9f7c-c44ebfa49fe6']) as c_all_counts_removed,
       pg_temp.canpro_case('0d', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
         pg_temp.scenario_a() || '{"20a023c9-500e-4cf9-96a3-f518d9cee078": 0}') as d_corners_zero,
       pg_temp.canpro_case('0e', '8c46b666-d8db-4cfa-8d61-4fa8ab49e733', null) as e_no_recipe_product;

create temp table outcomes (
  step integer generated always as identity,
  label text not null,
  estimate_id uuid not null,
  accepted boolean not null,
  response jsonb,
  sqlstate text,
  message text,
  detail text,
  hint text
) on commit drop;
grant select, insert on outcomes to anon;

create function pg_temp.accept(p_label text, p_case text) returns void language plpgsql as $$
declare
  v_estimate uuid := ('44444444-4444-4444-8444-0000000000' || p_case)::uuid;
  v_response jsonb;
  v_state text; v_message text; v_detail text; v_hint text;
begin
  begin
    v_response := public.accept_estimate_to_job(v_estimate, 'canpro-proof-' || p_case);
    insert into outcomes (label, estimate_id, accepted, response) values (p_label, v_estimate, true, v_response);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
                            v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    insert into outcomes (label, estimate_id, accepted, sqlstate, message, detail, hint)
    values (p_label, v_estimate, false, v_state, v_message, v_detail, v_hint);
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"anon"}';
set local role anon;
do $run$
begin
  perform pg_temp.accept('(a) all counts entered', '0a');
  perform pg_temp.accept('(b) Corners removed', '0b');
  perform pg_temp.accept('(c) every integer count removed', '0c');
  perform pg_temp.accept('(d) Corners explicitly 0', '0d');
  perform pg_temp.accept('(e) no recipe products', '0e');
  perform pg_temp.accept('(f) replay of (a), same key', '0a');
end
$run$;
reset role;

\echo
\echo === OUTCOMES
select step, label, accepted,
       (response ->> 'idempotent_replay')::boolean as replay,
       response ->> 'inventory_mode' as mode,
       jsonb_array_length(response -> 'warnings') as warnings,
       jsonb_array_length(response -> 'demand_ids') as demand_ids,
       sqlstate, hint
  from outcomes order by step;

\echo
\echo === REFUSAL TEXT (the iOS banner reads MESSAGE verbatim)
select label, message from outcomes where not accepted order by step;

\echo
\echo === REFUSAL DETAIL (b)
select jsonb_pretty(detail::jsonb) as detail from outcomes where label = '(b) Corners removed' and not accepted;

\echo
\echo === (a) / (d) DEMANDS, grouped the way scenario.sql groups them
select o.label,
       coalesce(ci.name, '?') as family,
       (select string_agg(ov.value, ' / ' order by opt.sort_order)
          from public.catalog_variant_option_values vov
          join public.catalog_option_values ov on ov.id = vov.option_value_id
          join public.catalog_options opt on opt.id = ov.option_id
         where vov.variant_id = cv.id and vov.deleted_at is null) as variant,
       sum(d.required_quantity) as required
  from outcomes o
  join public.project_material_demands d on d.estimate_id = o.estimate_id and d.deleted_at is null
  left join public.catalog_variants cv on cv.id = d.catalog_variant_id
  left join public.catalog_items ci on ci.id = cv.catalog_item_id
 where o.accepted and not coalesce((o.response ->> 'idempotent_replay')::boolean, false)
   and o.label in ('(a) all counts entered', '(d) Corners explicitly 0')
 group by 1, 2, 3
 order by 1, 2, 3;

\echo
\echo === (b) / (c) WHAT A CALL LEFT BEHIND (before the migration: a whole job; after: all zero, draft, stage new_lead)
select o.label,
       (select count(*) from public.projects p
         where p.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
           and p.opportunity_id = e.opportunity_id::text) as projects,
       (select count(*) from public.project_tasks t where t.source_estimate_id = e.id::text) as tasks,
       (select count(*) from public.project_material_demands d where d.estimate_id = e.id) as demands,
       (select count(*) from public.project_material_snapshots s where s.estimate_id = e.id) as snapshots,
       (select count(*) from public.accept_estimate_to_job_requests r where r.estimate_id = e.id) as acceptance_requests,
       (select count(*) from public.stage_transitions st where st.opportunity_id = e.opportunity_id) as stage_transitions,
       (select count(*) from public.notifications n
         where n.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077' and n.created_at >= now()) as notifications_this_txn,
       e.status as estimate_status,
       e.approved_at is not null as approved,
       e.project_ref is not null as has_project,
       op.stage as opportunity_stage
  from outcomes o
  join public.estimates e on e.id = o.estimate_id
  join public.opportunities op on op.id = e.opportunity_id
 where o.label in ('(b) Corners removed', '(c) every integer count removed')
 order by o.step;

\echo
\echo === (e) NORMALISED RESPONSE (compare the md5 across the before and after runs)
select label,
       md5(norm::text) as normalised_md5,
       norm
  from (
    select o.label,
           jsonb_build_object(
             'ok', o.response -> 'ok',
             'inventory_mode', o.response -> 'inventory_mode',
             'warnings', o.response -> 'warnings',
             'overruns', o.response -> 'overruns',
             'missing_mappings', o.response -> 'missing_mappings',
             'demand_count', jsonb_array_length(o.response -> 'demand_ids'),
             'project_created', o.response -> 'project_task_result' -> 'project_created',
             'project_task_count', o.response -> 'project_task_result' -> 'project_task_count',
             'booking_persistence_reason', o.response -> 'booking_projection_result' -> 'booking_persistence_reason',
             'material_demand_performed', o.response -> 'booking_projection_result' -> 'material_demand_performed'
           ) as norm
      from outcomes o
     where o.label = '(e) no recipe products'
  ) s;

\echo
\echo === (f) REPLAY
select a.response ->> 'project_id' = f.response ->> 'project_id' as same_project,
       (f.response ->> 'idempotent_replay')::boolean as replay_flag,
       (select count(*) from public.accept_estimate_to_job_requests r
         where r.estimate_id = a.estimate_id and r.status = 'completed') as completed_requests
  from outcomes a join outcomes f on f.estimate_id = a.estimate_id
 where a.label = '(a) all counts entered' and f.label = '(f) replay of (a), same key';

rollback;
