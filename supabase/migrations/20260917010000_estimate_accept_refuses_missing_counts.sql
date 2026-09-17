-- Accepting an estimate to a job refuses when its recipe counts cannot be
-- trusted: held outright for count-driven products until the iOS app stops
-- inventing counts, and refused for any blank count once the hold lifts.
--
-- WHAT WAS WRONG. A product_materials row with scaled_by_option_id books
-- quantity_per_unit x the line's count for that option (end posts per "Left
-- ends", corner posts per "Corners"). When the line carries no number for the
-- option, private.resolve_estimate_material_demand_plan books 0 and raises
-- `scaled_option_value_missing` (20260915220000 / prod 20260916050249), and
-- acceptance went through anyway: the job booked zero end posts, corner posts,
-- sleeves and endcaps — a plausible, short material list that surfaces as a
-- shortage on site. The iOS app reported it as a green "SYS :: ACCEPTED"
-- banner with "15 inventory warnings held for review."
--
-- And a blank rarely reached acceptance, which is worse. A count is job
-- geometry, not a preference, but the iOS editors invent one: the line sheet
-- seeds every integer option with `Int(opt.defaultValue ?? "0") ?? 0`
-- (ops-ios LineItemEditSheet.swift:458) and the deck-design adapter falls back
-- to `.integer(0)` (DesignToEstimateAdapter.swift:143). Canpro's "Picket Rail —
-- Level" defaults are Left ends 1, Right ends 1, Corners 0, 45° corners 0, Wall
-- returns 0, so a 40 ft run with three corners booked one pair of end posts and
-- no corners, with no warning at all. iOS is the only client that accepts.
--
-- THE RELEASE, IN THREE STEPS (product owner, 2026-09-17).
--   1. THIS FILE. Acceptance refuses blank counts, and — because a count that
--      came from iOS cannot be told apart from one an estimator entered — a
--      temporary hold refuses every estimate that carries a count-driven
--      product at all. The catalogue defaults are NOT touched: clearing them
--      now would make iOS write 0/0 end posts instead of 1/1. The web editor
--      already stops filling integer counts from defaults.
--   2. The iOS release that leaves counts blank, shows them blank and requires
--      them before save.
--   3. One migration, once Canpro's devices run that build: clears the integer
--      count defaults and lifts the hold (see the switch below).
--
-- THE RULE, AS INSTALLED HERE. Both checks run only for a company whose
-- inventory_mode is 'tracked', and only over the lines acceptance books.
--   HOLD (first, while private.estimate_recipe_count_hold_active() is true):
--     refuse when any booked line's product has a live count-scaled recipe
--     line, whatever its counts say.
--   COUNTS (once the hold is off): refuse when any booked line has a
--     count-scaled recipe line whose scaling option has no numeric value in
--     configured_options. An explicit 0 is a count and passes.
-- Either refusal leaves nothing behind: no project, task, demand, snapshot,
-- stage change, estimate status change, notification or acceptance request.
--
-- WHAT COUNTS AS MISSING. Exactly what the resolver books as 0 with a warning:
-- the line's configured_options value for the option is absent, JSON null, a
-- boolean, or a string that is not a plain decimal number. The line set is the
-- resolver's own: estimate lines with a live product of the estimate's company,
-- selected, and not an unselected optional. Recipe lines are the product's live
-- product_materials rows with scaled_by_option_id set, whether or not their
-- stock variant resolves — the count is an estimate input the user can enter;
-- an unresolved variant is a separate catalogue gap that acceptance already
-- reports through missing_mappings. A count option no recipe line scales by
-- books nothing, cannot short an order, and neither holds nor blocks.
--
-- PLACEMENT. One check, private.assert_estimate_accept_recipe_counts, runs
-- inside public.accept_estimate_to_job immediately after the idempotent replay
-- check and before private.sync_accepted_estimate_project_tasks. Before that
-- point the call has written one thing — the in_progress request row — and the
-- raise rolls it back with the transaction (PostgREST runs every RPC in its own
-- transaction and nothing catches the exception), so a retry with the same
-- idempotency key, which the iOS app keeps per estimate, runs fresh instead of
-- replaying the refusal. It sits after the replay check so an estimate that was
-- already accepted — including one accepted before this file — still replays
-- its stored response untouched. It does not parse the plan's warnings after
-- the fact: the plan only reads lines once the job exists (it needs an approved
-- estimate and a project), which is after every write this rule prevents. The
-- check reads the lines itself, through private.estimate_recipe_count_lines,
-- with the resolver's predicate and line filter restated verbatim; the SQL test
-- proves the two agree case by case. private.resolve_estimate_material_demand_plan
-- is not changed: the plan stays honest and still warns.
--
-- MODE SCOPE: TRACKED ONLY. The short order is a booked demand row, and
-- private.persist_estimate_material_booking_projection books demand rows only
-- when the company's inventory_mode is 'tracked'. With 'off' it books nothing
-- and releases any projected demand, no other database path turns recipe
-- counts into quantities (the iOS cut-list materialiser is not wired), and
-- acceptance never re-books later, so a company that switches to tracked does
-- not inherit a zero from an old acceptance. Refusing an off-mode acceptance
-- would block a job over a number nothing reads. The mode is read the way the
-- resolver reads it: company_inventory_settings for the estimate's company,
-- no row meaning 'off'.
--
-- THE REFUSALS. SQLSTATE 22023, the code every other acceptance refusal uses.
-- supabase-swift 2.54.1 decodes PostgREST's error body into PostgrestError,
-- whose errorDescription is the message, and the iOS view model shows
-- error.localizedDescription under "SYS :: ACCEPT FAILED" — so MESSAGE is human
-- copy. PostgREST sends `details` and PostgrestError declares `detail`, so
-- DETAIL never reaches the app; HINT does, so HINT carries the stable machine
-- code an app matches (with 22023), never the copy. Products are listed in
-- line order, at most three by name, then "and N more product(s)".
--   HOLD     HINT estimate_accept_recipe_counts_hold
--            Picket Rail — Level can't be accepted from the app until the next
--            OPS update. The estimate is safe to leave as is.
--            DETAIL {"code", "estimate_id", "products": [{product_id,
--            product_name, line_item_ids}]}
--   COUNTS   HINT estimate_accept_recipe_counts_missing
--            Missing counts on Picket Rail — Level: Corners, Wall returns.
--            Open the estimate, enter the counts, accept again.
--            ("count" when exactly one is missing; each count named once.)
--            DETAIL {"code", "estimate_id", "lines": [{line_item_id,
--            product_id, product_name, missing_counts: [{product_option_id,
--            name, configured_value}]}]}
--
-- QUICKBOOKS IS DELIBERATELY UNCHANGED. public.accept_estimate_to_job_from_quickbooks
-- reaches the same booking projection, but a refusal there is silent: the
-- webhook apply service turns the raise into an accounting sync log row that
-- reads "accepted estimate bridge failed", acks Intuit with 200 so nothing
-- retries, and notifies no one — the customer's acceptance would sit
-- unconverted with the owner never told. Its fingerprint is asserted below so
-- this file provably leaves it alone.
--
-- NO DATA CHANGES. No product_options row, default or catalogue row is
-- written. NOT AN EFFECT CHANGE for the catalogue write vertical: nothing here
-- is reachable from private.agent_catalog_setup_write_effect_revision(); the
-- postflight proves the seal reads the same before and after.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $prerequisites$
declare
  v_missing text[];
  v_drifted text[];
