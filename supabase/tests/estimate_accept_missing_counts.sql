-- Runtime proof for 20260917010000_estimate_accept_refuses_missing_counts.sql.
--
-- Run against a LOCAL schema copy with that migration applied (never production):
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=<local db>" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/estimate_accept_missing_counts.sql
--
-- Builds a synthetic company inside one transaction, accepts estimates through
-- public.accept_estimate_to_job as the Firebase-bridged `anon` role the iOS app
-- uses, prints one row per case, raises if any case disagrees with the expected
-- result, and always ends in ROLLBACK. Three phases:
--   1. HOLD ON, as the migration installs it: every tracked estimate carrying a
--      count-driven product is held, whatever its counts say.
--   2. HOLD OFF — the switch redefined to `select false` inside this
--      transaction, which is what the step 3 migration does: the full
--      missing-count matrix, re-using phase 1's keys (a held call is retry-safe).
--   3. HOLD BACK ON: an estimate accepted in phase 2 still replays.
--
-- Recipe. "Railing" has select Color and integer counts Left ends and Corners:
-- end post 2 per Left end, corner post 1 per Corner, top rail 0.1 per linear
-- foot. Every line is 20 lf, so a fallback to line scaling would book 40 end
-- posts. "Gate", "Planter" and "Bench" each carry one scaled count, "Fascia"
-- carries only an unscaled material, and "Deck rail" gains a new required count
-- after its estimate is written.

begin;

-- Fixture writes bypass revision bumps, custody guards and the accounting
-- queue, none of which the acceptance checks read.
set local session_replication_role = replica;

insert into public.companies (id, name, public_handle)
values ('ac7e0000-0000-4000-8000-000000000001', 'Accept counts fixture co', 'accept-counts-fixture');

insert into public.users (id, first_name, last_name, email, auth_id, firebase_uid, company_id,
                          is_company_admin, role, user_type, is_active)
values ('ac7e0000-0000-4000-8000-000000000002', 'Fixture', 'Estimator',
        'accept-counts-fixture@ops.invalid',
        'ac7e0000-0000-4000-8000-0000000000a1', 'ac7e0000-0000-4000-8000-0000000000a1',
        'ac7e0000-0000-4000-8000-000000000001', true, 'admin', 'employee', true);

insert into auth.users (id, email)
values ('ac7e0000-0000-4000-8000-000000000003', 'accept-counts-fixture@ops.invalid');

insert into public.clients (id, company_id, name)
values ('ac7e0000-0000-4000-8000-000000000004', 'ac7e0000-0000-4000-8000-000000000001', 'Fixture client');

insert into public.company_inventory_settings (company_id, inventory_mode, enabled_at)
values ('ac7e0000-0000-4000-8000-000000000001', 'tracked', now());

insert into public.catalog_items (id, company_id, name)
values ('ac7e0000-0000-4000-8000-000000000010', 'ac7e0000-0000-4000-8000-000000000001', 'Fixture hardware');

insert into public.catalog_variants (id, company_id, catalog_item_id, is_active)
select v.id, 'ac7e0000-0000-4000-8000-000000000001', 'ac7e0000-0000-4000-8000-000000000010', true
  from (values ('ac7e0000-0000-4000-8000-000000000011'::uuid),  -- end post
               ('ac7e0000-0000-4000-8000-000000000012'::uuid),  -- corner post
               ('ac7e0000-0000-4000-8000-000000000013'::uuid),  -- top rail
               ('ac7e0000-0000-4000-8000-000000000014'::uuid),  -- gate post
               ('ac7e0000-0000-4000-8000-000000000015'::uuid)   -- stair post
       ) v(id);

insert into public.products (id, company_id, name, kind, type)
values ('ac7e0000-0000-4000-8000-000000000020', 'ac7e0000-0000-4000-8000-000000000001', 'Railing',   'service', 'LABOR'),
       ('ac7e0000-0000-4000-8000-000000000021', 'ac7e0000-0000-4000-8000-000000000001', 'Fascia',    'service', 'LABOR'),
       ('ac7e0000-0000-4000-8000-000000000022', 'ac7e0000-0000-4000-8000-000000000001', 'Gate',      'service', 'LABOR'),
       ('ac7e0000-0000-4000-8000-000000000023', 'ac7e0000-0000-4000-8000-000000000001', 'Deck rail', 'service', 'LABOR'),
       ('ac7e0000-0000-4000-8000-000000000024', 'ac7e0000-0000-4000-8000-000000000001', 'Planter',   'service', 'LABOR'),
       ('ac7e0000-0000-4000-8000-000000000025', 'ac7e0000-0000-4000-8000-000000000001', 'Bench',     'service', 'LABOR');

