-- Live schema shapes and unmodified authorization helpers captured read-only 2026-09-10.
-- Fixture omits unrelated table constraints/triggers. auth.jwt mirrors the local JWT GUC transport.
set check_function_bodies=off;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table public.companies(id uuid,bubble_id text,name text,external_id text,description text,website text,phone text,email text,address text,latitude double precision,longitude double precision,open_hour text,close_hour text,logo_url text,default_project_color text,industries text[],company_size text,company_age text,referral_method text,account_holder_id text,admin_ids text[],seated_employee_ids text[],max_seats integer,subscription_status text,subscription_plan text,subscription_end timestamp with time zone,subscription_period text,trial_start_date timestamp with time zone,trial_end_date timestamp with time zone,seat_grace_start_date timestamp with time zone,has_priority_support boolean,data_setup_purchased boolean,data_setup_completed boolean,data_setup_scheduled timestamp with time zone,stripe_customer_id text,subscription_ids_json text,created_at timestamp with time zone,updated_at timestamp with time zone,deleted_at timestamp with time zone,company_code text,precise_scheduling_enabled boolean,skip_weekends_in_auto_schedule boolean,weather_dependent boolean,industry text,client_comms_settings jsonb,timezone text,locale text,ai_enabled boolean,physical_address text,default_work_start time without time zone,default_work_end time without time zone,priority_support_period text,currency_code text,source_app text,lifecycle_settings jsonb,schedule_settings jsonb,invoice_settings jsonb,task_groups_conversion_enabled boolean,public_handle text);
create table public.deck_designs(id uuid,company_id uuid,project_id uuid,title text,drawing_data jsonb,thumbnail_url text,version integer,created_by uuid,deleted_at timestamp with time zone,created_at timestamp with time zone,updated_at timestamp with time zone,opportunity_id uuid);
create table public.opportunities(id uuid,company_id uuid,client_id uuid,title text,description text,contact_name text,contact_email text,contact_phone text,stage text,source text,assigned_to uuid,priority text,estimated_value numeric(12,2),actual_value numeric(12,2),win_probability integer,expected_close_date date,actual_close_date date,stage_entered_at timestamp with time zone,project_id uuid,lost_reason text,lost_notes text,address text,last_activity_at timestamp with time zone,next_follow_up_at timestamp with time zone,tags text[],created_at timestamp with time zone,updated_at timestamp with time zone,deleted_at timestamp with time zone,source_email_id text,client_ref uuid,project_ref uuid,quote_delivery_method text,correspondence_count integer,outbound_count integer,inbound_count integer,last_inbound_at timestamp with time zone,last_outbound_at timestamp with time zone,last_message_direction text,archived_at timestamp with time zone,stage_manually_set boolean,ai_summary text,images text[],ai_stage_confidence double precision,ai_stage_signals text[],detected_value integer,latitude double precision,longitude double precision,source_message_id text,source_metadata jsonb,merged_into_opportunity_id uuid,source_thread_key text,assignment_version bigint,handled_at timestamp with time zone,ai_summary_updated_at timestamp with time zone,operator_action_required_at timestamp with time zone,stage_manual_boundary_event_id uuid,stage_manual_boundary_at timestamp with time zone,stage_manual_corrected_at timestamp with time zone,won_prompt_declined_at timestamp with time zone,won_prompt_declined_by uuid);
create table public.project_notes(id uuid,project_id text,company_id text,author_id text,content text,attachments jsonb,mentioned_user_ids text[],created_at timestamp with time zone,updated_at timestamp with time zone,deleted_at timestamp with time zone,photo_url text,event_kind text,content_metadata jsonb);
create table public.project_tasks(id uuid,bubble_id text,company_id uuid,project_id uuid,task_type_id uuid,custom_title text,task_notes text,status text,task_color text,display_order integer,team_member_ids text[],source_line_item_id text,source_estimate_id text,created_at timestamp with time zone,updated_at timestamp with time zone,deleted_at timestamp with time zone,start_date timestamp with time zone,end_date timestamp with time zone,duration integer,dependency_overrides jsonb,start_time time without time zone,end_time time without time zone,schedule_confirmed_at timestamp with time zone,schedule_confirmed_by uuid,all_day boolean,recurrence_id uuid,recurrence_origin_date date,inventory_deducted boolean,paired_from_task_id uuid,schedule_locked boolean,priority_rank double precision,schedule_version bigint,confirmed_schedule_version bigint);
create table public.projects(id uuid,bubble_id text,company_id uuid,client_id uuid,title text,address text,latitude double precision,longitude double precision,status text,notes text,description text,all_day boolean,project_images text[],team_member_ids text[],opportunity_id text,start_date timestamp with time zone,end_date timestamp with time zone,duration integer,created_at timestamp with time zone,updated_at timestamp with time zone,deleted_at timestamp with time zone,completed_at timestamp with time zone,visibility text,trade text,created_by uuid,vinyl_order_status text,vinyl_ordered_at timestamp with time zone,vinyl_ordered_by uuid,estimated_value numeric,source text,platform_metadata jsonb,opportunity_ref uuid,priority_rank double precision,title_is_auto boolean,vinyl_color text,vinyl_po text,status_version bigint,vinyl_source text,primary_sub_client_id uuid);
create table public.role_permissions(id uuid,role_id uuid,permission text,scope text,created_at timestamp with time zone);
create table public.roles(id uuid,name text,hierarchy integer,created_at timestamp with time zone,description text,is_preset boolean,company_id uuid,updated_at timestamp with time zone);
create table public.site_visit_artifacts(id uuid,site_visit_id uuid,company_id text,opportunity_id uuid,kind text,source text,title text,body text,asset_url text,rendered_asset_url text,thumbnail_url text,dimensions jsonb,deck_design_id uuid,included_in_project_review boolean,captured_at timestamp with time zone,created_by text,created_at timestamp with time zone,updated_at timestamp with time zone,deleted_at timestamp with time zone);
alter table public.site_visit_artifacts add constraint site_visit_artifacts_asset_url_length CHECK (((asset_url IS NULL) OR (char_length(asset_url) <= 4096)));
alter table public.site_visit_artifacts add constraint site_visit_artifacts_body_length CHECK (((body IS NULL) OR (char_length(body) <= 200000)));
alter table public.site_visit_artifacts add constraint site_visit_artifacts_created_by_length CHECK (((char_length(created_by) >= 1) AND (char_length(created_by) <= 256)));
alter table public.site_visit_artifacts add constraint site_visit_artifacts_dimensions_shape CHECK (((dimensions IS NULL) OR ((jsonb_typeof(dimensions) = 'object'::text) AND (pg_column_size(dimensions) <= 1048576))));
alter table public.site_visit_artifacts add constraint site_visit_artifacts_kind_check CHECK ((kind = ANY (ARRAY['photo'::text, 'annotated_photo'::text, 'dimensioned_photo'::text, 'note'::text, 'transcript'::text, 'measurement'::text, 'deck_design'::text])));
alter table public.site_visit_artifacts add constraint site_visit_artifacts_rendered_url_length CHECK (((rendered_asset_url IS NULL) OR (char_length(rendered_asset_url) <= 4096)));
alter table public.site_visit_artifacts add constraint site_visit_artifacts_source_check CHECK ((source = ANY (ARRAY['camera'::text, 'gallery'::text, 'microphone'::text, 'keyboard'::text, 'laser'::text, 'lidar'::text, 'deck_builder'::text, 'manual'::text])));
alter table public.site_visit_artifacts add constraint site_visit_artifacts_thumbnail_url_length CHECK (((thumbnail_url IS NULL) OR (char_length(thumbnail_url) <= 4096)));
alter table public.site_visit_artifacts add constraint site_visit_artifacts_title_length CHECK (((title IS NULL) OR (char_length(title) <= 500)));
create table public.user_permission_overrides(id uuid,user_id uuid,company_id uuid,permission text,scope text,granted boolean,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.user_roles(id uuid,user_id text,role_id uuid,created_at timestamp with time zone);
create table public.users(id uuid,bubble_id text,company_id uuid,first_name text,last_name text,email text,phone text,home_address text,profile_image_url text,user_color text,role text,user_type text,is_company_admin boolean,has_completed_tutorial boolean,dev_permission boolean,latitude double precision,longitude double precision,location_name text,client_id text,is_active boolean,stripe_customer_id text,device_token text,auth_id text,created_at timestamp with time zone,updated_at timestamp with time zone,deleted_at timestamp with time zone,firebase_uid text,special_permissions text[],email_domain_valid boolean,removed_from_email_list boolean,removed_from_email_list_at timestamp with time zone,fab_actions text[],setup_progress jsonb,emergency_contact_name text,emergency_contact_phone text,emergency_contact_relationship text,onboarding_completed jsonb,onesignal_player_id text,preferences jsonb);
CREATE OR REPLACE FUNCTION private.current_user_can_access_site_visit_child(p_site_visit_id uuid, p_company_id text, p_write boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select coalesce((
    select case when p_write then
      private.current_user_can_edit_site_visit(
        visit.company_id,
        visit.opportunity_id,
        visit.project_id,
        visit.project_ref
      )
    else
      private.current_user_can_view_site_visit(
        visit.company_id,
        visit.opportunity_id,
        visit.project_id,
        visit.project_ref
      )
    end
      from public.site_visits visit
     where visit.id = p_site_visit_id
       and visit.company_id = p_company_id
       and visit.deleted_at is null
  ), false);
$function$
;
CREATE OR REPLACE FUNCTION private.user_is_company_admin(p_actor_user_id uuid, p_actor_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
      and (
        coalesce(actor.is_company_admin, false)
        or actor.id::text = company.account_holder_id
        or actor.id::text = any(
          coalesce(company.admin_ids, array[]::text[])
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION private.try_parse_uuid(p_value text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_value is null then
    return null;
  end if;

  if btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return btrim(p_value)::uuid;
  end if;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.get_user_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT company_id FROM public.users
  WHERE (auth_id = (auth.jwt() ->> 'sub') OR firebase_uid = (auth.jwt() ->> 'sub'))
    AND company_id IS NOT NULL
    AND deleted_at IS NULL
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION private.get_current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id FROM public.users
  WHERE (auth_id = (auth.jwt() ->> 'sub') OR firebase_uid = (auth.jwt() ->> 'sub'))
    AND deleted_at IS NULL
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION private.current_user_has_permission(p_permission text, p_min_scope text DEFAULT 'own'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope text;
BEGIN
  IF private.current_user_is_admin() THEN
    RETURN true;
  END IF;
  v_scope := private.current_user_scope_for(p_permission);
  IF v_scope IS NULL THEN
    RETURN false;
  END IF;
  IF v_scope = 'all' THEN RETURN true; END IF;
  IF v_scope = 'assigned' THEN
    RETURN p_min_scope IN ('assigned','own');
  END IF;
  IF v_scope = 'own' THEN
    RETURN p_min_scope = 'own';
  END IF;
  RETURN false;
END;
$function$
;
CREATE OR REPLACE FUNCTION private.current_user_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    LEFT JOIN public.companies c ON c.id = u.company_id
    WHERE (u.auth_id = (auth.jwt() ->> 'sub') OR u.firebase_uid = (auth.jwt() ->> 'sub'))
      AND u.deleted_at IS NULL
      AND (
        COALESCE(u.is_company_admin, false)
        OR u.id::text = c.account_holder_id
        OR u.id::text = ANY(COALESCE(c.admin_ids, ARRAY[]::text[]))
      )
  )
$function$
;
CREATE OR REPLACE FUNCTION private.raw_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_override_granted boolean;
  v_override_scope text;
  v_scope text;
begin
  if p_actor_user_id is null
     or p_actor_company_id is null
     or nullif(btrim(p_permission), '') is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return null;
  end if;

  select override.granted, override.scope
  into v_override_granted, v_override_scope
  from public.user_permission_overrides override
  where override.user_id = p_actor_user_id
    and override.company_id = p_actor_company_id
    and override.permission = p_permission
  limit 1;

  if found then
    if not v_override_granted then
      return null;
    end if;
    if v_override_scope is not null then
      if v_override_scope in ('all', 'assigned', 'own') then
        return v_override_scope;
      end if;
      return null;
    end if;
  end if;

  select permission.scope
  into v_scope
  from public.user_roles assignment
  join public.roles role
    on role.id = assignment.role_id
   and (role.is_preset or role.company_id = p_actor_company_id)
  join public.role_permissions permission
    on permission.role_id = assignment.role_id
   and permission.permission = p_permission
   and permission.scope in ('all', 'assigned', 'own')
  where assignment.user_id = p_actor_user_id::text
  order by case permission.scope
    when 'all' then 1
    when 'assigned' then 2
    when 'own' then 3
    else 4
  end
  limit 1;

  return v_scope;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.effective_pipeline_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_raw_scope text;
  v_prerequisite_scope text;
begin
  if p_permission is null or p_permission not in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  ) then
    return null;
  end if;

  if not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = p_actor_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return null;
  end if;

  if public.has_permission(p_actor_user_id, p_permission, 'all') then
    v_raw_scope := 'all';
  elsif public.has_permission(p_actor_user_id, p_permission, 'assigned') then
    v_raw_scope := 'assigned';
  elsif private.should_use_pipeline_manage_compat(
    p_actor_user_id,
    p_actor_company_id,
    p_permission
  ) then
    v_raw_scope := 'all';
  else
    return null;
  end if;

  -- `own` and every unknown scope are invalid for these capabilities.
  if v_raw_scope not in ('all', 'assigned') then
    return null;
  end if;

  case p_permission
    when 'pipeline.create' then
      if v_raw_scope is distinct from 'all' then
        return null;
      end if;
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.view'
      );
      if v_prerequisite_scope not in ('all', 'assigned') then
        return null;
      end if;
      return 'all';

    when 'pipeline.view' then
      return v_raw_scope;

    when 'pipeline.edit' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.view'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );

    when 'pipeline.assign' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.edit'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );

    when 'pipeline.convert' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.edit'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );
  end case;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.current_user_scope_for(p_permission text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select private.effective_permission_scope_for_user(
    private.get_current_user_id(),
    private.get_user_company_id(),
    p_permission
  );
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_edit_opportunity(p_actor_user_id uuid, p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_opportunity record;
  v_scope text;
begin
  select o.company_id, o.assigned_to
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;

  if not found then
    return false;
  end if;

  v_scope := private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    v_opportunity.company_id,
    'pipeline.edit'
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned'
    and v_opportunity.assigned_to = p_actor_user_id
  then
    return true;
  end if;
  return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_view_project(p_actor_user_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_project record;
begin
  select p.company_id
    into v_project
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_project.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'projects.view', 'all') then
    return true;
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'projects.view',
    'assigned'
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.project_tasks pt
     where pt.project_id = p_project_id
       and pt.deleted_at is null
       and p_actor_user_id::text = any(
         coalesce(pt.team_member_ids, array[]::text[])
       )
  ) or exists (
    select 1
      from public.project_notes pn
     where pn.project_id = p_project_id::text
       and pn.deleted_at is null
       and p_actor_user_id::text = any(
         coalesce(pn.mentioned_user_ids, array[]::text[])
       )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_edit_project(p_actor_user_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_project record;
begin
  select p.company_id
    into v_project
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_project.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'projects.edit', 'all') then
    return true;
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'projects.edit',
    'assigned'
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.project_tasks pt
     where pt.project_id = p_project_id
       and pt.deleted_at is null
       and p_actor_user_id::text = any(
         coalesce(pt.team_member_ids, array[]::text[])
       )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.opportunity_project_relationship_is_valid(p_company_id uuid, p_opportunity_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select p_company_id is not null
    and p_opportunity_id is not null
    and p_project_id is not null
    and exists (
      select 1
        from public.opportunities o
        join public.projects p on p.id = p_project_id
       where o.id = p_opportunity_id
         and o.company_id = p_company_id
         and o.deleted_at is null
         and p.company_id = p_company_id
         and p.deleted_at is null
         and (
           o.project_ref = p.id
           or o.project_id = p.id
           or p.opportunity_ref = o.id
           or private.try_parse_uuid(p.opportunity_id) = o.id
         )
         and (o.project_ref is null or o.project_ref = p.id)
         and (o.project_id is null or o.project_id = p.id)
         and (p.opportunity_ref is null or p.opportunity_ref = o.id)
         and (
           nullif(btrim(p.opportunity_id), '') is null
           or private.try_parse_uuid(p.opportunity_id) = o.id
         )
    );
$function$
;
CREATE OR REPLACE FUNCTION private.current_user_can_edit_site_visit(p_company_id text, p_opportunity_id uuid, p_project_id text, p_project_ref uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_project_id uuid := coalesce(p_project_ref, private.try_parse_uuid(p_project_id));
begin
  if private.try_parse_uuid(p_company_id) is distinct from private.get_user_company_id() then
    return false;
  end if;
  if p_opportunity_id is not null
    and (p_project_id is not null or p_project_ref is not null)
    and (
      v_project_id is null
      or (
        p_project_id is not null
        and p_project_ref is not null
        and private.try_parse_uuid(p_project_id) is distinct from p_project_ref
      )
      or not private.opportunity_project_relationship_is_valid(
        private.try_parse_uuid(p_company_id),
        p_opportunity_id,
        v_project_id
      )
    )
  then
    return false;
  end if;
  if p_opportunity_id is null and v_project_id is null then
    return true;
  end if;
  return (p_opportunity_id is not null and private.user_can_edit_opportunity(
      v_actor_user_id, p_opportunity_id
    ))
    or (v_project_id is not null
      and private.user_can_view_project(v_actor_user_id, v_project_id)
      and private.user_can_edit_project(v_actor_user_id, v_project_id));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission text, p_required_scope text DEFAULT 'all'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_company_id uuid;
  v_scope text;
begin
  if p_user_id is null or p_permission is null then
    return false;
  end if;

  select actor.company_id
  into v_company_id
  from public.users actor
  join public.companies company
    on company.id = actor.company_id
   and company.deleted_at is null
  where actor.id = p_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);

  if not found then
    return false;
  end if;

  if private.user_is_company_admin(p_user_id, v_company_id) then
    return true;
  end if;

  v_scope := private.raw_permission_scope_for_user(
    p_user_id,
    v_company_id,
    p_permission
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned' then
    return p_required_scope in ('assigned', 'own');
  end if;
  if v_scope = 'own' then
    return p_required_scope = 'own';
  end if;
  return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.current_user_can_view_site_visit(p_company_id text, p_opportunity_id uuid, p_project_id text, p_project_ref uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_project_id uuid := coalesce(p_project_ref, private.try_parse_uuid(p_project_id));
begin
  if private.try_parse_uuid(p_company_id) is distinct from private.get_user_company_id() then
    return false;
  end if;
  if p_opportunity_id is null and v_project_id is null then
    return true;
  end if;
  return (p_opportunity_id is not null and private.user_can_view_opportunity(
      v_actor_user_id, p_opportunity_id
    ))
    or (v_project_id is not null and private.user_can_view_project(
      v_actor_user_id, v_project_id
    ));
end;
$function$
;
CREATE OR REPLACE FUNCTION private.effective_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_permission in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  ) then
    return private.effective_pipeline_scope_for_user(
      p_actor_user_id,
      p_actor_company_id,
      p_permission
    );
  end if;

  if p_permission in ('inbox.view', 'inbox.send') then
    return private.effective_inbox_scope_for_user(
      p_actor_user_id,
      p_actor_company_id,
      p_permission
    );
  end if;

  return private.raw_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    p_permission
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.least_permissive_pipeline_scope(p_left_scope text, p_right_scope text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when p_left_scope is null or p_right_scope is null then null
    when p_left_scope not in ('all', 'assigned') then null
    when p_right_scope not in ('all', 'assigned') then null
    when p_left_scope = 'assigned' or p_right_scope = 'assigned' then 'assigned'
    else 'all'
  end;
$function$
;
CREATE OR REPLACE FUNCTION private.should_use_pipeline_manage_compat(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select p_actor_user_id is not null
    and p_actor_company_id is not null
    and p_permission is not null
    and not exists (
      select 1
        from public.user_permission_overrides upo
       where upo.user_id = p_actor_user_id
         and upo.company_id = p_actor_company_id
         and upo.permission = p_permission
    )
    and not exists (
      select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = p_actor_user_id::text
         and rp.permission = p_permission
    )
    and public.has_permission(
      p_actor_user_id,
      'pipeline.manage',
      'all'
    );
$function$
;
set check_function_bodies=on;

-- Local identities used by the protocol fixture. No remote mutations.
insert into public.companies(id) values ('10000000-0000-4000-8000-000000000002');
insert into public.users(id,company_id,is_active,is_company_admin,firebase_uid) values
('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',true,true,'phone-a'),
('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002',true,false,'phone-b');
insert into public.user_permission_overrides(user_id,company_id,permission,scope,granted) values
('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','pipeline.edit','assigned',true),
('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','pipeline.view','assigned',true);
select set_config('request.jwt.claims','{"sub":"phone-a"}',false);

CREATE OR REPLACE FUNCTION private.user_can_view_opportunity(p_actor_user_id uuid, p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_opportunity record;
  v_scope text;
begin
  select o.company_id, o.assigned_to
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;

  if not found then
    return false;
  end if;

  v_scope := private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    v_opportunity.company_id,
    'pipeline.view'
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned'
    and v_opportunity.assigned_to = p_actor_user_id
  then
    return true;
  end if;
  return false;
end;
$function$
;
