-- Canpro "Picket Rail — Level" acceptance proof for
-- 20260917010000_estimate_accept_refuses_missing_counts.sql (step 1: hold +
-- missing-count check).
--
-- LOCAL proving Postgres only (~/.ops-local-pg). Runs unchanged against a clone
-- WITHOUT the migration (before) and a clone WITH it (after); every case is
-- captured, nothing stops on a refusal, and the whole run ends in ROLLBACK.
-- Acceptance runs as `anon` with the synthetic Canpro operator's JWT subject,
-- the way the iOS app reaches PostgREST.
--
-- Phases (the hold switch is only touched when the migration is installed):
--   1. hold on, as installed;
--   2. hold off — the switch redefined to `select false`, as step 3 will — the
--      full missing-count matrix, re-using phase 1's keys;
--   3. hold back on — an estimate accepted in phase 2 replays.
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=<db>" -v ON_ERROR_STOP=1 -f canpro-proof.sql
\set ON_ERROR_STOP 1
\pset footer off
begin;

select current_database() as database,
       (to_regprocedure('private.assert_estimate_accept_recipe_counts(uuid)') is not null) as migration_applied,
       md5(prosrc) as accept_estimate_to_job_md5
  from pg_proc where oid = 'public.accept_estimate_to_job(uuid,text)'::regprocedure;

select name, kind, default_value
  from public.product_options
 where product_id = '3efc9582-ac59-4f13-919e-c1b3e3495cc3' and kind = 'integer'
 order by sort_order;

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

-- One opportunity + draft estimate + one line per case.
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

select pg_temp.canpro_case('0a', '3efc9582-ac59-4f13-919e-c1b3e3495cc3', pg_temp.scenario_a()) as all_counts,
       pg_temp.canpro_case('0b', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
         pg_temp.scenario_a() - '20a023c9-500e-4cf9-96a3-f518d9cee078') as corners_removed,
       pg_temp.canpro_case('0c', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
         pg_temp.scenario_a() - array['3b9c6b74-f889-4027-9752-fe1cd3f838de', '97cc24bb-1035-45f1-b070-6100fce716f7',
                                      '20a023c9-500e-4cf9-96a3-f518d9cee078', 'fc1bafc4-0fe8-4012-8b85-ef974e9d43b3',
                                      'f1594fb3-92f2-4750-9f7c-c44ebfa49fe6']) as all_counts_removed,
       pg_temp.canpro_case('0d', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
         pg_temp.scenario_a() || '{"20a023c9-500e-4cf9-96a3-f518d9cee078": 0}') as corners_zero,
       pg_temp.canpro_case('0e', '8c46b666-d8db-4cfa-8d61-4fa8ab49e733', null) as no_count_driven_product,
       pg_temp.canpro_case('0f', '3efc9582-ac59-4f13-919e-c1b3e3495cc3', pg_temp.scenario_a()) as count_added_later;