insert into public.product_options (id, product_id, name, kind, required, affects_recipe, default_value, sort_order)
values ('ac7e0000-0000-4000-8000-000000000030', 'ac7e0000-0000-4000-8000-000000000020', 'Color',      'select',  true, true, 'Black', 0),
       ('ac7e0000-0000-4000-8000-000000000031', 'ac7e0000-0000-4000-8000-000000000020', 'Left ends',  'integer', true, true, '1',     1),
       ('ac7e0000-0000-4000-8000-000000000032', 'ac7e0000-0000-4000-8000-000000000020', 'Corners',    'integer', true, true, '0',     2),
       ('ac7e0000-0000-4000-8000-000000000033', 'ac7e0000-0000-4000-8000-000000000022', 'Gate posts', 'integer', true, true, null,    0),
       ('ac7e0000-0000-4000-8000-000000000034', 'ac7e0000-0000-4000-8000-000000000023', 'Left ends',  'integer', true, true, null,    0),
       ('ac7e0000-0000-4000-8000-000000000036', 'ac7e0000-0000-4000-8000-000000000024', 'Corners',    'integer', true, true, null,    0),
       ('ac7e0000-0000-4000-8000-000000000037', 'ac7e0000-0000-4000-8000-000000000025', 'Legs',       'integer', true, true, null,    0);

insert into public.product_option_values (id, option_id, value, sort_order)
values ('ac7e0000-0000-4000-8000-000000000038', 'ac7e0000-0000-4000-8000-000000000030', 'Black', 0);

insert into public.product_materials (id, product_id, catalog_variant_id, quantity_per_unit, scaled_by_option_id)
values ('ac7e0000-0000-4000-8000-000000000040', 'ac7e0000-0000-4000-8000-000000000020', 'ac7e0000-0000-4000-8000-000000000011', 2,   'ac7e0000-0000-4000-8000-000000000031'),
       ('ac7e0000-0000-4000-8000-000000000041', 'ac7e0000-0000-4000-8000-000000000020', 'ac7e0000-0000-4000-8000-000000000012', 1,   'ac7e0000-0000-4000-8000-000000000032'),
       ('ac7e0000-0000-4000-8000-000000000042', 'ac7e0000-0000-4000-8000-000000000020', 'ac7e0000-0000-4000-8000-000000000013', 0.1, null),
       ('ac7e0000-0000-4000-8000-000000000043', 'ac7e0000-0000-4000-8000-000000000021', 'ac7e0000-0000-4000-8000-000000000013', 0.5, null),
       ('ac7e0000-0000-4000-8000-000000000044', 'ac7e0000-0000-4000-8000-000000000022', 'ac7e0000-0000-4000-8000-000000000014', 1,   'ac7e0000-0000-4000-8000-000000000033'),
       ('ac7e0000-0000-4000-8000-000000000045', 'ac7e0000-0000-4000-8000-000000000023', 'ac7e0000-0000-4000-8000-000000000011', 2,   'ac7e0000-0000-4000-8000-000000000034'),
       ('ac7e0000-0000-4000-8000-000000000047', 'ac7e0000-0000-4000-8000-000000000024', 'ac7e0000-0000-4000-8000-000000000012', 1,   'ac7e0000-0000-4000-8000-000000000036'),
       ('ac7e0000-0000-4000-8000-000000000048', 'ac7e0000-0000-4000-8000-000000000025', 'ac7e0000-0000-4000-8000-000000000013', 1,   'ac7e0000-0000-4000-8000-000000000037');

-- One opportunity + estimate per case: ...0001<case>00 / ...0002<case>00, and
-- lines ...0003<case><nn>.
create function pg_temp.case_id(p_kind text, p_case text, p_n integer default 0)
returns uuid language sql immutable as $$
  select ('ac7e0000-0000-4000-8000-000000' || p_kind || p_case || lpad(p_n::text, 2, '0'))::uuid
$$;

create function pg_temp.make_estimate(p_case text, p_status text default 'draft', p_project uuid default null)
returns uuid language sql as $$
  insert into public.opportunities (id, company_id, client_id, title, stage)
  values (pg_temp.case_id('10', p_case), 'ac7e0000-0000-4000-8000-000000000001',
          'ac7e0000-0000-4000-8000-000000000004', 'Case ' || p_case, 'quoted');
  insert into public.estimates (id, company_id, client_id, opportunity_id, estimate_number, title, status, project_ref)
  values (pg_temp.case_id('20', p_case), 'ac7e0000-0000-4000-8000-000000000001',
          'ac7e0000-0000-4000-8000-000000000004', pg_temp.case_id('10', p_case),
          'CASE-' || p_case, 'Case ' || p_case, p_status, p_project)
  returning id
$$;