begin
  if current_user <> 'postgres' then
    raise exception 'estimate_accept_missing_counts_owner_required' using errcode = '55000';
  end if;

  select pg_catalog.array_agg(required.name order by required.name)
    into v_missing
  from (
    values
      ('function', 'public.accept_estimate_to_job(uuid,text)'),
      ('function', 'public.accept_estimate_to_job_from_quickbooks(uuid,uuid,uuid,text,text)'),
      ('function', 'private.persist_estimate_material_booking_projection(uuid,uuid)'),
      ('function', 'private.resolve_estimate_material_demand_plan(uuid,uuid)'),
      ('function', 'private.sync_accepted_estimate_project_tasks(uuid)'),
      ('function', 'private.agent_catalog_setup_write_effect_revision()'),
      ('table', 'public.estimates'),
      ('table', 'public.line_items'),
      ('table', 'public.products'),
      ('table', 'public.product_options'),
      ('table', 'public.product_materials'),
      ('table', 'public.company_inventory_settings'),
      ('table', 'public.accept_estimate_to_job_requests')
  ) required(kind, name)
  where case required.kind
    when 'function' then pg_catalog.to_regprocedure(required.name) is null
    else pg_catalog.to_regclass(required.name) is null
  end;
  if v_missing is not null then
    raise exception 'estimate_accept_missing_counts_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure('private.estimate_recipe_count_lines(uuid)') is not null
     or pg_catalog.to_regprocedure('private.estimate_recipe_count_hold_active()') is not null
     or pg_catalog.to_regprocedure('private.assert_estimate_accept_recipe_counts(uuid)') is not null then
    raise exception 'estimate_accept_missing_counts_already_installed' using errcode = '55000';
  end if;

  -- Every body replaced here, and every body this rule is proved against, is
  -- the body production runs today.
  select pg_catalog.array_agg(expected.signature order by expected.signature)
    into v_drifted
  from (
    values
      -- Replaced here.
      ('public.accept_estimate_to_job(uuid,text)', '3c61ba998d52ae3f42db9133a50fb27b'),
      -- Relied on, unchanged: the booking this rule protects, the plan whose
      -- predicate and line filter the check restates, the job writes the check
      -- runs ahead of, the path deliberately left alone, and the seal.
      ('private.persist_estimate_material_booking_projection(uuid,uuid)', '45957758c5fd5bccb35f902e1cd589c3'),
      ('private.resolve_estimate_material_demand_plan(uuid,uuid)', '9541f4512b764ea867635c32baa899a8'),
      ('private.sync_accepted_estimate_project_tasks(uuid)', '7190e77637656ab408767cecc7b4b34a'),
      ('public.accept_estimate_to_job_from_quickbooks(uuid,uuid,uuid,text,text)', 'c8ada4851e5b2d7844c11eab5eb79d74'),
      ('private.agent_catalog_setup_write_effect_revision()', 'a56dcc88d2f1a917d48833066bd6eb32')
  ) expected(signature, fingerprint)
  join pg_catalog.pg_proc proc on proc.oid = pg_catalog.to_regprocedure(expected.signature)
  where pg_catalog.md5(proc.prosrc) is distinct from expected.fingerprint;
  if v_drifted is not null then
    raise exception 'estimate_accept_missing_counts_source_drift: %',
      pg_catalog.array_to_string(v_drifted, ',') using errcode = '55000';
  end if;

  -- Recorded so the postflight can prove the catalogue write seal did not move.
  perform pg_catalog.set_config('ops.estimate_accept_missing_counts_effect_before',
    private.agent_catalog_setup_write_effect_revision(), true);
