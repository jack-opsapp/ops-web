-- Project <-> opportunity link invariants.
--
-- The project model has a normalized UUID link (opportunity_ref) and a legacy
-- text mirror (opportunity_id). Opportunities likewise retain project_ref and
-- project_id UUID mirrors. Historically, ordinary ProjectService inserts wrote
-- only projects.opportunity_id, while the conversion RPC returned early when
-- an opportunity already had project_ref. Both paths could therefore leave a
-- real project attached to a non-won opportunity with incomplete mirrors.
--
-- This migration is additive and performs no data backfill. It:
--   1. normalizes both project-side mirrors on future writes (without casting
--      arbitrary legacy text),
--   2. enforces the reverse opportunity mirrors and one-time won transition for
--      ordinary project writes, and
--   3. hardens convert_opportunity_to_project, including its idempotent branch.

begin;

-- BEFORE trigger: choose the FK-backed UUID when present; otherwise adopt the
-- legacy text field only when it is safely UUID-shaped. Non-UUID legacy values
-- remain untouched and never reach a ::uuid cast.
create or replace function public.normalize_project_opportunity_link()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_opportunity_id uuid;
begin
  if new.opportunity_ref is not null then
    v_opportunity_id := new.opportunity_ref;
  elsif new.opportunity_id is not null
    and btrim(new.opportunity_id) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_opportunity_id := new.opportunity_id::uuid;
  else
    return new;
  end if;

  if not exists (
    select 1
      from public.opportunities o
     where o.id = v_opportunity_id
       and o.company_id = new.company_id
       and o.deleted_at is null
  ) then
    raise exception 'project opportunity link must reference an active opportunity in the same company'
      using errcode = '23503';
  end if;

  new.opportunity_ref := v_opportunity_id;
  new.opportunity_id := v_opportunity_id::text;
  return new;
end;
$function$;

