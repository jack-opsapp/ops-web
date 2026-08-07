-- Manual lead-to-project linking is an explicit operator choice. Address and
-- client identity rank likely matches, but may never veto that choice. The
-- automatic nil-target CREATE path keeps every existing duplicate guard.

create or replace function public.get_manual_project_link_candidates(
  p_opportunity_id uuid
)
returns table (
  project_id uuid,
  title text,
  address text,
  status text,
  same_address boolean,
  same_client boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_opportunity public.opportunities%rowtype;
  v_client_id uuid;
  v_normalized_address text;
begin
  if v_actor_user_id is null or v_company_id is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select opportunity.*
    into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = v_company_id
     and opportunity.deleted_at is null;

  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;
  if not private.user_can_convert_opportunity(
    v_actor_user_id,
    p_opportunity_id
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_client_id := private.resolve_opportunity_client_id(
    v_opportunity.client_ref,
    v_opportunity.client_id
  );
  v_normalized_address := private.normalize_address(v_opportunity.address);

  return query
  select
    project.id,
    project.title,
    project.address,
    project.status,
    nullif(v_normalized_address, '') is not null
      and private.normalize_address(project.address) = v_normalized_address,
    v_client_id is not null and project.client_id = v_client_id
  from public.projects project
  where project.company_id = v_company_id
    and project.deleted_at is null
    and private.user_can_view_project(v_actor_user_id, project.id)
    and private.user_can_link_opportunity_to_project(
      v_actor_user_id,
      project.id
    )
    and (
      project.opportunity_ref is null
      or project.opportunity_ref = p_opportunity_id
    )
    and (
      nullif(btrim(project.opportunity_id::text), '') is null
      or private.try_parse_uuid(project.opportunity_id::text) = p_opportunity_id
    )
  order by
    (
      nullif(v_normalized_address, '') is not null
      and private.normalize_address(project.address) = v_normalized_address
      and v_client_id is not null
      and project.client_id = v_client_id
    ) desc,
    (
      nullif(v_normalized_address, '') is not null
      and private.normalize_address(project.address) = v_normalized_address
    ) desc,
    (v_client_id is not null and project.client_id = v_client_id) desc,
    project.updated_at desc nulls last,
    project.title,
    project.id;
end;
$function$;

revoke all on function public.get_manual_project_link_candidates(uuid)
  from public;
grant execute on function public.get_manual_project_link_candidates(uuid)
  to authenticated;

-- Preserve the exact production conversion definition and patch only the two
-- human-link address gates. Both replacements are assertion-guarded and must
-- occur exactly once; schema drift fails the migration instead of weakening a
-- different function body by accident.
do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.convert_opportunity_to_project(uuid,uuid,numeric,text,uuid,text,text,uuid,text,boolean,text,jsonb,bigint)'
  );
  v_definition text;
  v_old_precheck text := $old$
  if v_actor_user_id is not null and v_initial_project_id is null then
$old$;
  v_new_precheck text := $new$
  if v_actor_user_id is not null
    and v_initial_project_id is null
    and v_link_to_project_id is null
  then
$new$;
  v_old_final_guard text := $old$
          nullif(v_initial_preflight_address, '') is null
          or v_target.status not in ('rfq', 'estimated', 'accepted', 'in_progress')
          or private.normalize_address(v_target.address)
            is distinct from v_initial_preflight_address
          or not private.user_can_view_project(
            v_actor_user_id,
            v_link_to_project_id
          )
          or not private.user_can_link_opportunity_to_project(
            v_actor_user_id,
            v_link_to_project_id
          )
          or (
            v_target.opportunity_ref is not null
$old$;
  v_new_final_guard text := $new$
          not private.user_can_view_project(
            v_actor_user_id,
            v_link_to_project_id
          )
          or not private.user_can_link_opportunity_to_project(
            v_actor_user_id,
            v_link_to_project_id
          )
          or (
            v_target.opportunity_ref is not null
$new$;
begin
  if v_signature is null then
    raise exception 'convert_opportunity_to_project signature missing';
  end if;

  select pg_get_functiondef(v_signature)
    into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_old_precheck, '')))
      / length(v_old_precheck) <> 1 then
    raise exception 'manual-link precheck patch did not match exactly once';
  end if;
  v_definition := replace(v_definition, v_old_precheck, v_new_precheck);

  if (length(v_definition) - length(replace(v_definition, v_old_final_guard, '')))
      / length(v_old_final_guard) <> 1 then
    raise exception 'manual-link final guard patch did not match exactly once';
  end if;
  v_definition := replace(
    v_definition,
    v_old_final_guard,
    v_new_final_guard
  );

  execute v_definition;
end;
$migration$;

comment on function public.get_manual_project_link_candidates(uuid) is
  'All projects the current operator may explicitly link to a lead. Address and client flags rank suggestions only.';