end;
$prerequisites$;

-- ── The temporary hold ─────────────────────────────────────────────────────
-- STEP 1 OF 3. While this returns true, public.accept_estimate_to_job refuses
-- every tracked-inventory estimate whose booked lines include a product with a
-- live count-scaled recipe line, whatever its counts say: the iOS editors
-- invent counts (LineItemEditSheet.swift:458 seeds `Int(defaultValue ?? "0")
-- ?? 0`, DesignToEstimateAdapter.swift:143 falls back to `.integer(0)`), so no
-- count on such a line can be trusted.
--
-- HOW AND WHEN IT IS LIFTED. Only by the step 3 migration, written after every
-- Canpro device runs the iOS build that leaves counts blank, shows them blank
-- and requires them before save (step 2). That migration clears the integer
-- count defaults and replaces this body with `select false` in the same
-- transaction; from then on the missing-count check alone decides. Nothing
-- else lifts the hold — no setting, row or flag is read here.
create function private.estimate_recipe_count_hold_active()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select true
$function$;

-- ── The lines ──────────────────────────────────────────────────────────────
-- Every booked line of the estimate whose product has a live count-scaled
-- recipe line, with the counts that line is missing (an empty array when every
-- count is entered). The line set and the numeric test are restated verbatim
-- from private.resolve_estimate_material_demand_plan (md5 9541f451…), so
-- "missing" here is exactly where the resolver books 0 and warns
-- scaled_option_value_missing. SECURITY INVOKER like the resolver, so both see
-- the same rows under the caller's RLS. Empty array when the estimate has no
-- such line or is not visible.
create function private.estimate_recipe_count_lines(p_estimate_id uuid)
returns jsonb
language sql
stable
set search_path = public, private, pg_temp
as $function$
  with estimate_scope as (
    select estimate_row.id,
           estimate_row.company_id
      from public.estimates estimate_row
     where estimate_row.id = p_estimate_id
       and estimate_row.deleted_at is null
  ),
  booked_lines as (
    select line_item.id as line_item_id,
           line_item.product_id,
           line_item.name as line_name,
           coalesce(line_item.sort_order, 0) as sort_order,
           coalesce(line_item.configured_options, '{}'::jsonb) as configured_options,
           product_row.name as product_name
      from estimate_scope
      join public.line_items line_item
        on line_item.company_id = estimate_scope.company_id
       and line_item.estimate_id = estimate_scope.id
      join public.products product_row
        on product_row.id = line_item.product_id
       and product_row.company_id = line_item.company_id
       and product_row.deleted_at is null
     where line_item.product_id is not null
       and coalesce(line_item.is_selected, true) = true
       and (
         coalesce(line_item.is_optional, false) = false
         or line_item.is_selected = true
       )
  ),
  scaled_counts as (
    select distinct
           booked_lines.line_item_id,
           booked_lines.product_id,
           booked_lines.line_name,
           booked_lines.sort_order,
           booked_lines.product_name,
           material_row.scaled_by_option_id,
           booked_lines.configured_options -> material_row.scaled_by_option_id::text as configured_value
      from booked_lines
      join public.product_materials material_row
        on material_row.product_id = booked_lines.product_id
       and material_row.deleted_at is null
       and material_row.scaled_by_option_id is not null
  ),
  judged_counts as (
    select scaled_counts.*,
           case
             when scaled_counts.configured_value is null then true
             when jsonb_typeof(scaled_counts.configured_value) = 'number' then false
             when jsonb_typeof(scaled_counts.configured_value) = 'string'
                  and (scaled_counts.configured_value #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
               then false
             else true
           end as is_missing
      from scaled_counts
  ),
  per_line as (
    select judged_counts.line_item_id,
           judged_counts.product_id,
           judged_counts.line_name,
           judged_counts.sort_order,
           judged_counts.product_name,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'product_option_id', judged_counts.scaled_by_option_id,
                 'name', coalesce(nullif(btrim(option_row.name), ''), 'Unnamed count'),
                 'configured_value', judged_counts.configured_value
               )
               order by option_row.sort_order nulls last,
                        option_row.name,
                        judged_counts.scaled_by_option_id
             ) filter (where judged_counts.is_missing),
             '[]'::jsonb
           ) as missing
      from judged_counts
      left join public.product_options option_row
        on option_row.id = judged_counts.scaled_by_option_id
     group by judged_counts.line_item_id,
              judged_counts.product_id,
              judged_counts.line_name,
              judged_counts.sort_order,
              judged_counts.product_name
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_item_id', per_line.line_item_id,
        'product_id', per_line.product_id,
        'product_name', coalesce(
          nullif(btrim(per_line.product_name), ''),
          nullif(btrim(per_line.line_name), ''),
          'Unnamed product'
        ),
        'missing_counts', per_line.missing
      )
      order by per_line.sort_order, per_line.line_item_id
    ),
    '[]'::jsonb
  )
  from per_line