create function pg_temp.add_line(
  p_case text, p_n integer, p_product uuid, p_configured jsonb,
  p_is_optional boolean default false, p_is_selected boolean default true
) returns uuid language sql as $$
  insert into public.line_items (id, company_id, estimate_id, product_id, name, quantity, unit_price,
                                 type, sort_order, configured_options, is_optional, is_selected)
  values (pg_temp.case_id('30', p_case, p_n), 'ac7e0000-0000-4000-8000-000000000001',
          pg_temp.case_id('20', p_case), p_product,
          coalesce((select name from public.products where id = p_product), 'Custom line'),
          20, 50, 'LABOR', p_n, p_configured, p_is_optional, p_is_selected)
  returning id
$$;

-- Option keys, for readable configured_options below.
--   31 Railing Left ends · 32 Railing Corners · 33 Gate posts · 34 Deck rail Left ends
--   36 Planter Corners · 37 Bench Legs · 30 Railing Color (value 38)
do $cases$
begin
perform pg_temp.make_estimate('01');                 -- A  all counts
perform pg_temp.add_line('01', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000030": "ac7e0000-0000-4000-8000-000000000038",
    "ac7e0000-0000-4000-8000-000000000031": 1, "ac7e0000-0000-4000-8000-000000000032": 3}');
perform pg_temp.make_estimate('02');                 -- B  Corners absent
perform pg_temp.add_line('02', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000030": "ac7e0000-0000-4000-8000-000000000038",
    "ac7e0000-0000-4000-8000-000000000031": 1}');
