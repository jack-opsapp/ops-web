begin;

-- Exact-message recovery can legitimately cross customer boundaries. Ordinary
-- data-review reassignment cannot. Keep that RPC and its same-client rule intact;
-- this separate endpoint only finishes already-applied, individually proven moves.
create table private.email_thread_recovery_finalizations (
  company_id uuid not null,
  connection_id uuid not null,
  provider_thread_id text not null,
  actor_user_id uuid not null,
  source_opportunity_id uuid not null,
  target_opportunity_id uuid not null,
  target_email text not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null,
  source_snapshot jsonb not null,
  target_snapshot jsonb not null,
  thread_snapshot jsonb not null,
  link_snapshot jsonb not null,
  thread_after jsonb not null,
  link_after jsonb not null,
  finalized_at timestamptz not null default clock_timestamp(),
  primary key (company_id, connection_id, provider_thread_id)
);
alter table private.email_thread_recovery_finalizations enable row level security;
revoke all on table private.email_thread_recovery_finalizations
  from public, anon, authenticated, service_role;

create function public.finalize_exact_email_thread_recovery_guarded(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_sync_lock_owner uuid,
  p_provider_thread_id text,
  p_source_opportunity_id uuid,
  p_target_opportunity_id uuid,
  p_target_email text,
  p_manifest_sha256 text,
  p_evidence jsonb,
  p_expected_source_snapshot jsonb,
  p_expected_target_snapshot jsonb,
  p_expected_thread_snapshot jsonb,
  p_expected_link_snapshot jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_source public.opportunities%rowtype;
  v_target public.opportunities%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_thread public.email_threads%rowtype;
  v_link public.opportunity_email_threads%rowtype;
  v_existing private.email_thread_recovery_finalizations%rowtype;
  v_application private.email_exact_message_recovery_applications%rowtype;
  v_item jsonb;
  v_message_ids text[];
  v_actual_message_ids text[];
  v_attachment_ids uuid[];
  v_count integer;
  v_replay boolean;
  v_thread_after jsonb;
  v_link_after jsonb;
  v_previous_mode text := current_setting('ops.email_thread_reassignment_mode',true);
  v_previous_connection text := current_setting('ops.email_thread_reassignment_connection_id',true);
  v_previous_thread text := current_setting('ops.email_thread_reassignment_thread_id',true);
  v_previous_winner text := current_setting('ops.email_thread_reassignment_winner_id',true);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode='42501';
  end if;
  if p_actor_user_id is null or p_company_id is null or p_connection_id is null
    or p_sync_lock_owner is null or p_source_opportunity_id is null
    or p_target_opportunity_id is null
    or p_source_opportunity_id = p_target_opportunity_id
    or nullif(btrim(p_provider_thread_id),'') is null
    or p_provider_thread_id is distinct from btrim(p_provider_thread_id)
    or p_provider_thread_id like 'legacy:%'
    or nullif(btrim(p_target_email),'') is null
    or p_target_email is distinct from lower(btrim(p_target_email))
    or p_manifest_sha256 is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_expected_source_snapshot) is distinct from 'object'
    or jsonb_typeof(p_expected_target_snapshot) is distinct from 'object'
    or jsonb_typeof(p_expected_thread_snapshot) is distinct from 'object'
    or jsonb_typeof(p_expected_link_snapshot) is distinct from 'object'
  then
    raise exception 'invalid_finalization_request' using errcode='22023';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'array' then
    raise exception 'invalid_finalization_evidence' using errcode='22023';
  end if;
  if jsonb_array_length(p_evidence) not between 1 and 100 then
    raise exception 'invalid_finalization_evidence' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_evidence) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_item)) <> 5
      or nullif(btrim(v_item->>'provider_message_id'),'') is null
      or (v_item->>'provider_message_id') is distinct from btrim(v_item->>'provider_message_id')
      or coalesce(v_item->>'activity_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or coalesce(v_item->>'correspondence_event_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      or coalesce(v_item->>'manifest_sha256','') !~ '^[0-9a-f]{64}$'
      or coalesce(v_item->>'entry_sha256','') !~ '^[0-9a-f]{64}$'
    then
      raise exception 'invalid_finalization_evidence' using errcode='22023';
    end if;
  end loop;
  select array_agg(value->>'provider_message_id' order by value->>'provider_message_id'),
    count(distinct value->>'provider_message_id')
  into v_message_ids,v_count from jsonb_array_elements(p_evidence);
  if v_count <> jsonb_array_length(p_evidence)
    or (select count(distinct value->>'activity_id') from jsonb_array_elements(p_evidence)) <> v_count
    or (select count(distinct value->>'correspondence_event_id') from jsonb_array_elements(p_evidence)) <> v_count
  then
    raise exception 'invalid_finalization_evidence' using errcode='22023';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);
  perform private.lock_email_thread_data_review(p_company_id,p_connection_id,p_provider_thread_id);
  perform 1 from private.email_provider_mailbox_sync_leases lease
    where lease.connection_id=p_connection_id and lease.owner_id=p_sync_lock_owner
      and lease.expires_at>clock_timestamp() for update;
  if not found then
    raise exception 'finalization_lease_changed' using errcode='40001';
  end if;
  perform 1 from public.email_connections connection
    where connection.id=p_connection_id and connection.company_id=p_company_id::text
      and connection.status='active' and connection.sync_enabled is true
      and connection.sync_lock_owner=p_sync_lock_owner
      and connection.sync_in_progress_at is not null for update;
  if not found then
    raise exception 'finalization_lease_changed' using errcode='40001';
  end if;
  perform 1 from public.users actor where actor.id=p_actor_user_id
    and actor.company_id=p_company_id and actor.deleted_at is null
    and actor.is_active is true for share;
  if not found or public.authorize_email_inbox_action_as_system(p_actor_user_id,p_connection_id,null,'view') is distinct from true
    or private.user_can_edit_opportunity(p_actor_user_id,p_source_opportunity_id) is distinct from true
    or private.user_can_edit_opportunity(p_actor_user_id,p_target_opportunity_id) is distinct from true
    or private.effective_pipeline_scope_for_user(p_actor_user_id,p_company_id,'pipeline.edit') is distinct from 'all'
  then
    raise exception 'finalization_actor_denied' using errcode='42501';
  end if;

  -- The lease serializes normal provider work. These brief read fences also
  -- prevent a privileged/non-provider insert from changing the exact set after
  -- proof, and freeze the complete attachment/inspection/materialization proof.
  -- In particular, the canonical attachment helper reads photo-object state
  -- without locking those rows; include row updates and new dependent objects.
  lock table public.activities,public.opportunity_correspondence_events,
    public.email_attachments,public.email_attachment_scans,
    public.email_attachment_inspection_jobs,public.email_conversion_photo_jobs,
    public.email_conversion_photo_objects in share mode;
  for v_opportunity in select opportunity.* from public.opportunities opportunity
    where opportunity.id in (p_source_opportunity_id,p_target_opportunity_id)
      and opportunity.company_id=p_company_id order by opportunity.id for update
  loop
    if v_opportunity.id=p_source_opportunity_id then v_source:=v_opportunity;
    else v_target:=v_opportunity; end if;
  end loop;
  if v_source.id is null or v_target.id is null
    or to_jsonb(v_source) is distinct from p_expected_source_snapshot
    or to_jsonb(v_target) is distinct from p_expected_target_snapshot
    or v_source.deleted_at is not null or v_source.merged_into_opportunity_id is not null
    or v_target.deleted_at is not null or v_target.archived_at is not null
    or v_target.merged_into_opportunity_id is not null
    or v_target.project_id is not null or v_target.project_ref is not null
    or v_target.stage not in ('new_lead','qualifying','quoting','quoted','follow_up','negotiation')
  then
    raise exception 'finalization_opportunity_snapshot_changed' using errcode='40001';
  end if;
  if private.opportunity_sender_is_persisted_customer(p_company_id,p_target_opportunity_id,p_target_email) is distinct from true then
    raise exception 'finalization_target_identity_mismatch' using errcode='23514';
  end if;
  select thread.* into v_thread from public.email_threads thread
    where thread.company_id=p_company_id and thread.connection_id=p_connection_id
      and thread.provider_thread_id=p_provider_thread_id for update;
  select link.* into v_link from public.opportunity_email_threads link
    where link.connection_id=p_connection_id and link.thread_id=p_provider_thread_id for update;
  if v_thread.id is null or v_link.id is null then
    raise exception 'finalization_thread_snapshot_changed' using errcode='40001';
  end if;
  select receipt.* into v_existing from private.email_thread_recovery_finalizations receipt
    where receipt.company_id=p_company_id and receipt.connection_id=p_connection_id
      and receipt.provider_thread_id=p_provider_thread_id for update;
  v_replay:=found;
  if v_replay and (
    v_existing.actor_user_id is distinct from p_actor_user_id
    or v_existing.source_opportunity_id is distinct from p_source_opportunity_id
    or v_existing.target_opportunity_id is distinct from p_target_opportunity_id
    or v_existing.target_email is distinct from p_target_email
    or v_existing.manifest_sha256 is distinct from p_manifest_sha256
    or v_existing.evidence is distinct from p_evidence
    or v_existing.source_snapshot is distinct from p_expected_source_snapshot
    or v_existing.target_snapshot is distinct from p_expected_target_snapshot
    or v_existing.thread_snapshot is distinct from p_expected_thread_snapshot
    or v_existing.link_snapshot is distinct from p_expected_link_snapshot
  ) then
    raise exception 'finalization_replay_conflict' using errcode='23505';
  end if;
  if (v_replay and (to_jsonb(v_thread) is distinct from v_existing.thread_after
      or to_jsonb(v_link) is distinct from v_existing.link_after))
    or (not v_replay and (to_jsonb(v_thread) is distinct from p_expected_thread_snapshot
      or to_jsonb(v_link) is distinct from p_expected_link_snapshot
      or v_thread.opportunity_id is distinct from p_source_opportunity_id
      or v_link.opportunity_id is distinct from p_source_opportunity_id
      or v_thread.client_id is distinct from v_source.client_id))
  then
    raise exception 'finalization_thread_snapshot_changed' using errcode='40001';
  end if;

  select array_agg(activity.email_message_id order by activity.email_message_id)
    into v_actual_message_ids from public.activities activity
    where activity.company_id=p_company_id and activity.email_connection_id=p_connection_id
      and activity.email_thread_id=p_provider_thread_id and activity.type='email';
  if v_actual_message_ids is distinct from v_message_ids then
    raise exception 'finalization_message_set_mismatch' using errcode='23514';
  end if;
  select array_agg(event.provider_message_id order by event.provider_message_id)
    into v_actual_message_ids from public.opportunity_correspondence_events event
    where event.company_id=p_company_id and event.connection_id=p_connection_id
      and event.provider_thread_id=p_provider_thread_id;
  if v_actual_message_ids is distinct from v_message_ids then
    raise exception 'finalization_message_set_mismatch' using errcode='23514';
  end if;
  for v_item in select value from jsonb_array_elements(p_evidence) order by value->>'provider_message_id' loop
    select application.* into v_application from private.email_exact_message_recovery_applications application
      where application.company_id=p_company_id and application.connection_id=p_connection_id
        and application.provider_message_id=v_item->>'provider_message_id' for share;
    if not found or v_application.provider_thread_id is distinct from p_provider_thread_id
      or v_application.actor_user_id is distinct from p_actor_user_id
      or v_application.source_opportunity_id is distinct from p_source_opportunity_id
      or v_application.target_opportunity_id is distinct from p_target_opportunity_id
      or v_application.target_email is distinct from p_target_email
      or v_application.activity_id is distinct from (v_item->>'activity_id')::uuid
      or v_application.correspondence_event_id is distinct from (v_item->>'correspondence_event_id')::uuid
      or v_application.manifest_sha256 is distinct from v_item->>'manifest_sha256'
      or v_application.entry_sha256 is distinct from v_item->>'entry_sha256'
      or v_application.status is distinct from 'complete' or v_application.finalized_at is null
    then
      raise exception 'finalization_evidence_mismatch' using errcode='23514';
    end if;
    if not exists (
      select 1 from public.activities activity join public.opportunity_correspondence_events event
        on event.activity_id=activity.id
      where activity.id=v_application.activity_id and event.id=v_application.correspondence_event_id
        and activity.company_id=p_company_id and event.company_id=p_company_id
        and activity.email_connection_id=p_connection_id and event.connection_id=p_connection_id
        and activity.email_thread_id=p_provider_thread_id and event.provider_thread_id=p_provider_thread_id
        and activity.email_message_id=v_application.provider_message_id and event.provider_message_id=v_application.provider_message_id
        and activity.opportunity_id=p_target_opportunity_id and event.opportunity_id=p_target_opportunity_id
        and activity.type='email' and activity.direction in ('inbound','outbound')
        and event.direction=activity.direction and event.opportunity_projection_applied is true
    ) then
      raise exception 'finalization_message_ownership_mismatch' using errcode='23514';
    end if;
    if private.exact_message_recovery_attachment_state(p_company_id,p_connection_id,p_provider_thread_id,
      v_application.provider_message_id,v_application.activity_id,p_target_opportunity_id,
      v_application.attachment_scan_generation) is distinct from 'complete'
    then
      raise exception 'finalization_attachments_incomplete' using errcode='55000';
    end if;
    select coalesce(array_agg(attachment.id order by attachment.id),'{}'::uuid[])
      into v_attachment_ids from public.email_attachments attachment
      where attachment.company_id=p_company_id and attachment.connection_id=p_connection_id
        and attachment.provider_thread_id=p_provider_thread_id
        and attachment.message_id=v_application.provider_message_id
        and attachment.activity_id=v_application.activity_id;
    if v_application.attachment_ids is distinct from v_attachment_ids
      or v_application.attachment_count is distinct from cardinality(v_attachment_ids)
    then
      raise exception 'finalization_attachment_set_changed' using errcode='40001';
    end if;
  end loop;
  -- Recheck time after any wait on row/table locks. Lock ownership itself cannot
  -- change while the lease row is held, but the wall-clock expiry can pass.
  if not exists(select 1 from private.email_provider_mailbox_sync_leases lease
    where lease.connection_id=p_connection_id and lease.owner_id=p_sync_lock_owner
      and lease.expires_at>clock_timestamp()) then
    raise exception 'finalization_lease_changed' using errcode='40001';
  end if;
  if v_replay then
    return jsonb_build_object('already_finalized',true,'target_opportunity_id',p_target_opportunity_id,
      'message_count',v_count,'finalized_at',v_existing.finalized_at);
  end if;

  -- Mint only the two exact child tokens. The existing trigger context remains
  -- narrow to this connection/thread/target; no message or opportunity is edited.
  insert into private.opportunity_child_reparent_tokens
    (transaction_id,backend_pid,table_name,row_id,old_opportunity_id,new_opportunity_id)
    values (txid_current(),pg_backend_pid(),'email_threads',v_thread.id,p_source_opportunity_id,p_target_opportunity_id),
      (txid_current(),pg_backend_pid(),'opportunity_email_threads',v_link.id,p_source_opportunity_id,p_target_opportunity_id);
  perform set_config('ops.email_thread_reassignment_mode','data_review',true);
  perform set_config('ops.email_thread_reassignment_connection_id',p_connection_id::text,true);
  perform set_config('ops.email_thread_reassignment_thread_id',p_provider_thread_id,true);
  perform set_config('ops.email_thread_reassignment_winner_id',p_target_opportunity_id::text,true);
  update public.opportunity_email_threads link set opportunity_id=p_target_opportunity_id
    where link.id=v_link.id returning to_jsonb(link) into v_link_after;
  update public.email_threads thread set opportunity_id=p_target_opportunity_id,client_id=v_target.client_id
    where thread.id=v_thread.id returning to_jsonb(thread) into v_thread_after;
  if (v_thread_after - array['opportunity_id','client_id','updated_at'])
      is distinct from (p_expected_thread_snapshot - array['opportunity_id','client_id','updated_at'])
    or (v_link_after - 'opportunity_id') is distinct from (p_expected_link_snapshot - 'opportunity_id')
    or (select to_jsonb(o) from public.opportunities o where o.id=p_source_opportunity_id) is distinct from p_expected_source_snapshot
    or (select to_jsonb(o) from public.opportunities o where o.id=p_target_opportunity_id) is distinct from p_expected_target_snapshot
  then
    raise exception 'finalization_preservation_failed' using errcode='40001';
  end if;
  if not exists(select 1 from private.email_provider_mailbox_sync_leases lease
    where lease.connection_id=p_connection_id and lease.owner_id=p_sync_lock_owner
      and lease.expires_at>clock_timestamp()) then
    raise exception 'finalization_lease_changed' using errcode='40001';
  end if;
  insert into private.email_thread_recovery_finalizations
    (company_id,connection_id,provider_thread_id,actor_user_id,source_opportunity_id,target_opportunity_id,
      target_email,manifest_sha256,evidence,source_snapshot,target_snapshot,thread_snapshot,link_snapshot,thread_after,link_after)
    values (p_company_id,p_connection_id,p_provider_thread_id,p_actor_user_id,p_source_opportunity_id,p_target_opportunity_id,
      p_target_email,p_manifest_sha256,p_evidence,p_expected_source_snapshot,p_expected_target_snapshot,
      p_expected_thread_snapshot,p_expected_link_snapshot,v_thread_after,v_link_after)
    returning * into v_existing;
  perform set_config('ops.email_thread_reassignment_mode',coalesce(v_previous_mode,''),true);
  perform set_config('ops.email_thread_reassignment_connection_id',coalesce(v_previous_connection,''),true);
  perform set_config('ops.email_thread_reassignment_thread_id',coalesce(v_previous_thread,''),true);
  perform set_config('ops.email_thread_reassignment_winner_id',coalesce(v_previous_winner,''),true);
  return jsonb_build_object('already_finalized',false,'target_opportunity_id',p_target_opportunity_id,
    'message_count',v_count,'finalized_at',v_existing.finalized_at);
exception when others then
  -- PL/pgSQL rolls this block back (including both tokens and the first update)
  -- before entering the handler. Restore the caller's context and fail closed.
  perform set_config('ops.email_thread_reassignment_mode',coalesce(v_previous_mode,''),true);
  perform set_config('ops.email_thread_reassignment_connection_id',coalesce(v_previous_connection,''),true);
  perform set_config('ops.email_thread_reassignment_thread_id',coalesce(v_previous_thread,''),true);
  perform set_config('ops.email_thread_reassignment_winner_id',coalesce(v_previous_winner,''),true);
  raise;
end;
$function$;
revoke all on function public.finalize_exact_email_thread_recovery_guarded(
  uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.finalize_exact_email_thread_recovery_guarded(
  uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

commit;