create temp table outcomes (
  step integer generated always as identity,
  hold text not null,
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
  v_hold text := 'n/a';
  v_response jsonb;
  v_state text; v_message text; v_detail text; v_hint text;
begin
  -- Dynamic, so the script also runs where the migration is not installed.
  if to_regprocedure('private.estimate_recipe_count_hold_active()') is not null then
    execute 'select private.estimate_recipe_count_hold_active()::text' into v_hold;
  end if;
  begin
    v_response := public.accept_estimate_to_job(v_estimate, 'canpro-proof-' || p_case);
    insert into outcomes (hold, label, estimate_id, accepted, response) values (v_hold, p_label, v_estimate, true, v_response);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
                            v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    insert into outcomes (hold, label, estimate_id, accepted, sqlstate, message, detail, hint)
    values (v_hold, p_label, v_estimate, false, v_state, v_message, v_detail, v_hint);
  end;
end;
$$;

-- Redefines the hold switch, only where the migration installed it.
create function pg_temp.set_hold(p_on boolean) returns void language plpgsql as $$
begin
  if to_regprocedure('private.estimate_recipe_count_hold_active()') is not null then
    execute format(
      'create or replace function private.estimate_recipe_count_hold_active() returns boolean '
      'language sql stable set search_path = '''' as $b$ select %s $b$',
      case when p_on then 'true' else 'false' end);
  end if;
end;
$$;

create function pg_temp.residue(p_case text) returns jsonb language sql as $$
  select jsonb_build_object(
    'projects', (select count(*) from public.projects p
                  where p.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
                    and p.opportunity_id = ('66666666-6666-4666-8666-0000000000' || p_case)),
    'tasks', (select count(*) from public.project_tasks t
               where t.source_estimate_id = ('44444444-4444-4444-8444-0000000000' || p_case)),
    'demands', (select count(*) from public.project_material_demands d
                 where d.estimate_id = ('44444444-4444-4444-8444-0000000000' || p_case)::uuid),
    'snapshots', (select count(*) from public.project_material_snapshots s
                   where s.estimate_id = ('44444444-4444-4444-8444-0000000000' || p_case)::uuid),
    'acceptance_requests', (select count(*) from public.accept_estimate_to_job_requests r
                             where r.estimate_id = ('44444444-4444-4444-8444-0000000000' || p_case)::uuid),
    'stage_transitions', (select count(*) from public.stage_transitions st
                           where st.opportunity_id = ('66666666-6666-4666-8666-0000000000' || p_case)::uuid),
    'notifications_this_txn', (select count(*) from public.notifications n
                                where n.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077' and n.created_at >= now()),
    'estimate', (select e.status || '/' || case when e.approved_at is null then 'unapproved' else 'approved' end
                        || '/' || case when e.project_ref is null then 'no project' else 'project' end
                   from public.estimates e where e.id = ('44444444-4444-4444-8444-0000000000' || p_case)::uuid),
    'opportunity_stage', (select op.stage from public.opportunities op
                           where op.id = ('66666666-6666-4666-8666-0000000000' || p_case)::uuid)
  )
$$;
create temp table residues (label text primary key, residue jsonb) on commit drop;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"anon"}';

-- Phase 1: hold on.
set local role anon;
do $run$
begin
  perform pg_temp.accept('(a) all counts entered', '0a');
  perform pg_temp.accept('(b) Corners removed', '0b');
  perform pg_temp.accept('(c) no count-driven product', '0e');
  perform pg_temp.accept('(d) replay of (c), same key', '0e');
end
$run$;
reset role;
insert into residues values ('(a) hold refusal', pg_temp.residue('0a')), ('(b) hold refusal', pg_temp.residue('0b'));

-- Phase 2: hold off.
select pg_temp.set_hold(false);
set local role anon;
do $run$
begin
  perform pg_temp.accept('(e) all counts entered, same key as (a)', '0a');
  perform pg_temp.accept('(e) Corners removed, same key as (b)', '0b');
  perform pg_temp.accept('(e) every integer count removed', '0c');
  perform pg_temp.accept('(e) Corners explicitly 0', '0d');
  perform pg_temp.accept('(e) replay of all counts entered', '0a');
end
$run$;
reset role;
insert into residues values ('(e) count refusal, Corners removed', pg_temp.residue('0b'));

-- Retry after the fix: Corners entered on (b), same key.
set local session_replication_role = replica;
update public.line_items
   set configured_options = configured_options || '{"20a023c9-500e-4cf9-96a3-f518d9cee078": 1}'
 where id = '55555555-5555-4555-8555-00000000000b';
set local session_replication_role = origin;
set local role anon;
do $run$ begin perform pg_temp.accept('(e) retry after Corners entered, same key as (b)', '0b'); end $run$;
reset role;

-- A count added to the product after (f)'s line was written with every count.
set local session_replication_role = replica;
insert into public.product_options (id, product_id, name, kind, required, affects_recipe, sort_order)
values ('99999999-9999-4999-8999-999999999991', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
        'Stair returns', 'integer', true, true, 100);
-- Its recipe line reuses the family pin of the product's first recipe line.
insert into public.product_materials (id, product_id, catalog_item_id, variant_selector, quantity_per_unit, scaled_by_option_id)
select '99999999-9999-4999-8999-999999999992', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
       material_row.catalog_item_id, material_row.variant_selector, 1, '99999999-9999-4999-8999-999999999991'
  from public.product_materials material_row
 where material_row.product_id = '3efc9582-ac59-4f13-919e-c1b3e3495cc3'
   and material_row.catalog_item_id is not null
 order by material_row.id
 limit 1;
set local session_replication_role = origin;
set local role anon;
do $run$ begin perform pg_temp.accept('(e) count added to the product after the line was written', '0f'); end $run$;
reset role;

-- Phase 3: hold back on.
select pg_temp.set_hold(true);
set local role anon;
do $run$ begin perform pg_temp.accept('(d) replay of (e) all counts, hold back on', '0a'); end $run$;
reset role;

\echo
\echo === OUTCOMES
select step, hold, label, accepted,
       (response ->> 'idempotent_replay')::boolean as replay,
       response ->> 'inventory_mode' as mode,
       jsonb_array_length(response -> 'warnings') as warnings,
       jsonb_array_length(response -> 'demand_ids') as demand_ids,
       sqlstate, hint
  from outcomes order by step;

\echo
\echo === REFUSAL TEXT (the iOS banner reads MESSAGE verbatim)
select step, label, message from outcomes where not accepted order by step;

\echo
\echo === REFUSAL DETAIL
select step, jsonb_pretty(detail::jsonb) as detail
  from outcomes where not accepted and label in ('(a) all counts entered', '(e) Corners removed, same key as (b)')
 order by step;

\echo
\echo === WHAT A REFUSED CALL LEFT BEHIND
select label,
       residue ->> 'projects' as projects, residue ->> 'tasks' as tasks, residue ->> 'demands' as demands,
       residue ->> 'snapshots' as snapshots, residue ->> 'acceptance_requests' as acceptance_requests,
       residue ->> 'stage_transitions' as stage_transitions,
       residue ->> 'notifications_this_txn' as notifications, residue ->> 'estimate' as estimate,
       residue ->> 'opportunity_stage' as stage
  from residues order by label;

\echo
\echo === DEMANDS, grouped the way scenario.sql groups them
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
   and o.estimate_id <> '44444444-4444-4444-8444-00000000000e'
   and (o.label like '(e) all counts%' or o.label like '(e) Corners explicitly 0%' or o.label like '(e) retry%'
        or o.label = '(a) all counts entered')
 group by 1, 2, 3
 order by 1, 2, 3;

\echo
\echo === (c) NORMALISED RESPONSE (compare the md5 across the before and after runs)
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
     where o.label = '(c) no count-driven product'
  ) s;

\echo
\echo === REPLAYS
select r.label,
       r.response ->> 'project_id' = first_accept.response ->> 'project_id' as same_project,
       (r.response ->> 'idempotent_replay')::boolean as replay_flag,
       (select count(*) from public.accept_estimate_to_job_requests q
         where q.estimate_id = r.estimate_id and q.status = 'completed') as completed_requests
  from outcomes r
  join lateral (
    select f.response from outcomes f
     where f.estimate_id = r.estimate_id and f.accepted
       and not coalesce((f.response ->> 'idempotent_replay')::boolean, false)
     order by f.step limit 1
  ) first_accept on true
 where r.label like '%replay%'
 order by r.step;

rollback;