$function$;

-- ── The refusals ───────────────────────────────────────────────────────────
-- For a tracked-inventory estimate: the hold first, then the missing-count
-- check. Returns quietly otherwise. See the header for the contract.
create function private.assert_estimate_accept_recipe_counts(p_estimate_id uuid)
returns void
language plpgsql
stable
set search_path = public, private, pg_temp
as $function$
declare
  v_inventory_mode text;
  v_lines jsonb;
  v_gaps jsonb;
  v_held jsonb;
  v_names text[];
  v_product_total integer;
  v_count_total integer;
  v_listed text;
  v_noun text;
begin
  if p_estimate_id is null then
    raise exception 'estimate_id_required' using errcode = '22023';
  end if;

  select coalesce(settings.inventory_mode, 'off')
    into v_inventory_mode
    from public.estimates estimate_row
    join public.company_inventory_settings settings
      on settings.company_id = estimate_row.company_id
   where estimate_row.id = p_estimate_id
     and estimate_row.deleted_at is null;

  if coalesce(v_inventory_mode, 'off') <> 'tracked' then
    return;
  end if;

  v_lines := private.estimate_recipe_count_lines(p_estimate_id);

  if jsonb_array_length(v_lines) = 0 then
    return;
  end if;

  -- The hold: no count on a count-driven line is trusted yet.
  if private.estimate_recipe_count_hold_active() then
    with held as (
      select line_item.value ->> 'product_id' as product_id,
             min(line_item.value ->> 'product_name') as product_name,
             min(line_item.ordinality) as first_line,
             jsonb_agg(line_item.value -> 'line_item_id' order by line_item.ordinality) as line_item_ids
        from jsonb_array_elements(v_lines) with ordinality as line_item(value, ordinality)
       group by line_item.value ->> 'product_id'
    ),
    ranked as (
      select held.*,
             row_number() over (order by held.first_line, held.product_id) as product_rank
        from held
    )
    select count(*)::integer,
           array_agg(ranked.product_name order by ranked.product_rank)
             filter (where ranked.product_rank <= 3),
           jsonb_agg(
             jsonb_build_object(
               'product_id', ranked.product_id,
               'product_name', ranked.product_name,
               'line_item_ids', ranked.line_item_ids
             )
             order by ranked.product_rank
           )
      into v_product_total, v_names, v_held
      from ranked;

    v_listed := case v_product_total
      when 1 then v_names[1]
      when 2 then v_names[1] || ' and ' || v_names[2]
      when 3 then v_names[1] || ', ' || v_names[2] || ' and ' || v_names[3]
      else array_to_string(v_names, ', ') || format(
        ' and %s more %s',
        v_product_total - 3,
        case when v_product_total - 3 = 1 then 'product' else 'products' end
      )
    end;

    raise exception using
      errcode = '22023',
      message = format(
        '%s can''t be accepted from the app until the next OPS update. The estimate is safe to leave as is.',
        v_listed
      ),
      detail = jsonb_build_object(
        'code', 'estimate_accept_recipe_counts_hold',
        'estimate_id', p_estimate_id,
        'products', v_held
      )::text,
      hint = 'estimate_accept_recipe_counts_hold';
  end if;

  -- The counts: every count a booked line's recipe scales by must be entered.
  select coalesce(jsonb_agg(line_item.value order by line_item.ordinality), '[]'::jsonb)
    into v_gaps
    from jsonb_array_elements(v_lines) with ordinality as line_item(value, ordinality)
   where jsonb_array_length(line_item.value -> 'missing_counts') > 0;

  if jsonb_array_length(v_gaps) = 0 then
    return;
  end if;

  with missing as (
    select line_item.ordinality as line_order,
           line_item.value ->> 'product_id' as product_id,
           line_item.value ->> 'product_name' as product_name,
           count_item.value ->> 'product_option_id' as product_option_id,
           count_item.value ->> 'name' as count_name
      from jsonb_array_elements(v_gaps) with ordinality as line_item(value, ordinality)
     cross join lateral jsonb_array_elements(line_item.value -> 'missing_counts')
       as count_item(value)
  ),
  per_count as (
    select missing.product_id,
           missing.product_option_id,
           min(missing.product_name) as product_name,
           min(missing.count_name) as count_name,
           min(missing.line_order) as first_line
      from missing
     group by missing.product_id, missing.product_option_id
  ),
  per_product as (
    select per_count.product_id,
           min(per_count.product_name) as product_name,
           min(per_count.first_line) as first_line,
           count(*)::integer as count_total,
           string_agg(
             per_count.count_name,
             ', '
             order by option_row.sort_order nulls last,
                      per_count.count_name,
                      per_count.product_option_id
           ) as count_names
      from per_count
      left join public.product_options option_row
        on option_row.id::text = per_count.product_option_id
     group by per_count.product_id
  ),
  ranked as (
    select per_product.*,
           row_number() over (order by per_product.first_line, per_product.product_id) as product_rank
      from per_product
  )
  select count(*)::integer,
         sum(ranked.count_total)::integer,
         string_agg(ranked.product_name || ': ' || ranked.count_names, '; ' order by ranked.product_rank)
           filter (where ranked.product_rank <= 3)
    into v_product_total, v_count_total, v_listed
    from ranked;

  if v_product_total > 3 then
    v_listed := v_listed || format(
      '; and %s more %s',
      v_product_total - 3,
      case when v_product_total - 3 = 1 then 'product' else 'products' end
    );
  end if;

  v_noun := case when v_count_total = 1 then 'count' else 'counts' end;

  raise exception using
    errcode = '22023',
    message = format(
      'Missing %s on %s. Open the estimate, enter the %s, accept again.',
      v_noun, v_listed, v_noun
    ),
    detail = jsonb_build_object(
      'code', 'estimate_accept_recipe_counts_missing',
      'estimate_id', p_estimate_id,
      'lines', v_gaps
    )::text,
    hint = 'estimate_accept_recipe_counts_missing';
