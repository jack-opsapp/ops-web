-- Fix: convert_opportunity_to_project FK violation on projects.created_by
--
-- projects.created_by is a FOREIGN KEY to auth.users(id). OPS operators
-- authenticate via Firebase and live in public.users, NOT auth.users, so
-- inserting p_decided_by (a public.users id) into created_by violates
-- projects_created_by_fkey and rolls back EVERY operator-initiated win
-- ("Deal won, but the project could not be created"). All existing projects
-- carry created_by = NULL; this restores that invariant. The function only ever
-- stores created_by when the id is a genuine auth.users id (guarded), else NULL.
-- Operator attribution is unaffected — it is still recorded on the disposition
-- (decided_by) and the stage transition (transitioned_by), neither of which
-- FKs to auth.users.
--
-- Behaviour is otherwise IDENTICAL to the deployed function (verbatim body with
-- only the created_by source changed from p_decided_by to the guarded
-- v_created_by).

CREATE OR REPLACE FUNCTION public.convert_opportunity_to_project(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_actual_value numeric DEFAULT NULL::numeric,
  p_expected_stage text DEFAULT NULL::text,
  p_decided_by uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_title_override text DEFAULT NULL::text,
  p_link_to_project_id uuid DEFAULT NULL::uuid,
  p_source_path text DEFAULT NULL::text,
  p_win_opportunity boolean DEFAULT true,
  p_project_status text DEFAULT NULL::text,
  p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_opp public.opportunities%rowtype; v_project_id uuid; v_status text; v_value numeric;
  v_platform jsonb; v_disposition_id uuid; v_relinked bigint := 0; v_tasks bigint := 0;
  v_photos bigint := 0; v_won boolean := false; v_linked_existing boolean := (p_link_to_project_id is not null);
  v_created_by uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    if p_company_id is distinct from private.get_user_company_id() then
      raise exception 'access_denied' using errcode='42501'; end if;
    if not private.current_user_has_permission('pipeline.manage','all') then
      raise exception 'access_denied' using errcode='42501'; end if;
  end if;
  if p_company_id is null or p_opportunity_id is null then
    raise exception 'company and opportunity ids are required' using errcode='22023';
  end if;

  select * into v_opp from public.opportunities
   where id = p_opportunity_id and company_id = p_company_id for update;
  if not found then raise exception 'opportunity_not_found' using errcode='P0002'; end if;
  if v_opp.deleted_at is not null then raise exception 'opportunity is soft-deleted' using errcode='22023'; end if;

  if v_opp.project_ref is not null then
    return jsonb_build_object('converted', false, 'already_converted', true,
      'guard_reason','already_converted', 'project_id', v_opp.project_ref, 'opportunity_id', p_opportunity_id);
  end if;

  if p_expected_stage is not null and v_opp.stage is distinct from p_expected_stage then
    return jsonb_build_object('converted', false, 'already_converted', false,
      'guard_reason','snapshot_mismatch', 'opportunity_id', p_opportunity_id);
  end if;

  v_status := coalesce(p_project_status, case when p_win_opportunity then 'accepted' else 'rfq' end);
  v_value  := coalesce(p_actual_value, v_opp.actual_value, v_opp.estimated_value);
  v_platform := case when v_opp.source is not null or v_opp.source_email_id is not null
                     then jsonb_build_object('source', v_opp.source, 'source_email_id', v_opp.source_email_id)
                     else null end;
  -- projects.created_by FKs auth.users(id); OPS operators (Firebase) are not in
  -- auth.users. Only ever store a genuine auth.users id, else NULL (the invariant
  -- held by every existing project). The operator is still captured on the
  -- disposition (decided_by) and the stage transition (transitioned_by) below.
  v_created_by := case
                    when p_decided_by is not null
                         and exists (select 1 from auth.users au where au.id = p_decided_by)
                    then p_decided_by
                    else null
                  end;

  if v_linked_existing then
    select id into v_project_id from public.projects
     where id = p_link_to_project_id and company_id = p_company_id and deleted_at is null for update;
    if not found then raise exception 'link target project not found' using errcode='P0002'; end if;
    update public.projects
       set opportunity_ref = p_opportunity_id, opportunity_id = p_opportunity_id::text, updated_at = now()
     where id = v_project_id;
  else
    v_project_id := gen_random_uuid();
    insert into public.projects (
      id, company_id, client_id, opportunity_id, opportunity_ref,
      title, title_is_auto, address, latitude, longitude,
      status, source, estimated_value, platform_metadata, notes, created_by, created_at, updated_at
    ) values (
      v_project_id, p_company_id, v_opp.client_id, p_opportunity_id::text, p_opportunity_id,
      coalesce(p_title_override, 'New project'), (p_title_override is null),
      v_opp.address, v_opp.latitude, v_opp.longitude,
      v_status, v_opp.source, v_value, v_platform, p_notes, v_created_by, now(), now()
    );
  end if;

  update public.opportunities
     set project_ref = v_project_id, project_id = v_project_id, updated_at = now()
   where id = p_opportunity_id and company_id = p_company_id and project_ref is null;
  if not found then
    raise exception 'opportunity link update matched zero rows (concurrent conversion?)' using errcode='P0002';
  end if;

  update public.estimates
     set project_ref = v_project_id, project_id = v_project_id::text, updated_at = now()
   where opportunity_id = p_opportunity_id and company_id = p_company_id and deleted_at is null;
  get diagnostics v_relinked = row_count;

  insert into public.project_tasks (
    id, company_id, project_id, task_type_id, custom_title,
    source_line_item_id, source_estimate_id, status, display_order, duration, task_color, created_at, updated_at)
  select gen_random_uuid(), p_company_id, v_project_id, li.task_type_ref, li.name,
         li.id::text, li.estimate_id::text, 'active', coalesce(li.sort_order,0),
         coalesce(tt.default_duration,1), coalesce(tt.color,'#417394'), now(), now()
    from public.line_items li
    left join public.task_types tt on tt.id = li.task_type_ref
   where li.estimate_id in (select id from public.estimates
                              where opportunity_id = p_opportunity_id and deleted_at is null)
     and li.type = 'LABOR'
     and not exists (select 1 from public.project_tasks pt
                      where pt.project_id = v_project_id and pt.source_line_item_id = li.id::text);
  get diagnostics v_tasks = row_count;

  insert into public.project_photos (
    id, project_id, company_id, url, source, site_visit_id, uploaded_by, taken_at, created_at)
  select gen_random_uuid(), v_project_id::text, p_company_id::text, photo_url, 'site_visit',
         sv.id, sv.created_by, null, now()
    from public.site_visits sv
    cross join lateral unnest(sv.photos) as photo_url
   where sv.opportunity_id = p_opportunity_id and sv.deleted_at is null
     and photo_url is not null and photo_url <> ''
     and not exists (select 1 from public.project_photos pp
                      where pp.project_id = v_project_id::text and pp.site_visit_id = sv.id and pp.url = photo_url);
  get diagnostics v_photos = row_count;

  if p_win_opportunity then
    if v_opp.stage is distinct from 'won' then
      update public.opportunities
         set stage='won', stage_entered_at=now(), stage_manually_set=true,
             actual_value=coalesce(p_actual_value, actual_value), actual_close_date=now()::date, updated_at=now()
       where id = p_opportunity_id;
      insert into public.stage_transitions (
        company_id, opportunity_id, from_stage, to_stage, transitioned_at, transitioned_by, duration_in_stage)
      values (p_company_id, p_opportunity_id, v_opp.stage, 'won', now(), p_decided_by,
              now() - coalesce(v_opp.stage_entered_at, now()));
      v_won := true;
    else
      update public.opportunities set actual_value=coalesce(p_actual_value, actual_value), updated_at=now()
       where id = p_opportunity_id;
    end if;
  end if;

  update public.opportunity_dispositions set superseded_at = now()
   where opportunity_id = p_opportunity_id and company_id = p_company_id and superseded_at is null;
  insert into public.opportunity_dispositions (
    company_id, opportunity_id, disposition, reason_code, decided_via, decided_by, evidence, converted_project_ref)
  values (p_company_id, p_opportunity_id, 'converted_to_project', null, 'project_conversion', p_decided_by,
          coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object(
            'source_path', p_source_path, 'actual_value', v_value,
            'relinked_estimates', v_relinked, 'linked_existing', v_linked_existing, 'won', v_won),
          v_project_id)
  returning id into v_disposition_id;

  return jsonb_build_object(
    'converted', true, 'already_converted', false, 'project_id', v_project_id,
    'opportunity_id', p_opportunity_id, 'disposition_id', v_disposition_id,
    'relinked_estimates', v_relinked, 'materialized_tasks', v_tasks, 'attached_photos', v_photos,
    'linked_existing', v_linked_existing, 'won', v_won);
end;
$function$;