perform pg_temp.make_estimate('03');                 -- C  every count absent
perform pg_temp.add_line('03', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000030": "ac7e0000-0000-4000-8000-000000000038"}');
perform pg_temp.make_estimate('04');                 -- D  Corners explicitly 0
perform pg_temp.add_line('04', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000030": "ac7e0000-0000-4000-8000-000000000038",
    "ac7e0000-0000-4000-8000-000000000031": 1, "ac7e0000-0000-4000-8000-000000000032": 0}');
perform pg_temp.make_estimate('05');                 -- E  no recipe counts at all
perform pg_temp.add_line('05', 1, 'ac7e0000-0000-4000-8000-000000000021', null);
perform pg_temp.add_line('05', 2, null, null);
perform pg_temp.make_estimate('06');                 -- F  inventory off, counts absent
perform pg_temp.add_line('06', 1, 'ac7e0000-0000-4000-8000-000000000020', '{}');
perform pg_temp.make_estimate('07');                 -- G  blank counts only on an unselected optional line
perform pg_temp.add_line('07', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": 2, "ac7e0000-0000-4000-8000-000000000032": 1}');
perform pg_temp.add_line('07', 2, 'ac7e0000-0000-4000-8000-000000000022', '{}', true, false);
perform pg_temp.add_line('07', 3, 'ac7e0000-0000-4000-8000-000000000024', '{}', true, null);
perform pg_temp.make_estimate('11');                 -- H1 numeric strings count
perform pg_temp.add_line('11', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": "2", "ac7e0000-0000-4000-8000-000000000032": " 4 "}');
perform pg_temp.make_estimate('12');                 -- H2 "abc" is not a count
perform pg_temp.add_line('12', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": 1, "ac7e0000-0000-4000-8000-000000000032": "abc"}');
perform pg_temp.make_estimate('13');                 -- H3 true and JSON null are not counts
perform pg_temp.add_line('13', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": true, "ac7e0000-0000-4000-8000-000000000032": null}');
perform pg_temp.make_estimate('14');                 -- H4 a negative number is a count (clamps to 0)
perform pg_temp.add_line('14', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": -2, "ac7e0000-0000-4000-8000-000000000032": 0}');
perform pg_temp.make_estimate('21');                 -- I  count added to the product after the line was written
perform pg_temp.add_line('21', 1, 'ac7e0000-0000-4000-8000-000000000023',
  '{"ac7e0000-0000-4000-8000-000000000034": 1}');
perform pg_temp.make_estimate('31');                 -- J1 two products, one product on two lines
perform pg_temp.add_line('31', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": 1}');
perform pg_temp.add_line('31', 2, 'ac7e0000-0000-4000-8000-000000000022', '{}');
perform pg_temp.add_line('31', 3, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000032": 2}');
perform pg_temp.make_estimate('32');                 -- J2 four products: three listed, one summarised
perform pg_temp.add_line('32', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": 1}');
perform pg_temp.add_line('32', 2, 'ac7e0000-0000-4000-8000-000000000022', '{}');
perform pg_temp.add_line('32', 3, 'ac7e0000-0000-4000-8000-000000000024', '{}');
perform pg_temp.add_line('32', 4, 'ac7e0000-0000-4000-8000-000000000025', '{}');
perform pg_temp.make_estimate('33');                 -- J3 three products, every count entered (hold phase only)
perform pg_temp.add_line('33', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": 1, "ac7e0000-0000-4000-8000-000000000032": 1}');
perform pg_temp.add_line('33', 2, 'ac7e0000-0000-4000-8000-000000000022',
  '{"ac7e0000-0000-4000-8000-000000000033": 2}');
perform pg_temp.add_line('33', 3, 'ac7e0000-0000-4000-8000-000000000024',
  '{"ac7e0000-0000-4000-8000-000000000036": 4}');
perform pg_temp.make_estimate('51');                 -- hold phase: no count-driven product
perform pg_temp.add_line('51', 1, 'ac7e0000-0000-4000-8000-000000000021', null);
perform pg_temp.add_line('51', 2, null, null);
perform pg_temp.make_estimate('56');                 -- hold phase: inventory off, count-driven product
perform pg_temp.add_line('56', 1, 'ac7e0000-0000-4000-8000-000000000020', '{}');
perform pg_temp.make_estimate('57');                 -- hold phase: count-driven products only as unselected optionals
perform pg_temp.add_line('57', 1, 'ac7e0000-0000-4000-8000-000000000021', null);
perform pg_temp.add_line('57', 2, 'ac7e0000-0000-4000-8000-000000000022', '{}', true, false);
perform pg_temp.add_line('57', 3, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": 1, "ac7e0000-0000-4000-8000-000000000032": 1}', true, null);

-- K: agreement with the resolver on an approved estimate that already has its job.
insert into public.projects (id, company_id, title)
values ('ac7e0000-0000-4000-8000-000000000050', 'ac7e0000-0000-4000-8000-000000000001', 'Fixture job');
perform pg_temp.make_estimate('41', 'approved', 'ac7e0000-0000-4000-8000-000000000050');
perform pg_temp.add_line('41', 1, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": 1, "ac7e0000-0000-4000-8000-000000000032": 2}');
perform pg_temp.add_line('41', 2, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000032": "abc"}');
perform pg_temp.add_line('41', 3, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": true, "ac7e0000-0000-4000-8000-000000000032": null}');
perform pg_temp.add_line('41', 4, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": "2.5", "ac7e0000-0000-4000-8000-000000000032": "1e3"}');
perform pg_temp.add_line('41', 5, 'ac7e0000-0000-4000-8000-000000000020',
  '{"ac7e0000-0000-4000-8000-000000000031": -2, "ac7e0000-0000-4000-8000-000000000032": " 4 "}');
perform pg_temp.add_line('41', 6, 'ac7e0000-0000-4000-8000-000000000022', '{}', true, false);
perform pg_temp.add_line('41', 7, 'ac7e0000-0000-4000-8000-000000000022', '[]');
perform pg_temp.add_line('41', 8, 'ac7e0000-0000-4000-8000-000000000021', null);
end
$cases$;

set local session_replication_role = origin;

-- ── Acceptance, as the app calls it ────────────────────────────────────────
create temp table accept_outcomes (
  step integer generated always as identity,
  hold_active boolean not null,
  case_label text not null,
  estimate_id uuid not null,
  idempotency_key text not null,
  accepted boolean not null,
  response jsonb,
  sqlstate text,
  message text,
  detail jsonb,
  hint text
) on commit drop;
grant select, insert on accept_outcomes to anon;

create function pg_temp.try_accept(p_case_label text, p_case text, p_key text default null)
returns void language plpgsql as $$
declare
  v_estimate uuid := pg_temp.case_id('20', p_case);
  v_key text := coalesce(p_key, 'fixture-key-' || p_case);
  v_hold boolean := private.estimate_recipe_count_hold_active();
  v_response jsonb;
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
begin
  begin
    v_response := public.accept_estimate_to_job(v_estimate, v_key);
    insert into accept_outcomes (hold_active, case_label, estimate_id, idempotency_key, accepted, response)
    values (v_hold, p_case_label, v_estimate, v_key, true, v_response);
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate,
      v_message = message_text,
      v_detail = pg_exception_detail,
      v_hint = pg_exception_hint;
    insert into accept_outcomes (hold_active, case_label, estimate_id, idempotency_key, accepted, sqlstate, message, detail, hint)
    values (v_hold, p_case_label, v_estimate, v_key, false, v_state, v_message,
            case when v_detail ~ '^\{' then v_detail::jsonb else to_jsonb(v_detail) end, v_hint);
  end;
end;
$$;

-- What a call left behind, for one case.
create function pg_temp.residue(p_case text) returns jsonb language sql as $$
  select jsonb_build_object(
    'projects', (select count(*) from public.projects
                  where company_id = 'ac7e0000-0000-4000-8000-000000000001'
                    and opportunity_id = pg_temp.case_id('10', p_case)::text),
    'tasks', (select count(*) from public.project_tasks
               where source_estimate_id = pg_temp.case_id('20', p_case)::text),
    'demands', (select count(*) from public.project_material_demands
                 where estimate_id = pg_temp.case_id('20', p_case)),
    'snapshots', (select count(*) from public.project_material_snapshots
                   where estimate_id = pg_temp.case_id('20', p_case)),
    'stage_transitions', (select count(*) from public.stage_transitions
                           where opportunity_id = pg_temp.case_id('10', p_case)),
    'acceptance_requests', (select count(*) from public.accept_estimate_to_job_requests
                             where estimate_id = pg_temp.case_id('20', p_case)),
    'notifications', (select count(*) from public.notifications
                       where company_id = 'ac7e0000-0000-4000-8000-000000000001'),
    'estimate_state', (select status || '/' || coalesce(approved_at::text, 'unapproved') || '/'
                              || coalesce(project_ref::text, 'no project')
                         from public.estimates where id = pg_temp.case_id('20', p_case)),
    'opportunity_stage', (select stage from public.opportunities where id = pg_temp.case_id('10', p_case))
  )
$$;

create temp table residues (label text primary key, residue jsonb not null) on commit drop;

set local request.jwt.claims = '{"sub":"ac7e0000-0000-4000-8000-0000000000a1","role":"anon"}';

-- ── Phase 1: hold on ───────────────────────────────────────────────────────
set local role anon;
do $hold$
begin
  perform pg_temp.try_accept('HOLD A  all counts entered', '01');
  perform pg_temp.try_accept('HOLD B  Corners absent', '02');
  perform pg_temp.try_accept('HOLD J1 two products', '31');
  perform pg_temp.try_accept('HOLD J3 three products, every count entered', '33');
  perform pg_temp.try_accept('HOLD J2 four products', '32');
  perform pg_temp.try_accept('HOLD E  no count-driven product', '51');
  perform pg_temp.try_accept('HOLD E  replay, same key', '51');
  perform pg_temp.try_accept('HOLD G  count-driven products only as unselected optionals', '57');
end
$hold$;
reset role;

insert into residues values ('HOLD A  all counts entered', pg_temp.residue('01'));

set local session_replication_role = replica;
update public.company_inventory_settings set inventory_mode = 'off'
 where company_id = 'ac7e0000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
set local role anon;
do $$ begin perform pg_temp.try_accept('HOLD F  inventory off, count-driven product', '56'); end $$;
reset role;
set local session_replication_role = replica;
update public.company_inventory_settings set inventory_mode = 'tracked'
 where company_id = 'ac7e0000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

-- ── Phase 2: hold off (what step 3 does to the switch) ─────────────────────
create or replace function private.estimate_recipe_count_hold_active()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select false
$function$;

set local role anon;
do $counts$
begin
  perform pg_temp.try_accept('A  all counts', '01');
  perform pg_temp.try_accept('A  replay, same key', '01');
  perform pg_temp.try_accept('B  Corners absent', '02');
  perform pg_temp.try_accept('C  every count absent', '03');
  perform pg_temp.try_accept('D  Corners explicitly 0', '04');
  perform pg_temp.try_accept('E  no recipe counts', '05');
  perform pg_temp.try_accept('G  blank counts on unselected optional lines', '07');
  perform pg_temp.try_accept('H1 "2" and " 4 "', '11');
  perform pg_temp.try_accept('H2 Corners "abc"', '12');
  perform pg_temp.try_accept('H3 true and null', '13');
  perform pg_temp.try_accept('H4 -2 and 0', '14');
  perform pg_temp.try_accept('J1 two products', '31');
  perform pg_temp.try_accept('J2 four products', '32');
end
$counts$;
reset role;

insert into residues values ('B  Corners absent', pg_temp.residue('02'));

-- B retried with the same key once Corners is entered: a fresh acceptance, not
-- a replay of either refusal.
set local session_replication_role = replica;
update public.line_items
   set configured_options = configured_options || '{"ac7e0000-0000-4000-8000-000000000032": 2}'
 where id = pg_temp.case_id('30', '02', 1);
set local session_replication_role = origin;
set local role anon;
do $$ begin perform pg_temp.try_accept('B  retry after Corners entered, same key', '02'); end $$;
reset role;

-- F: a company that does not track inventory is never refused.
set local session_replication_role = replica;
update public.company_inventory_settings set inventory_mode = 'off'
 where company_id = 'ac7e0000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
set local role anon;
do $$ begin perform pg_temp.try_accept('F  inventory off, counts absent', '06'); end $$;
reset role;
set local session_replication_role = replica;
update public.company_inventory_settings set inventory_mode = 'tracked'
 where company_id = 'ac7e0000-0000-4000-8000-000000000001';

-- I: the product gains a required count and a recipe line scaled by it after
-- the estimate line was written with every count it had then.
insert into public.product_options (id, product_id, name, kind, required, affects_recipe, sort_order)
values ('ac7e0000-0000-4000-8000-000000000035', 'ac7e0000-0000-4000-8000-000000000023', 'Stair posts', 'integer', true, true, 1);
insert into public.product_materials (id, product_id, catalog_variant_id, quantity_per_unit, scaled_by_option_id)
values ('ac7e0000-0000-4000-8000-000000000046', 'ac7e0000-0000-4000-8000-000000000023',
        'ac7e0000-0000-4000-8000-000000000015', 1, 'ac7e0000-0000-4000-8000-000000000035');
set local session_replication_role = origin;
set local role anon;
do $$ begin perform pg_temp.try_accept('I  count added after the line was written', '21'); end $$;
reset role;

-- ── Phase 3: hold back on — an accepted estimate still replays ─────────────
create or replace function private.estimate_recipe_count_hold_active()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select true
$function$;
set local role anon;
do $$ begin perform pg_temp.try_accept('HOLD A  replay of A accepted with the hold off', '01'); end $$;
reset role;

-- ── Results ────────────────────────────────────────────────────────────────
create temp table expected_outcomes (
  case_label text primary key,
  hold_active boolean not null,
  accepted boolean not null,
  replay boolean,
  hint text,
  message text
) on commit drop;

insert into expected_outcomes values
  ('HOLD A  all counts entered', true, false, null, 'estimate_accept_recipe_counts_hold',
   'Railing can''t be accepted from the app until the next OPS update. The estimate is safe to leave as is.'),
  ('HOLD B  Corners absent', true, false, null, 'estimate_accept_recipe_counts_hold',
   'Railing can''t be accepted from the app until the next OPS update. The estimate is safe to leave as is.'),
  ('HOLD J1 two products', true, false, null, 'estimate_accept_recipe_counts_hold',
   'Railing and Gate can''t be accepted from the app until the next OPS update. The estimate is safe to leave as is.'),
  ('HOLD J3 three products, every count entered', true, false, null, 'estimate_accept_recipe_counts_hold',
   'Railing, Gate and Planter can''t be accepted from the app until the next OPS update. The estimate is safe to leave as is.'),
  ('HOLD J2 four products', true, false, null, 'estimate_accept_recipe_counts_hold',
   'Railing, Gate, Planter and 1 more product can''t be accepted from the app until the next OPS update. The estimate is safe to leave as is.'),
  ('HOLD E  no count-driven product', true, true, false, null, null),
  ('HOLD E  replay, same key', true, true, true, null, null),
  ('HOLD G  count-driven products only as unselected optionals', true, true, false, null, null),
  ('HOLD F  inventory off, count-driven product', true, true, false, null, null),
  ('A  all counts', false, true, false, null, null),
  ('A  replay, same key', false, true, true, null, null),
  ('B  Corners absent', false, false, null, 'estimate_accept_recipe_counts_missing',
   'Missing count on Railing: Corners. Open the estimate, enter the count, accept again.'),
  ('C  every count absent', false, false, null, 'estimate_accept_recipe_counts_missing',
   'Missing counts on Railing: Left ends, Corners. Open the estimate, enter the counts, accept again.'),
  ('D  Corners explicitly 0', false, true, false, null, null),
  ('E  no recipe counts', false, true, false, null, null),
  ('G  blank counts on unselected optional lines', false, true, false, null, null),
  ('H1 "2" and " 4 "', false, true, false, null, null),
  ('H2 Corners "abc"', false, false, null, 'estimate_accept_recipe_counts_missing',
   'Missing count on Railing: Corners. Open the estimate, enter the count, accept again.'),
  ('H3 true and null', false, false, null, 'estimate_accept_recipe_counts_missing',
   'Missing counts on Railing: Left ends, Corners. Open the estimate, enter the counts, accept again.'),
  ('H4 -2 and 0', false, true, false, null, null),
  ('J1 two products', false, false, null, 'estimate_accept_recipe_counts_missing',
   'Missing counts on Railing: Left ends, Corners; Gate: Gate posts. Open the estimate, enter the counts, accept again.'),
  ('J2 four products', false, false, null, 'estimate_accept_recipe_counts_missing',
   'Missing counts on Railing: Corners; Gate: Gate posts; Planter: Corners; and 1 more product. Open the estimate, enter the counts, accept again.'),
  ('B  retry after Corners entered, same key', false, true, false, null, null),
  ('F  inventory off, counts absent', false, true, false, null, null),
  ('I  count added after the line was written', false, false, null, 'estimate_accept_recipe_counts_missing',
   'Missing count on Deck rail: Stair posts. Open the estimate, enter the count, accept again.'),
  ('HOLD A  replay of A accepted with the hold off', true, true, true, null, null);

\pset footer off
\echo === ACCEPTANCE OUTCOMES
create temp table checked_outcomes on commit drop as
select o.step,
       o.hold_active,
       o.case_label,
       o.accepted,
       (o.response ->> 'idempotent_replay')::boolean as replay,
       o.response ->> 'inventory_mode' as inventory_mode,
       o.sqlstate,
       o.hint,
       o.message,
       case
         when e.case_label is null then false
         when o.hold_active is distinct from e.hold_active then false
         when o.accepted is distinct from e.accepted then false
         when o.accepted and (o.response ->> 'idempotent_replay')::boolean is distinct from e.replay then false
         when not o.accepted and (o.sqlstate <> '22023'
                                  or o.hint is distinct from e.hint
                                  or o.message is distinct from e.message
                                  or o.detail ->> 'code' is distinct from e.hint
                                  or o.detail ->> 'estimate_id' is distinct from o.estimate_id::text) then false
         else true
       end as pass
  from accept_outcomes o
  left join expected_outcomes e on e.case_label = o.case_label;

select step, hold_active as hold, case_label, accepted, replay, inventory_mode, sqlstate, hint,
       case when pass then 'PASS' else 'FAIL' end as result, message
  from checked_outcomes order by step;

\echo === HOLD DETAIL (J1: products in line order, each with its lines)
select jsonb_pretty(detail) from accept_outcomes where case_label = 'HOLD J1 two products';

\echo === COUNT DETAIL (B)
select jsonb_pretty(detail) from accept_outcomes where case_label = 'B  Corners absent';

\echo === WHAT A REFUSED CALL LEFT BEHIND (hold refusal of A, count refusal of B)
select label,
       residue ->> 'projects' as projects, residue ->> 'tasks' as tasks, residue ->> 'demands' as demands,
       residue ->> 'snapshots' as snapshots, residue ->> 'stage_transitions' as stage_transitions,
       residue ->> 'acceptance_requests' as acceptance_requests, residue ->> 'notifications' as notifications,
       residue ->> 'estimate_state' as estimate_state, residue ->> 'opportunity_stage' as stage
  from residues order by label desc;

\echo === BOOKED QUANTITIES
create temp table booked on commit drop as
select o.case_label, d.product_material_id, d.required_quantity, d.status,
       jsonb_array_length(coalesce(d.warning_payload -> 'warnings', '[]'::jsonb)) as warnings
  from accept_outcomes o
  join public.project_material_demands d on d.estimate_id = o.estimate_id and d.deleted_at is null
 where o.accepted and not coalesce((o.response ->> 'idempotent_replay')::boolean, false);
select case_label,
       max(required_quantity) filter (where product_material_id = 'ac7e0000-0000-4000-8000-000000000040') as end_posts,
       max(required_quantity) filter (where product_material_id = 'ac7e0000-0000-4000-8000-000000000041') as corner_posts,
       max(required_quantity) filter (where product_material_id = 'ac7e0000-0000-4000-8000-000000000042') as top_rail,
       max(required_quantity) filter (where product_material_id = 'ac7e0000-0000-4000-8000-000000000043') as fascia_rail,
       sum(warnings) as demand_warnings
  from booked group by case_label order by case_label;

-- ── Agreement with the resolver ────────────────────────────────────────────
-- On every line of K the check reads "missing" exactly where
-- private.resolve_estimate_material_demand_plan books 0 and warns.
set local role anon;
create temp table agreement on commit drop as
with plan as (
  select private.resolve_estimate_material_demand_plan(
           pg_temp.case_id('20', '41'), 'ac7e0000-0000-4000-8000-000000000050') as body
),
plan_missing as (
  select distinct (w ->> 'line_item_id')::uuid as line_item_id, (w ->> 'product_option_id')::uuid as option_id
    from plan, jsonb_array_elements(plan.body -> 'warnings') w
   where w ->> 'code' = 'scaled_option_value_missing'
),
check_missing as (
  select (line_item ->> 'line_item_id')::uuid as line_item_id, (count_item ->> 'product_option_id')::uuid as option_id
    from jsonb_array_elements(private.estimate_recipe_count_lines(pg_temp.case_id('20', '41'))) line_item,
         jsonb_array_elements(line_item -> 'missing_counts') count_item
)
select coalesce(p.line_item_id, c.line_item_id) as line_item_id,
       coalesce(p.option_id, c.option_id) as option_id,
       p.line_item_id is not null as resolver_warns,
       c.line_item_id is not null as check_refuses
  from plan_missing p
  full join check_missing c on c.line_item_id = p.line_item_id and c.option_id = p.option_id;
create temp table k_lines on commit drop as
select right(line_item ->> 'line_item_id', 2) as line,
       jsonb_array_length(line_item -> 'missing_counts') as missing
  from jsonb_array_elements(private.estimate_recipe_count_lines(pg_temp.case_id('20', '41'))) line_item;
reset role;

\echo === AGREEMENT (resolver warning vs check, estimate K)
select right(a.line_item_id::text, 2) as line, o.name as count_name,
       l.configured_options -> a.option_id::text as configured_value,
       a.resolver_warns, a.check_refuses,
       case when a.resolver_warns = a.check_refuses then 'PASS' else 'FAIL' end as result
  from agreement a
  join public.product_options o on o.id = a.option_id
  join public.line_items l on l.id = a.line_item_id
 order by line, o.sort_order;

\echo === COUNT-DRIVEN LINES THE HOLD SEES ON K (booked lines only)
select line, missing from k_lines order by line;

do $assert$
declare
  v_failures integer;
  v_missing_cases integer;
  v_residue record;
  v_booked record;
  v_disagreements integer;
  v_agreement_rows integer;
  v_k_lines text;
begin
  select count(*) into v_failures from checked_outcomes where not pass;
  select count(*) into v_missing_cases
    from expected_outcomes e
   where not exists (select 1 from accept_outcomes o where o.case_label = e.case_label);

  for v_residue in select * from residues loop
    if v_residue.residue is distinct from jsonb_build_object(
         'projects', 0, 'tasks', 0, 'demands', 0, 'snapshots', 0, 'stage_transitions', 0,
         'acceptance_requests', 0, 'notifications', 0,
         'estimate_state', 'draft/unapproved/no project', 'opportunity_stage', 'quoted') then
      raise exception 'estimate_accept_missing_counts_runtime_failed: % left residue %',
        v_residue.label, v_residue.residue;
    end if;
  end loop;

  -- A books 2 end posts (1 Left end x 2), 3 corner posts, 2 lf of top rail; D
  -- books 0 corner posts with no warning; B's retry books its entered 2 corners.
  select
    (select required_quantity from booked where case_label = 'A  all counts' and product_material_id = 'ac7e0000-0000-4000-8000-000000000040') as a_end,
    (select required_quantity from booked where case_label = 'A  all counts' and product_material_id = 'ac7e0000-0000-4000-8000-000000000041') as a_corner,
    (select required_quantity from booked where case_label = 'A  all counts' and product_material_id = 'ac7e0000-0000-4000-8000-000000000042') as a_rail,
    (select required_quantity from booked where case_label = 'D  Corners explicitly 0' and product_material_id = 'ac7e0000-0000-4000-8000-000000000041') as d_corner,
    (select required_quantity from booked where case_label = 'B  retry after Corners entered, same key' and product_material_id = 'ac7e0000-0000-4000-8000-000000000041') as b_corner,
    (select sum(warnings) from booked where case_label in ('A  all counts', 'D  Corners explicitly 0', 'H1 "2" and " 4 "', 'H4 -2 and 0')) as scaled_warnings,
    (select count(*) from booked where case_label in ('F  inventory off, counts absent', 'HOLD F  inventory off, count-driven product')) as off_demands
    into v_booked;
  if v_booked.a_end is distinct from 2 or v_booked.a_corner is distinct from 3
     or v_booked.a_rail is distinct from 2.0 or v_booked.d_corner is distinct from 0
     or v_booked.b_corner is distinct from 2 or v_booked.scaled_warnings is distinct from 0
     or v_booked.off_demands is distinct from 0 then
    raise exception 'estimate_accept_missing_counts_runtime_failed: bookings %', to_jsonb(v_booked);
  end if;

  select count(*), count(*) filter (where resolver_warns is distinct from check_refuses)
    into v_agreement_rows, v_disagreements from agreement;
  -- K: line 2 misses Left ends and Corners ("abc"), line 3 both (true, null),
  -- line 4 Corners ("1e3"), line 7 Gate posts (configured_options is an array).
  if v_disagreements <> 0 or v_agreement_rows <> 6 then
    raise exception 'estimate_accept_missing_counts_runtime_failed: % disagreement(s) over % row(s)',
      v_disagreements, v_agreement_rows;
  end if;
  -- The hold sees the booked count-driven lines 1-5 and 7, never the unselected
  -- optional line 6 or the unscaled Fascia line 8.
  select string_agg(line || ':' || missing, ',' order by line) into v_k_lines from k_lines;
  if v_k_lines is distinct from '01:0,02:2,03:2,04:1,05:0,07:1' then
    raise exception 'estimate_accept_missing_counts_runtime_failed: K lines %', v_k_lines;
  end if;

  if v_failures > 0 or v_missing_cases > 0 then
    raise exception 'estimate_accept_missing_counts_runtime_failed: % failing case(s), % case(s) not run',
      v_failures, v_missing_cases;
  end if;
  raise notice 'estimate_accept_missing_counts_runtime_passed';
end;
$assert$;

rollback;