end;
$function$;

-- ── Acceptance ─────────────────────────────────────────────────────────────
-- Production's body (md5 3c61ba99…) with one block added after the replay
-- check. The postflight proves the body minus that block is byte-exact.
create or replace function public.accept_estimate_to_job(p_estimate_id uuid, p_idempotency_key text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := now();
  v_actor_user_id uuid;
  v_actor_company_id uuid;
  v_tasks_edit_scope text;
  v_estimate_company_id uuid;
  v_request_status text;
  v_request_response jsonb;
  v_project_result jsonb;
  v_booking_result jsonb;
  v_notification_result jsonb;
  v_project_id uuid;
  v_missing_mappings jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_estimate_id is null then
    raise exception 'estimate_id_required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  if char_length(p_idempotency_key) > 200 then
    raise exception 'idempotency_key_too_long' using errcode = '22023';
  end if;

  v_actor_user_id := private.get_current_user_id();
  v_actor_company_id := private.get_user_company_id();

  if v_actor_user_id is null or v_actor_company_id is null then
    raise exception 'actor_not_found' using errcode = '42501';
  end if;

  v_tasks_edit_scope := private.current_user_scope_for('tasks.edit');
  if not private.current_user_is_admin()
     and coalesce(v_tasks_edit_scope, '') not in ('all', 'assigned') then
    raise exception 'tasks_edit_required' using errcode = '42501';
  end if;

  select estimate_row.company_id
    into v_estimate_company_id
    from public.estimates estimate_row
   where estimate_row.id = p_estimate_id
     and estimate_row.deleted_at is null
   for update;

  if not found then
    raise exception 'estimate_not_found' using errcode = 'P0002';
  end if;

  if v_estimate_company_id is distinct from v_actor_company_id then
    raise exception 'estimate_company_scope_mismatch'
      using errcode = '42501';
  end if;

  perform set_config('ops.accept_estimate_to_job_rpc', 'on', true);

  insert into public.accept_estimate_to_job_requests (
    company_id,
    estimate_id,
    idempotency_key,
    status,
    response,
    error_code,
    created_by,
    created_at,
    updated_at
  ) values (
    v_actor_company_id,
    p_estimate_id,
    btrim(p_idempotency_key),
    'in_progress',
    null,
    null,
    v_actor_user_id,
    v_now,
    v_now
  )
  on conflict (company_id, estimate_id, idempotency_key)
  do update
    set updated_at = v_now
  returning status, response
    into v_request_status, v_request_response;

  if v_request_status = 'completed' and v_request_response is not null then
    return v_request_response || jsonb_build_object(
      'idempotent_replay', true
    );
  end if;

  -- Refuse before any job work when a booked line's recipe counts cannot be
  -- trusted or are missing. Nothing but the request row above exists yet, and
  -- the raise rolls it back, so a retry with the same key runs fresh.
  perform private.assert_estimate_accept_recipe_counts(p_estimate_id);

  v_project_result := private.sync_accepted_estimate_project_tasks(p_estimate_id);
  v_project_id := private.try_parse_uuid(v_project_result ->> 'project_id');

  if v_project_id is null then
    raise exception 'accepted_project_id_missing'
      using errcode = '23514';
  end if;

  v_booking_result := private.persist_estimate_material_booking_projection(
    p_estimate_id,
    v_project_id
  );

  v_missing_mappings := coalesce(v_booking_result -> 'missing_mappings', '[]'::jsonb);

  if jsonb_typeof(v_missing_mappings) <> 'array' then
    raise exception 'booking_missing_mappings_array_required'
      using errcode = '23514';
  end if;

  v_notification_result :=
    private.persist_catalog_mapping_notifications_from_missing_mappings(
      v_actor_company_id,
      v_missing_mappings
    );

  v_response := jsonb_build_object(
    'ok', true,
    'estimate_id', p_estimate_id,
    'project_id', v_project_id,
    'actor_user_id', v_actor_user_id,
    'company_id', v_actor_company_id,
    'idempotency_key', btrim(p_idempotency_key),
    'idempotent_replay', false,
    'project_task_result', v_project_result,
    'booking_projection_result', v_booking_result,
    'mapping_notification_result', v_notification_result,
    'inventory_mode', coalesce(v_booking_result ->> 'inventory_mode', 'off'),
    'warnings', coalesce(v_booking_result -> 'warnings', '[]'::jsonb),
    'overruns', coalesce(v_booking_result -> 'overruns', '[]'::jsonb),
    'missing_mappings', v_missing_mappings,
    'demand_ids', coalesce(v_booking_result -> 'demand_ids', '[]'::jsonb),
    'accepted_at', v_now
  );

  update public.accept_estimate_to_job_requests request_row
     set status = 'completed',
         response = v_response,
         error_code = null,
         updated_at = v_now
   where request_row.company_id = v_actor_company_id
     and request_row.estimate_id = p_estimate_id
     and request_row.idempotency_key = btrim(p_idempotency_key)
     and request_row.created_by = v_actor_user_id;

  return v_response;
end;
$function$;

-- ── Grants ─────────────────────────────────────────────────────────────────
-- accept_estimate_to_job and everything it now calls run as the calling app
-- role (the iOS app reaches PostgREST as the Firebase-bridged anon or
-- authenticated role), exactly like the resolver and the booking projection:
-- {postgres, anon, authenticated}. Nothing else.
do $acl$
declare f record;
begin
  for f in
    select * from (values
      ('public.accept_estimate_to_job(uuid,text)'),
      ('private.estimate_recipe_count_hold_active()'),
      ('private.estimate_recipe_count_lines(uuid)'),
      ('private.assert_estimate_accept_recipe_counts(uuid)')
    ) target(signature)
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',
      f.signature);
    execute format('grant execute on function %s to anon, authenticated',
      f.signature);
  end loop;
