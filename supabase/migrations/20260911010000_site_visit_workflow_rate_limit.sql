-- Dormant v22 candidate only. No exposure, consent, grants or activation changes.
-- Preserve every existing policy and bucket; extend only the closed policy check.
begin;
alter table private.agent_mcp_rate_limit_buckets drop constraint agent_mcp_rate_limit_buckets_policy_closed;
alter table private.agent_mcp_rate_limit_buckets add constraint agent_mcp_rate_limit_buckets_policy_closed
check (((policy_id = ANY (ARRAY['mcp-lightweight-read:2026-08-23.v1'::text, 'mcp-evidence-search:2026-08-23.v1'::text, 'mcp-day-closeout-prepare:2026-08-30.v1'::text, 'mcp-collections-prepare:2026-08-31.v1'::text, 'mcp-dispatch-confirmation-prepare:2026-09-03.v1'::text, 'mcp-customer-update-prepare:2026-09-04.v1'::text])) OR (policy_id = 'mcp-schedule-change-prepare:2026-09-06.v1'::text) OR (policy_id = 'mcp-financial-document-prepare:2026-09-07.v1'::text) OR (policy_id = 'mcp-catalog-prepare:2026-09-08.v1'::text)) OR policy_id='mcp-site-visit-workflow:2026-09-10.v1');
CREATE OR REPLACE FUNCTION public.consume_site_visit_workflow_rate_limit_as_system(p_request_id text, p_grant_id uuid, p_actor_user_id uuid, p_company_id uuid, p_capability_id text, p_policy_id text, p_requested_units integer, p_protocol_era text)
 RETURNS TABLE(allowed boolean, remaining_units integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
declare
  v_client_id uuid;
  v_actor_limit constant integer := 6;
  v_grant_limit constant integer := 6;
  v_company_limit constant integer := 30;
  v_window_seconds constant integer := 60;
  v_window_start timestamptz;
  v_reset_at timestamptz;
  v_expiry timestamptz;
  v_actor_digest bytea;
  v_grant_digest bytea;
  v_company_digest bytea;
  v_locked_count integer;
  v_allowed boolean;
  v_remaining integer;
begin
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or p_grant_id is null or p_actor_user_id is null or p_company_id is null
     or coalesce(p_capability_id,'') not in ('list_site_visit_templates','get_site_visit_template','get_site_visit_form','get_site_visit_source','prepare_site_visit_booking','prepare_site_visit_reschedule','prepare_site_visit_booking_cancellation','prepare_site_visit_template','prepare_site_visit_template_edit','prepare_site_visit_checklist_selection','prepare_site_visit_answers')
     or p_policy_id is distinct from
       'mcp-site-visit-workflow:2026-09-10.v1'
     or p_requested_units is distinct from 1
     or p_protocol_era is null or p_protocol_era not in ('legacy','modern') then
    raise exception 'SITE_VISIT_RATE_LIMIT_REQUEST_INVALID'
      using errcode = '22023';
  end if;
  select client.client_id into v_client_id
  from private.mcp_oauth_grants grant_record
  join private.mcp_oauth_clients client on client.client_id=grant_record.client_id
  join public.users actor on actor.id=grant_record.user_id
  join public.companies company on company.id=actor.company_id
  where grant_record.id=p_grant_id and grant_record.user_id=p_actor_user_id
    and grant_record.company_id=p_company_id and actor.company_id::text=p_company_id::text
    and actor.deleted_at is null and coalesce(actor.is_active,false) and company.deleted_at is null
    and grant_record.revoked_at is null and client.disabled_at is null
    and grant_record.scopes <@ client.scope_ceiling
    and client.scope=array_to_string(client.scope_ceiling,' ')
    and grant_record.exposure_revision='2026-09-10.mcp-exposure.v22'
    and client.exposure_revision=grant_record.exposure_revision
    and grant_record.consent_catalog_revision='2026-09-10.mcp-consent-catalog.v17'
    and client.consent_catalog_revision=grant_record.consent_catalog_revision
    and private.agent_site_visit_workflow_labels(grant_record.scopes,grant_record.consent_catalog_revision) is not null
    and grant_record.accepted_labels=private.agent_site_visit_workflow_labels(grant_record.scopes,grant_record.consent_catalog_revision)
    and (case
      when p_capability_id in ('list_site_visit_templates','get_site_visit_template') then array['ops.site_visit_templates.read']
      when p_capability_id in ('prepare_site_visit_template','prepare_site_visit_template_edit') then array['ops.site_visit_templates.read','ops.site_visit_templates.prepare']
      when p_capability_id in ('prepare_site_visit_booking','prepare_site_visit_reschedule','prepare_site_visit_booking_cancellation') then array['ops.site_visits.read','ops.site_visits.prepare','ops.schedule.read','ops.team.read']
      when p_capability_id='prepare_site_visit_checklist_selection' then array['ops.site_visits.read','ops.site_visits.prepare','ops.site_visit_templates.read']
      when p_capability_id='prepare_site_visit_answers' then array['ops.site_visits.read','ops.site_visits.prepare']
      else array['ops.site_visits.read'] end) <@ grant_record.scopes
  for share of grant_record,client,actor,company nowait;
  if not found then
    raise exception 'SITE_VISIT_RATE_LIMIT_BINDING_INVALID'
      using errcode = '42501';
  end if;
  v_window_start := pg_catalog.to_timestamp(
    floor(extract(epoch from pg_catalog.statement_timestamp()) /
      v_window_seconds) * v_window_seconds
  );
  v_reset_at := v_window_start + pg_catalog.make_interval(
    secs => v_window_seconds
  );
  v_expiry := v_reset_at + interval '5 minutes';
  perform private.prune_agent_mcp_rate_limit_buckets(64);
  v_actor_digest := private.agent_mcp_rate_limit_bucket_digest(
    'actor',p_company_id,p_actor_user_id,null,'site_visit_workflow',p_policy_id,
    v_window_start
  );
  v_grant_digest := private.agent_mcp_rate_limit_bucket_digest(
    'grant',p_company_id,p_actor_user_id,p_grant_id,'site_visit_workflow',p_policy_id,
    v_window_start
  );
  v_company_digest := private.agent_mcp_rate_limit_bucket_digest(
    'company',p_company_id,null,null,'site_visit_workflow',p_policy_id,v_window_start
  );
  insert into private.agent_mcp_rate_limit_buckets (
    bucket_digest,bucket_kind,policy_id,window_start,units_used,expires_at
  ) values
    (v_actor_digest,'actor',p_policy_id,v_window_start,0,v_expiry),
    (v_grant_digest,'grant',p_policy_id,v_window_start,0,v_expiry),
    (v_company_digest,'company',p_policy_id,v_window_start,0,v_expiry)
  on conflict (bucket_digest) do nothing;
  perform 1 from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    v_actor_digest,v_grant_digest,v_company_digest
  ) order by bucket.bucket_digest for update;
  get diagnostics v_locked_count = row_count;
  if v_locked_count is distinct from 3 or exists (
    select 1 from private.agent_mcp_rate_limit_buckets bucket
    where bucket.bucket_digest in (
      v_actor_digest,v_grant_digest,v_company_digest
    ) and (
      bucket.policy_id is distinct from p_policy_id
      or bucket.window_start is distinct from v_window_start
      or bucket.expires_at is distinct from v_expiry
    )
  ) then
    raise exception 'SITE_VISIT_RATE_LIMIT_BUCKET_COLLISION'
      using errcode = '55000';
  end if;
  select pg_catalog.bool_and(
    bucket.units_used + p_requested_units <= case bucket.bucket_kind
      when 'actor' then v_actor_limit when 'grant' then v_grant_limit
      when 'company' then v_company_limit end
  ) into v_allowed
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    v_actor_digest,v_grant_digest,v_company_digest
  );
  if v_allowed then
    update private.agent_mcp_rate_limit_buckets bucket
    set units_used=bucket.units_used+p_requested_units
    where bucket.bucket_digest in (
      v_actor_digest,v_grant_digest,v_company_digest
    );
    select pg_catalog.min(case bucket.bucket_kind
      when 'actor' then v_actor_limit when 'grant' then v_grant_limit
      when 'company' then v_company_limit end - bucket.units_used)::integer
    into v_remaining
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.bucket_digest in (
      v_actor_digest,v_grant_digest,v_company_digest
    );
  else
    v_remaining := 0;
    insert into private.mcp_request_audit (
      request_id,grant_id,client_id,actor_user_id,company_id,tool,
      protocol_era,outcome,error_code,input_sha256,result_bytes,latency_ms
    ) values (
      p_request_id,p_grant_id,v_client_id,p_actor_user_id,p_company_id,
      p_capability_id,p_protocol_era,'rate_limited','RATE_LIMITED',
      null,null,null
    );
  end if;
  return query select v_allowed,v_remaining,v_reset_at;
end;
$function$
;
revoke all on function public.consume_site_visit_workflow_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.consume_site_visit_workflow_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text) to service_role;
commit;
