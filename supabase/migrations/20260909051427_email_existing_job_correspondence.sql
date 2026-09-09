-- Service-only, source-scoped no-lead routing. Email text stays under activities RLS.
create or replace function public.route_email_work_correspondence_as_system(
  p_company_id uuid, p_connection_id uuid, p_activity_id uuid,
  p_provider_message_id text, p_provider_thread_id text,
  p_client_id uuid, p_project_id uuid, p_needs_review boolean
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_activity public.activities%rowtype;
  v_connection public.email_connections%rowtype;
  v_marker text := case when p_needs_review then 'work_intent_review' else 'existing_job' end;
  v_replay boolean;
  v_pending_recovery boolean;
  v_client_id uuid := p_client_id;
  v_project_id uuid := p_project_id;
  v_needs_review boolean := p_needs_review;
  v_recipient_user_id text;
begin
  if current_user <> 'service_role' then
    raise exception 'email_work_routing_service_role_required' using errcode = '42501';
  end if;
  if p_needs_review is null or p_company_id is null or p_connection_id is null
     or p_activity_id is null or nullif(btrim(p_provider_message_id), '') is null
     or nullif(btrim(p_provider_thread_id), '') is null
     or (p_needs_review and p_project_id is not null)
     or (not p_needs_review and (p_client_id is null or p_project_id is null)) then
    raise exception 'email_work_routing_invalid_input';
  end if;
  select * into v_connection from public.email_connections
    where id = p_connection_id and company_id = p_company_id::text
      and status = 'active' and sync_enabled is true for share;
  if not found then raise exception 'email_work_routing_mailbox_unavailable'; end if;
  select * into v_activity from public.activities
    where id = p_activity_id and company_id = p_company_id
      and email_connection_id = p_connection_id
      and email_message_id = p_provider_message_id
      and email_thread_id = p_provider_thread_id
      and type = 'email' and direction in ('inbound', 'outbound') for update;
  if not found then raise exception 'email_work_routing_source_mismatch'; end if;
  if v_activity.opportunity_id is not null then
    raise exception 'email_work_routing_opportunity_conflict';
  end if;
  v_replay := v_activity.match_confidence in ('existing_job', 'work_intent_review');
  if v_replay then
    if v_activity.match_confidence <> v_marker
      or v_activity.client_id is distinct from p_client_id
      or v_activity.project_id is distinct from p_project_id::text then
      raise exception 'email_work_routing_receipt_conflict';
    end if;
    return true;
  end if;
  if (v_activity.client_id is not null and v_activity.client_id is distinct from p_client_id)
     or (v_activity.project_id is not null and v_activity.project_id is distinct from p_project_id::text) then
    raise exception 'email_work_routing_parent_conflict';
  end if;
  v_pending_recovery := v_activity.match_confidence = 'work_routing_pending'
    and v_activity.client_id is not distinct from p_client_id
    and v_activity.project_id is not distinct from p_project_id::text;
  if p_client_id is not null then
    perform 1 from public.clients c
      where c.id = p_client_id and c.company_id = p_company_id
        and c.deleted_at is null and c.merged_into_client_id is null
        and exists (
          select 1 from (
            select c.email as email
            union all
            select s.email from public.sub_clients s where s.client_id = c.id
              and s.company_id = p_company_id and s.deleted_at is null
          ) contact where nullif(btrim(contact.email), '') is not null and (
            (v_activity.direction = 'inbound' and lower(btrim(contact.email)) = lower(btrim(v_activity.from_email)))
            or (v_activity.direction = 'outbound' and exists (
              select 1 from unnest(coalesce(v_activity.to_emails, '{}'::text[]) || coalesce(v_activity.cc_emails, '{}'::text[])) recipient
              where lower(btrim(recipient)) = lower(btrim(contact.email))
            ))
          )
        ) for share;
    if not found then
      if v_pending_recovery is not true then raise exception 'email_work_routing_customer_mismatch'; end if;
      v_client_id := null; v_project_id := null; v_needs_review := true;
    end if;
  end if;
  if v_project_id is not null then
    perform 1 from public.projects where id = p_project_id and company_id = p_company_id
      and client_id = p_client_id and deleted_at is null
      and status in ('rfq', 'estimated', 'accepted', 'in_progress', 'completed', 'closed') for share;
    if not found then
      if v_pending_recovery is not true then raise exception 'email_work_routing_project_mismatch'; end if;
      v_project_id := null; v_needs_review := true;
    end if;
  end if;
  v_marker := case when v_needs_review then 'work_intent_review' else 'existing_job' end;
  update public.activities set client_id = v_client_id, project_id = v_project_id::text,
    match_confidence = v_marker, match_needs_review = v_needs_review,
    suggested_client_id = case when v_needs_review then v_client_id else null end,
    is_read = case when direction = 'inbound' then false else is_read end
    where id = p_activity_id;
  -- Only the latest no-parent thread can be projected. A later new job or a
  -- manually owned lead remains authoritative; message-scoped forwards have no row.
  update public.email_threads set client_id = v_client_id,
    routing = 'require_human_review', routing_reasons = array[v_marker],
    lead_scan_pending_at = null, phase_c_extracted_at = clock_timestamp()
    where company_id = p_company_id and connection_id = p_connection_id
      and provider_thread_id = p_provider_thread_id and opportunity_id is null
      and last_message_at <= v_activity.created_at;
  v_recipient_user_id := coalesce(nullif(v_connection.user_id, ''), v_connection.default_intake_owner_id::text);
  -- A shared mailbox may have no assigned recipient. Retain its correspondence
  -- in the authorized timeline/review queue without inventing a notification user.
  if v_activity.direction = 'inbound' and v_recipient_user_id is not null then
    insert into public.notifications(company_id, user_id, type, title, body,
      project_id, action_url, action_label, persistent, dedupe_key)
    values (p_company_id::text, v_recipient_user_id, 'email_correspondence',
      case when v_needs_review then 'Email needs review' else 'Project email received' end,
      case when v_needs_review then 'New work could not be confirmed. Review the customer email.' else 'Customer correspondence was added to the project.' end,
      v_project_id::text,
      case when v_needs_review then '/pipeline?review=email'
        else '/dashboard?openProject=' || v_project_id::text || '&mode=view' end,
      case when v_needs_review then 'Review email' else 'View project' end,
      false, 'email-work-routing:' || p_activity_id::text);
  end if;
  return true;
end;
$$;
revoke all on function public.route_email_work_correspondence_as_system(uuid,uuid,uuid,text,text,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.route_email_work_correspondence_as_system(uuid,uuid,uuid,text,text,uuid,uuid,boolean) to service_role;
comment on function public.route_email_work_correspondence_as_system(uuid,uuid,uuid,text,text,uuid,uuid,boolean)
  is 'Atomically retain exact provider correspondence on an existing job or in review without creating or reopening a sales opportunity.';