end $acl$;

comment on function private.estimate_recipe_count_hold_active() is
  'Step 1 of 3: true holds acceptance of every tracked-inventory estimate carrying a count-driven product, because iOS invents counts. Lifted only by the step 3 migration (select false) once Canpro devices run the iOS build that leaves counts blank.';
comment on function private.estimate_recipe_count_lines(uuid) is
  'Booked estimate lines whose product has live count-scaled recipe lines, each with the counts it is missing per the resolver''s own predicate. JSON array per line.';
comment on function private.assert_estimate_accept_recipe_counts(uuid) is
  'Raises 22023 for a tracked-inventory estimate: hint estimate_accept_recipe_counts_hold while the hold is active and a count-driven product is booked, else hint estimate_accept_recipe_counts_missing when a recipe count is blank. Called by accept_estimate_to_job before any job work.';

do $postflight$
declare
  f record;
  v_role text;
  v_accept text;
  v_guard constant text := $guard$  -- Refuse before any job work when a booked line's recipe counts cannot be
  -- trusted or are missing. Nothing but the request row above exists yet, and
  -- the raise rolls it back, so a retry with the same key runs fresh.
  perform private.assert_estimate_accept_recipe_counts(p_estimate_id);

$guard$;
  v_assert text;
  v_unproved text[];
  v_effect_before text;
  v_effect_after text;