-- AFTER trigger: the project row now exists, so writing its UUID into the
-- opportunity's FK-backed project_ref cannot violate the immediate FK. The
-- opportunity row is locked before the stage check, making the won transition
-- and stage_transitions insert exactly-once under concurrent writes.
create or replace function public.enforce_project_opportunity_link()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_new_opportunity_id uuid;
  v_old_opportunity_id uuid;
  v_from_stage text;
  v_stage_entered_at timestamptz;
  v_existing_project_ref uuid;
  v_existing_project_legacy uuid;
  v_existing_project_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.opportunity_ref is not null then
      v_old_opportunity_id := old.opportunity_ref;
    elsif old.opportunity_id is not null
      and btrim(old.opportunity_id) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      v_old_opportunity_id := old.opportunity_id::uuid;
    end if;

    if v_old_opportunity_id is not null
      and coalesce(auth.role(), '') <> 'service_role'
    then
      if old.company_id is distinct from private.get_user_company_id()
        or not private.current_user_has_permission('pipeline.manage', 'all')
      then
        raise exception 'access_denied' using errcode = '42501';
      end if;
    end if;

    if current_setting('ops.skip_project_opportunity_invariant', true) = 'on' then
      return old;
    end if;

    if v_old_opportunity_id is not null then
      update public.opportunities
         set project_ref = null,
             project_id = null,
             updated_at = now()
       where id = v_old_opportunity_id
         and company_id = old.company_id
         and (project_ref = old.id or project_id = old.id);
    end if;
    return old;
  end if;

  if new.opportunity_ref is not null then
    v_new_opportunity_id := new.opportunity_ref;
  elsif new.opportunity_id is not null
    and btrim(new.opportunity_id) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_new_opportunity_id := new.opportunity_id::uuid;
  end if;

  if tg_op = 'UPDATE' then
    if old.opportunity_ref is not null then
      v_old_opportunity_id := old.opportunity_ref;
    elsif old.opportunity_id is not null
      and btrim(old.opportunity_id) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      v_old_opportunity_id := old.opportunity_id::uuid;
    end if;

  end if;

  -- This SECURITY DEFINER trigger may mutate opportunities and append a stage
  -- transition. Tenant membership alone is not authority to do either. Match
  -- the conversion RPC's company + pipeline.manage guard before any side
  -- effect, including unlink cleanup. Service-role ingestion remains allowed.
  if v_new_opportunity_id is not null or v_old_opportunity_id is not null then
    if coalesce(auth.role(), '') <> 'service_role' then
      if new.company_id is distinct from private.get_user_company_id()
        or not private.current_user_has_permission('pipeline.manage', 'all')
      then
        raise exception 'access_denied' using errcode = '42501';
      end if;
    end if;
  end if;

  -- The conversion RPC owns the same transaction and preserves the explicit
  -- p_win_opportunity=false contract. It suppresses only this AFTER side effect
  -- while still passing through the BEFORE normalizer above. Authorization is
  -- deliberately checked above so a caller cannot bypass it by setting a GUC.
  if current_setting('ops.skip_project_opportunity_invariant', true) = 'on' then
    return new;
  end if;

  -- Soft deletion releases both reverse mirrors and never runs activation/won
  -- logic. Otherwise idempotent conversion sees an inactive linked project and
  -- cannot safely repair or replace it.
  if new.deleted_at is not null then
    if tg_op = 'UPDATE' and v_old_opportunity_id is not null then
      update public.opportunities
         set project_ref = null,
             project_id = null,
             updated_at = now()
       where id = v_old_opportunity_id
         and company_id = old.company_id
         and (project_ref = new.id or project_id = new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if v_old_opportunity_id is distinct from v_new_opportunity_id
      and v_old_opportunity_id is not null
    then
      update public.opportunities
         set project_ref = null,
             project_id = null,
             updated_at = now()
       where id = v_old_opportunity_id
         and company_id = old.company_id
         and (project_ref = new.id or project_id = new.id);
    end if;
  end if;

  if v_new_opportunity_id is null then
    return new;
  end if;

  -- A project created/linked directly is a commercial commitment and wins the
  -- opportunity. Approval-queue RPC inserts opt out transaction-locally above.
  -- For an already-linked RFQ/estimate, wait until the project is explicitly
  -- activated; unrelated edits must not change the opportunity stage.
  if tg_op = 'UPDATE'
    and v_old_opportunity_id is not distinct from v_new_opportunity_id
    and old.company_id is not distinct from new.company_id
    and not (new.status in ('accepted', 'in_progress', 'completed', 'closed'))
  then
    return new;
  end if;

  select o.stage, o.stage_entered_at, o.project_ref, o.project_id
    into v_from_stage, v_stage_entered_at,
         v_existing_project_ref, v_existing_project_legacy
    from public.opportunities o
   where o.id = v_new_opportunity_id
     and o.company_id = new.company_id
     and o.deleted_at is null
   for update;

  if not found then
    raise exception 'project opportunity link target was not found'
      using errcode = '23503';
  end if;

  if v_existing_project_ref is not null
    and v_existing_project_legacy is not null
    and v_existing_project_ref is distinct from v_existing_project_legacy
  then
    raise exception 'opportunity project mirrors disagree'
      using errcode = '23505';
  end if;

  v_existing_project_id := coalesce(
    v_existing_project_ref,
    v_existing_project_legacy
  );

  if v_existing_project_id is not null
    and v_existing_project_id is distinct from new.id
  then
    raise exception 'opportunity is already linked to another project'
      using errcode = '23505';
  end if;

  update public.opportunities
     set project_ref = new.id,
         project_id = new.id,
         stage = 'won',
         stage_entered_at = case
           when v_from_stage is distinct from 'won' then now()
           else stage_entered_at
         end,
         stage_manually_set = true,
         actual_close_date = coalesce(actual_close_date, now()::date),
         updated_at = now()
   where id = v_new_opportunity_id
     and company_id = new.company_id;

  if v_from_stage is distinct from 'won' then
    insert into public.stage_transitions (
      company_id,
      opportunity_id,
      from_stage,
      to_stage,
      transitioned_at,
      transitioned_by,
      duration_in_stage
    ) values (
      new.company_id,
      v_new_opportunity_id,
      v_from_stage,
      'won',
      now(),
      null,
      now() - coalesce(v_stage_entered_at, now())
    );
  end if;

  return new;
end;
$function$;

revoke all on function public.normalize_project_opportunity_link()
  from public, anon, authenticated;
revoke all on function public.enforce_project_opportunity_link()
  from public, anon, authenticated;

drop trigger if exists projects_normalize_opportunity_link on public.projects;
create trigger projects_normalize_opportunity_link
before insert or update of opportunity_id, opportunity_ref, company_id on public.projects
for each row execute function public.normalize_project_opportunity_link();

drop trigger if exists projects_enforce_opportunity_link on public.projects;
create trigger projects_enforce_opportunity_link
after insert or delete or update of opportunity_id, opportunity_ref, company_id, status, deleted_at on public.projects
for each row execute function public.enforce_project_opportunity_link();

-- Replace the deployed conversion function. The shape and grants remain
-- compatible; only link invariants, idempotent repair, and trigger coordination
-- change.
create or replace function public.convert_opportunity_to_project(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_actual_value numeric default null::numeric,
  p_expected_stage text default null::text,
  p_decided_by uuid default null::uuid,
  p_notes text default null::text,
  p_title_override text default null::text,
  p_link_to_project_id uuid default null::uuid,
  p_source_path text default null::text,
  p_win_opportunity boolean default true,
  p_project_status text default null::text,
  p_evidence jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_opp public.opportunities%rowtype;
  v_project_id uuid;
  v_project_opportunity_ref uuid;
  v_project_opportunity_id text;
  v_status text;
  v_value numeric;
  v_platform jsonb;
  v_disposition_id uuid;
  v_relinked bigint := 0;
  v_tasks bigint := 0;
  v_photos bigint := 0;
  v_won boolean := false;
  v_linked_existing boolean := (p_link_to_project_id is not null);
  v_created_by uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if p_company_id is distinct from private.get_user_company_id() then
      raise exception 'access_denied' using errcode = '42501';
    end if;
    if not private.current_user_has_permission('pipeline.manage', 'all') then
      raise exception 'access_denied' using errcode = '42501';
    end if;
  end if;

  if p_company_id is null or p_opportunity_id is null then
    raise exception 'company and opportunity ids are required' using errcode = '22023';
  end if;

  select *
    into v_opp
    from public.opportunities
   where id = p_opportunity_id
     and company_id = p_company_id
   for update;

  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;
  if v_opp.deleted_at is not null then
    raise exception 'opportunity is soft-deleted' using errcode = '22023';
  end if;

  -- Idempotent calls are also repair calls. The old function returned here
  -- before mirroring either row or honoring p_win_opportunity.
  if v_opp.project_ref is not null
    and v_opp.project_id is not null
    and v_opp.project_ref is distinct from v_opp.project_id
  then
    raise exception 'opportunity project mirrors disagree'
      using errcode = '23505';
  end if;

  if coalesce(v_opp.project_ref, v_opp.project_id) is not null then
    v_project_id := coalesce(v_opp.project_ref, v_opp.project_id);

    select p.opportunity_ref, p.opportunity_id
      into v_project_opportunity_ref, v_project_opportunity_id
      from public.projects p
     where p.id = v_project_id
       and p.company_id = p_company_id
       and p.deleted_at is null
     for update;
    if not found then
      raise exception 'linked project not found in opportunity company'
        using errcode = 'P0002';
    end if;
    if v_project_opportunity_ref is not null
      and v_project_opportunity_ref is distinct from p_opportunity_id
    then
      raise exception 'linked project belongs to another opportunity'
        using errcode = '23505';
    end if;
    if v_project_opportunity_ref is null
      and v_project_opportunity_id is not null
      and btrim(v_project_opportunity_id) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and v_project_opportunity_id::uuid is distinct from p_opportunity_id
    then
      raise exception 'linked project legacy mirror belongs to another opportunity'
        using errcode = '23505';
    end if;

    perform set_config('ops.skip_project_opportunity_invariant', 'on', true);
    update public.projects
       set opportunity_ref = p_opportunity_id,
           opportunity_id = p_opportunity_id::text,
           updated_at = now()
     where id = v_project_id
       and company_id = p_company_id;
    perform set_config('ops.skip_project_opportunity_invariant', 'off', true);

    update public.opportunities
       set project_ref = v_project_id,
           project_id = v_project_id,
           updated_at = now()
     where id = p_opportunity_id
       and company_id = p_company_id;

    if p_win_opportunity then
      if v_opp.stage is distinct from 'won' then
        update public.opportunities
           set stage = 'won',
               stage_entered_at = now(),
               stage_manually_set = true,
               actual_value = coalesce(p_actual_value, actual_value),
               actual_close_date = now()::date,
               updated_at = now()
         where id = p_opportunity_id
           and company_id = p_company_id;

        insert into public.stage_transitions (
          company_id,
          opportunity_id,
          from_stage,
          to_stage,
          transitioned_at,
          transitioned_by,
          duration_in_stage
        ) values (
          p_company_id,
          p_opportunity_id,
          v_opp.stage,
          'won',
          now(),
          p_decided_by,
          now() - coalesce(v_opp.stage_entered_at, now())
        );
        v_won := true;
      else
        update public.opportunities
           set actual_value = coalesce(p_actual_value, actual_value),
               updated_at = now()
         where id = p_opportunity_id
           and company_id = p_company_id;
      end if;
    end if;

    return jsonb_build_object(
      'converted', false,
      'already_converted', true,
      'guard_reason', 'already_converted',
      'project_id', v_project_id,
      'opportunity_id', p_opportunity_id,
      'links_repaired', true,
      'won', v_won
    );
  end if;
  -- end already-linked repair

  if p_expected_stage is not null
    and v_opp.stage is distinct from p_expected_stage
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'snapshot_mismatch',
      'opportunity_id', p_opportunity_id
    );
  end if;

  v_status := coalesce(
    p_project_status,
    case when p_win_opportunity then 'accepted' else 'rfq' end
  );
  v_value := coalesce(p_actual_value, v_opp.actual_value, v_opp.estimated_value);
  v_platform := case
    when v_opp.source is not null or v_opp.source_email_id is not null
      then jsonb_build_object(
        'source', v_opp.source,
        'source_email_id', v_opp.source_email_id
      )
    else null
  end;
  v_created_by := case
    when p_decided_by is not null
      and exists (select 1 from auth.users au where au.id = p_decided_by)
      then p_decided_by
    else null
  end;

  -- The RPC owns reverse-link and optional-win behavior. Suppress the AFTER
  -- trigger only for this project write; the BEFORE normalizer still runs.
  perform set_config('ops.skip_project_opportunity_invariant', 'on', true);

  if v_linked_existing then
    select p.id, p.opportunity_ref, p.opportunity_id
      into v_project_id, v_project_opportunity_ref, v_project_opportunity_id
      from public.projects p
     where p.id = p_link_to_project_id
       and p.company_id = p_company_id
       and p.deleted_at is null
     for update;

    if not found then
      raise exception 'link target project not found' using errcode = 'P0002';
    end if;
    if v_project_opportunity_ref is not null
      and v_project_opportunity_ref is distinct from p_opportunity_id
    then
      raise exception 'link target project already belongs to another opportunity'
        using errcode = '23505';
    end if;
    if v_project_opportunity_ref is null
      and v_project_opportunity_id is not null
      and btrim(v_project_opportunity_id) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and v_project_opportunity_id::uuid is distinct from p_opportunity_id
    then
      raise exception 'link target project legacy mirror belongs to another opportunity'
        using errcode = '23505';
    end if;

    update public.projects
       set opportunity_ref = p_opportunity_id,
           opportunity_id = p_opportunity_id::text,
           updated_at = now()
     where id = v_project_id;
  else
    v_project_id := gen_random_uuid();
    insert into public.projects (
      id,
      company_id,
      client_id,
      opportunity_id,
      opportunity_ref,
      title,
      title_is_auto,
      address,
      latitude,
      longitude,
      status,
      source,
      estimated_value,
      platform_metadata,
      notes,
      created_by,
      created_at,
      updated_at
    ) values (
      v_project_id,
      p_company_id,
      v_opp.client_id,
      p_opportunity_id::text,
      p_opportunity_id,
      coalesce(p_title_override, 'New project'),
      (p_title_override is null),
      v_opp.address,
      v_opp.latitude,
      v_opp.longitude,
      v_status,
      v_opp.source,
      v_value,
      v_platform,
      p_notes,
      v_created_by,
      now(),
      now()
    );
  end if;

  perform set_config('ops.skip_project_opportunity_invariant', 'off', true);

  update public.opportunities
     set project_ref = v_project_id,
         project_id = v_project_id,
         updated_at = now()
   where id = p_opportunity_id
     and company_id = p_company_id
     and (project_ref is null or project_ref = v_project_id)
     and (project_id is null or project_id = v_project_id);
  if not found then
    raise exception 'opportunity link update matched zero rows (concurrent conversion?)'
      using errcode = 'P0002';
  end if;

  update public.estimates
     set project_ref = v_project_id,
         project_id = v_project_id::text,
         updated_at = now()
   where opportunity_id = p_opportunity_id
     and company_id = p_company_id
     and deleted_at is null;
  get diagnostics v_relinked = row_count;

  insert into public.project_tasks (
    id,
    company_id,
    project_id,
    task_type_id,
    custom_title,
    source_line_item_id,
    source_estimate_id,
    status,
    display_order,
    duration,
    task_color,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    p_company_id,
    v_project_id,
    li.task_type_ref,
    li.name,
    li.id::text,
    li.estimate_id::text,
    'active',
    coalesce(li.sort_order, 0),
    coalesce(tt.default_duration, 1),
    coalesce(tt.color, '#417394'),
    now(),
    now()
  from public.line_items li
  left join public.task_types tt on tt.id = li.task_type_ref
  where li.estimate_id in (
    select e.id
      from public.estimates e
     where e.opportunity_id = p_opportunity_id
       and e.deleted_at is null
  )
    and li.type = 'LABOR'
    and not exists (
      select 1
        from public.project_tasks pt
       where pt.project_id = v_project_id
         and pt.source_line_item_id = li.id::text
    );
  get diagnostics v_tasks = row_count;

  insert into public.project_photos (
    id,
    project_id,
    company_id,
    url,
    source,
    site_visit_id,
    uploaded_by,
    taken_at,
    created_at
  )
  select
    gen_random_uuid(),
    v_project_id::text,
    p_company_id::text,
    photo_url,
    'site_visit',
    sv.id,
    sv.created_by,
    null,
    now()
  from public.site_visits sv
  cross join lateral unnest(sv.photos) as photo_url
  where sv.opportunity_id = p_opportunity_id
    and sv.deleted_at is null
    and photo_url is not null
    and photo_url <> ''
    and not exists (
      select 1
        from public.project_photos pp
       where pp.project_id = v_project_id::text
         and pp.site_visit_id = sv.id
         and pp.url = photo_url
    );
  get diagnostics v_photos = row_count;

  if p_win_opportunity then
    if v_opp.stage is distinct from 'won' then
      update public.opportunities
         set stage = 'won',
             stage_entered_at = now(),
             stage_manually_set = true,
             actual_value = coalesce(p_actual_value, actual_value),
             actual_close_date = now()::date,
             updated_at = now()
       where id = p_opportunity_id
         and company_id = p_company_id;

      insert into public.stage_transitions (
        company_id,
        opportunity_id,
        from_stage,
        to_stage,
        transitioned_at,
        transitioned_by,
        duration_in_stage
      ) values (
        p_company_id,
        p_opportunity_id,
        v_opp.stage,
        'won',
        now(),
        p_decided_by,
        now() - coalesce(v_opp.stage_entered_at, now())
      );
      v_won := true;
    else
      update public.opportunities
         set actual_value = coalesce(p_actual_value, actual_value),
             updated_at = now()
       where id = p_opportunity_id
         and company_id = p_company_id;
    end if;
  end if;

  update public.opportunity_dispositions
     set superseded_at = now()
   where opportunity_id = p_opportunity_id
     and company_id = p_company_id
     and superseded_at is null;

  insert into public.opportunity_dispositions (
    company_id,
    opportunity_id,
    disposition,
    reason_code,
    decided_via,
    decided_by,
    evidence,
    converted_project_ref
  ) values (
    p_company_id,
    p_opportunity_id,
    'converted_to_project',
    null,
    'project_conversion',
    p_decided_by,
    coalesce(p_evidence, '{}'::jsonb) || jsonb_build_object(
      'source_path', p_source_path,
      'actual_value', v_value,
      'relinked_estimates', v_relinked,
      'linked_existing', v_linked_existing,
      'won', v_won
    ),
    v_project_id
  ) returning id into v_disposition_id;

  return jsonb_build_object(
    'converted', true,
    'already_converted', false,
    'project_id', v_project_id,
    'opportunity_id', p_opportunity_id,
    'disposition_id', v_disposition_id,
    'relinked_estimates', v_relinked,
    'materialized_tasks', v_tasks,
    'attached_photos', v_photos,
    'linked_existing', v_linked_existing,
    'won', v_won
  );
end;
$function$;

grant execute on function public.convert_opportunity_to_project(
  uuid,
  uuid,
  numeric,
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  boolean,
  text,
  jsonb
) to authenticated, service_role;

commit;