begin
  -- Acceptance: production's body plus exactly the guard block, in place.
  select proc.prosrc into v_accept
    from pg_catalog.pg_proc proc
   where proc.oid = 'public.accept_estimate_to_job(uuid,text)'::regprocedure;
  if pg_catalog.md5(pg_catalog.replace(v_accept, v_guard, '')) is distinct from '3c61ba998d52ae3f42db9133a50fb27b'
     or (length(v_accept) - length(pg_catalog.replace(v_accept, v_guard, ''))) <> length(v_guard) then
    raise exception 'estimate_accept_missing_counts_accept_body_wrong' using errcode = '55000';
  end if;
  if pg_catalog.strpos(v_accept, 'private.assert_estimate_accept_recipe_counts(')
       < pg_catalog.strpos(v_accept, '''idempotent_replay'', true')
     or pg_catalog.strpos(v_accept, 'private.assert_estimate_accept_recipe_counts(')
       > pg_catalog.strpos(v_accept, 'private.sync_accepted_estimate_project_tasks(') then
    raise exception 'estimate_accept_missing_counts_guard_misplaced' using errcode = '55000';
  end if;

  -- The hold is decided before the counts.
  select proc.prosrc into v_assert
    from pg_catalog.pg_proc proc
   where proc.oid = 'private.assert_estimate_accept_recipe_counts(uuid)'::regprocedure;
  if pg_catalog.strpos(v_assert, 'private.estimate_recipe_count_hold_active()') = 0
     or pg_catalog.strpos(v_assert, 'estimate_accept_recipe_counts_hold')
       > pg_catalog.strpos(v_assert, 'estimate_accept_recipe_counts_missing') then
    raise exception 'estimate_accept_missing_counts_hold_misplaced' using errcode = '55000';
  end if;

  -- The bodies installed are the bodies proved locally
  -- (docs/artifacts/estimate-accept-missing-counts/local-proof.md).
  select pg_catalog.array_agg(expected.signature || ' = ' || pg_catalog.md5(proc.prosrc)
                              order by expected.signature)
    into v_unproved
    from (values
      ('public.accept_estimate_to_job(uuid,text)', '9f533799f54d0fae2f5aa062038283d0'),
      ('private.estimate_recipe_count_hold_active()', '12121c1c821d63ac9833861df2e81850'),
      ('private.estimate_recipe_count_lines(uuid)', '1941e484c70701699fc6b0d7e770dfef'),
      ('private.assert_estimate_accept_recipe_counts(uuid)', '5cb8912c66ab91417afcc9fb5c56b80c')
    ) expected(signature, fingerprint)
    join pg_catalog.pg_proc proc on proc.oid = expected.signature::regprocedure
   where pg_catalog.md5(proc.prosrc) is distinct from expected.fingerprint;
  if v_unproved is not null then
    raise exception 'estimate_accept_missing_counts_body_unproved: %',
      pg_catalog.array_to_string(v_unproved, ', ') using errcode = '55000';
  end if;

  -- Everything else this rule leans on is untouched.
  for f in
    select * from (values
      ('private.persist_estimate_material_booking_projection(uuid,uuid)', '45957758c5fd5bccb35f902e1cd589c3'),
      ('private.resolve_estimate_material_demand_plan(uuid,uuid)', '9541f4512b764ea867635c32baa899a8'),
      ('private.sync_accepted_estimate_project_tasks(uuid)', '7190e77637656ab408767cecc7b4b34a'),
      ('public.accept_estimate_to_job_from_quickbooks(uuid,uuid,uuid,text,text)', 'c8ada4851e5b2d7844c11eab5eb79d74')
    ) expected(signature, fingerprint)
  loop
    if (select pg_catalog.md5(proc.prosrc) from pg_catalog.pg_proc proc
         where proc.oid = f.signature::regprocedure) is distinct from f.fingerprint then
      raise exception 'estimate_accept_missing_counts_collateral_change: %', f.signature
        using errcode = '55000';
    end if;
  end loop;

  -- Posture: invoker, pinned search_path, and executable by exactly the app
  -- roles that call acceptance.
  for f in
    select proc.oid, proc.proname, proc.prosecdef, proc.proconfig, proc.provolatile,
           pg_catalog.pg_get_userbyid(proc.proowner) as owner
      from pg_catalog.pg_proc proc
     where proc.oid in (
       'public.accept_estimate_to_job(uuid,text)'::regprocedure,
       'private.estimate_recipe_count_hold_active()'::regprocedure,
       'private.estimate_recipe_count_lines(uuid)'::regprocedure,
       'private.assert_estimate_accept_recipe_counts(uuid)'::regprocedure
     )
  loop
    if f.prosecdef
       or f.owner <> 'postgres'
       or f.proconfig is distinct from (case f.proname
            when 'estimate_recipe_count_hold_active' then array['search_path=""']
            else array['search_path=public, private, pg_temp'] end)
       or (f.proname <> 'accept_estimate_to_job' and f.provolatile <> 's') then
      raise exception 'estimate_accept_missing_counts_posture_wrong: %', f.proname
        using errcode = '55000';
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if not pg_catalog.has_function_privilege(v_role, f.oid, 'execute') then
        raise exception 'estimate_accept_missing_counts_unreachable: % by %', f.proname, v_role
          using errcode = '42501';
      end if;
    end loop;
    if pg_catalog.has_function_privilege('public', f.oid, 'execute')
       or pg_catalog.has_function_privilege('service_role', f.oid, 'execute') then
      raise exception 'estimate_accept_missing_counts_overexposed: %', f.proname
        using errcode = '42501';
    end if;
  end loop;

  -- The hold is on, and the checks answer quietly for an estimate that does
  -- not exist.
  if private.estimate_recipe_count_hold_active() is distinct from true then
    raise exception 'estimate_accept_missing_counts_hold_not_active' using errcode = '55000';
  end if;
  if private.estimate_recipe_count_lines(gen_random_uuid()) is distinct from '[]'::jsonb then
    raise exception 'estimate_accept_missing_counts_lines_wrong' using errcode = '55000';
  end if;
  perform private.assert_estimate_accept_recipe_counts(gen_random_uuid());

  -- The catalogue write seal reads exactly what it read before.
  v_effect_before := nullif(pg_catalog.current_setting(
    'ops.estimate_accept_missing_counts_effect_before', true), '');
  v_effect_after := private.agent_catalog_setup_write_effect_revision();
  if v_effect_before is null or v_effect_after is distinct from v_effect_before then
    raise exception 'estimate_accept_missing_counts_effect_moved' using errcode = '55000';
  end if;

  raise notice 'estimate acceptance: count-driven products held, missing recipe counts refused (tracked inventory), no data changed, catalogue write seal unchanged';
end;
$postflight$;

commit;
