-- Preserve a shared source client when a guarded staff false-lead repair
-- finds any schema-wide reference after moving the reviewed correspondence.
-- The false opportunity is still discarded and deleted; the client is
-- deleted only when the existing reference scan proves zero remaining use.

begin;

create or replace function public.apply_staff_authored_false_lead_correction_guarded(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_correction_key text,
  p_manifest_sha256 text,
  p_entry_a_sha256 text,
  p_entry_b_sha256 text,
  p_spec jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_required_keys constant text[] := array[
    'connection_id',
    'default_owner_id',
    'staff_user_id',
    'staff_alias',
    'staff_registered_email',
    'staff_phone',
    'source_opportunity_id',
    'source_client_id',
    'source_updated_at',
    'source_stage',
    'source_stage_manually_set',
    'source_assigned_to',
    'source_assignment_version',
    'source_project_id',
    'target_opportunity_id',
    'target_client_id',
    'target_updated_at',
    'target_stage',
    'target_stage_manually_set',
    'target_assigned_to',
    'target_assignment_version',
    'target_project_id',
    'activity_a_id',
    'event_a_id',
    'thread_a_row_id',
    'link_a_id',
    'provider_thread_a',
    'provider_message_a',
    'attachment_id',
    'activity_b_id',
    'event_b_id',
    'thread_b_row_id',
    'link_b_id',
    'provider_thread_b',
    'provider_message_b',
    'customer_a_email',
    'customer_a_name',
    'customer_a_address',
    'customer_a_title',
    'customer_a_source_thread_key',
    'customer_b_email',
    'source_lifecycle_updated_at',
    'source_lifecycle_last_event_id',
    'assignment_event_id',
    'delivery_id',
    'notification_ids',
    'ai_draft_id',
    'mailbox_draft_id',
    'field_provenance_ids'
  ];
  v_existing public.lead_intake_correction_runs%rowtype;
  v_connection public.email_connections%rowtype;
  v_actor public.users%rowtype;
  v_staff public.users%rowtype;
  v_source public.opportunities%rowtype;
  v_target public.opportunities%rowtype;
  v_target_after public.opportunities%rowtype;
  v_locked_opportunity public.opportunities%rowtype;
  v_activity_a public.activities%rowtype;
  v_activity_b public.activities%rowtype;
  v_event_a public.opportunity_correspondence_events%rowtype;
  v_event_b public.opportunity_correspondence_events%rowtype;
  v_alias public.user_email_aliases%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_connection_id uuid;
  v_default_owner_id uuid;
  v_staff_user_id uuid;
  v_staff_alias text;
  v_staff_registered_email text;
  v_staff_phone text;
  v_source_id uuid;
  v_source_client_id uuid;
  v_source_updated_at timestamptz;
  v_source_stage text;
  v_source_stage_manually_set boolean;
  v_source_assigned_to uuid;
  v_source_assignment_version bigint;
  v_source_project_id uuid;
  v_target_id uuid;
  v_target_client_id uuid;
  v_target_updated_at timestamptz;
  v_target_stage text;
  v_target_stage_manually_set boolean;
  v_target_assigned_to uuid;
  v_target_assignment_version bigint;
  v_target_project_id uuid;
  v_activity_a_id uuid;
  v_event_a_id uuid;
  v_thread_a_row_id uuid;
  v_link_a_id uuid;
  v_provider_thread_a text;
  v_provider_message_a text;
  v_attachment_id uuid;
  v_activity_b_id uuid;
  v_event_b_id uuid;
  v_thread_b_row_id uuid;
  v_link_b_id uuid;
  v_provider_thread_b text;
  v_provider_message_b text;
  v_customer_a_email text;
  v_customer_a_name text;
  v_customer_a_address text;
  v_customer_a_title text;
  v_customer_a_source_thread_key text;
  v_customer_b_email text;
  v_source_lifecycle_updated_at timestamptz;
  v_source_lifecycle_last_event_id uuid;
  v_assignment_event_id uuid;
  v_delivery_id uuid;
  v_ai_draft_id uuid;
  v_mailbox_draft_id text;
  v_notification_ids uuid[];
  v_expected_notification_ids uuid[];
  v_provenance_ids uuid[];
  v_expected_provenance_ids uuid[];
  v_expected_pair_ids uuid[];
  v_actual_ids uuid[];
  v_new_client_id uuid;
  v_new_opportunity_id uuid;
  v_assignment_result jsonb;
  v_result jsonb;
  v_prior_scan_generation_a bigint := 0;
  v_prior_scan_generation_b bigint := 0;
  v_attachment_scan_generation bigint;
  v_scan_generation_b bigint;
  v_previous_mode text :=
    pg_catalog.current_setting('ops.email_thread_reassignment_mode', true);
  v_previous_connection text :=
    pg_catalog.current_setting(
      'ops.email_thread_reassignment_connection_id',
      true
    );
  v_previous_thread text :=
    pg_catalog.current_setting('ops.email_thread_reassignment_thread_id', true);
  v_previous_winner text :=
    pg_catalog.current_setting('ops.email_thread_reassignment_winner_id', true);
  v_rows integer;
  v_reference_count bigint;
  v_total_client_reference_count bigint := 0;
  v_source_client_deleted boolean := false;
  v_reference record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
    or p_company_id is null
    or nullif(btrim(p_correction_key), '') is null
    or p_correction_key is distinct from btrim(p_correction_key)
    or length(p_correction_key) not between 8 and 200
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_entry_a_sha256 !~ '^[0-9a-f]{64}$'
    or p_entry_b_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_spec) is distinct from 'object'
    or not (p_spec ?& v_required_keys)
    or p_spec - v_required_keys <> '{}'::jsonb
    or jsonb_typeof(p_spec -> 'notification_ids') is distinct from 'array'
    or jsonb_typeof(p_spec -> 'field_provenance_ids') is distinct from 'array'
  then
    raise exception 'invalid_staff_false_lead_correction_request'
      using errcode = '22023';
  end if;

  begin
    v_connection_id := (p_spec ->> 'connection_id')::uuid;
    v_default_owner_id := (p_spec ->> 'default_owner_id')::uuid;
    v_staff_user_id := (p_spec ->> 'staff_user_id')::uuid;
    v_staff_alias := lower(btrim(p_spec ->> 'staff_alias'));
    v_staff_registered_email :=
      lower(btrim(p_spec ->> 'staff_registered_email'));
    v_staff_phone :=
      pg_catalog.regexp_replace(p_spec ->> 'staff_phone', '\D', '', 'g');
    v_source_id := (p_spec ->> 'source_opportunity_id')::uuid;
    v_source_client_id := (p_spec ->> 'source_client_id')::uuid;
    v_source_updated_at := (p_spec ->> 'source_updated_at')::timestamptz;
    v_source_stage := p_spec ->> 'source_stage';
    v_source_stage_manually_set :=
      (p_spec ->> 'source_stage_manually_set')::boolean;
    v_source_assigned_to :=
      nullif(p_spec ->> 'source_assigned_to', '')::uuid;
    v_source_assignment_version :=
      (p_spec ->> 'source_assignment_version')::bigint;
    v_source_project_id :=
      nullif(p_spec ->> 'source_project_id', '')::uuid;
    v_target_id := (p_spec ->> 'target_opportunity_id')::uuid;
    v_target_client_id := (p_spec ->> 'target_client_id')::uuid;
    v_target_updated_at := (p_spec ->> 'target_updated_at')::timestamptz;
    v_target_stage := p_spec ->> 'target_stage';
    v_target_stage_manually_set :=
      (p_spec ->> 'target_stage_manually_set')::boolean;
    v_target_assigned_to :=
      nullif(p_spec ->> 'target_assigned_to', '')::uuid;
    v_target_assignment_version :=
      (p_spec ->> 'target_assignment_version')::bigint;
    v_target_project_id :=
      nullif(p_spec ->> 'target_project_id', '')::uuid;
    v_activity_a_id := (p_spec ->> 'activity_a_id')::uuid;
    v_event_a_id := (p_spec ->> 'event_a_id')::uuid;
    v_thread_a_row_id := (p_spec ->> 'thread_a_row_id')::uuid;
    v_link_a_id := (p_spec ->> 'link_a_id')::uuid;
    v_provider_thread_a := btrim(p_spec ->> 'provider_thread_a');
    v_provider_message_a := btrim(p_spec ->> 'provider_message_a');
    v_attachment_id := (p_spec ->> 'attachment_id')::uuid;
    v_activity_b_id := (p_spec ->> 'activity_b_id')::uuid;
    v_event_b_id := (p_spec ->> 'event_b_id')::uuid;
    v_thread_b_row_id := (p_spec ->> 'thread_b_row_id')::uuid;
    v_link_b_id := (p_spec ->> 'link_b_id')::uuid;
    v_provider_thread_b := btrim(p_spec ->> 'provider_thread_b');
    v_provider_message_b := btrim(p_spec ->> 'provider_message_b');
    v_customer_a_email := lower(btrim(p_spec ->> 'customer_a_email'));
    v_customer_a_name := btrim(p_spec ->> 'customer_a_name');
    v_customer_a_address := btrim(p_spec ->> 'customer_a_address');
    v_customer_a_title := btrim(p_spec ->> 'customer_a_title');
    v_customer_a_source_thread_key :=
      btrim(p_spec ->> 'customer_a_source_thread_key');
    v_customer_b_email := lower(btrim(p_spec ->> 'customer_b_email'));
    v_source_lifecycle_updated_at :=
      (p_spec ->> 'source_lifecycle_updated_at')::timestamptz;
    v_source_lifecycle_last_event_id :=
      (p_spec ->> 'source_lifecycle_last_event_id')::uuid;
    v_assignment_event_id := (p_spec ->> 'assignment_event_id')::uuid;
    v_delivery_id := (p_spec ->> 'delivery_id')::uuid;
    v_ai_draft_id := (p_spec ->> 'ai_draft_id')::uuid;
    v_mailbox_draft_id := btrim(p_spec ->> 'mailbox_draft_id');

    select coalesce(array_agg(value::uuid order by value::uuid), '{}'::uuid[])
      into v_expected_notification_ids
      from pg_catalog.jsonb_array_elements_text(
        p_spec -> 'notification_ids'
      ) value;
    select coalesce(array_agg(value::uuid order by value::uuid), '{}'::uuid[])
      into v_expected_provenance_ids
      from pg_catalog.jsonb_array_elements_text(
        p_spec -> 'field_provenance_ids'
      ) value;
  exception when others then
    raise exception 'invalid_staff_false_lead_correction_spec'
      using errcode = '22023';
  end;

  if v_staff_alias !~
      '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    or v_staff_registered_email !~
      '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    or length(v_staff_phone) < 10
    or v_customer_a_email !~
      '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    or v_customer_b_email !~
      '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    or nullif(v_customer_a_name, '') is null
    or nullif(v_customer_a_title, '') is null
    or nullif(v_customer_a_source_thread_key, '') is null
    or v_customer_a_source_thread_key not like '%:message:%'
    or private.normalize_property_address(
      v_customer_a_address,
      true
    ) = ''
    or cardinality(v_expected_notification_ids) = 0
    or cardinality(v_expected_provenance_ids) = 0
    or v_source_id = v_target_id
    or v_activity_a_id = v_activity_b_id
    or v_event_a_id = v_event_b_id
    or v_provider_thread_a = v_provider_thread_b
  then
    raise exception 'invalid_staff_false_lead_correction_evidence'
      using errcode = '22023';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);

  select correction.*
    into v_existing
    from public.lead_intake_correction_runs correction
   where correction.company_id = p_company_id
     and correction.correction_key = p_correction_key
   for update;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.source_opportunity_id is distinct from v_source_id
      or v_existing.manifest_sha256 is distinct from p_manifest_sha256
      or v_existing.entry_a_sha256 is distinct from p_entry_a_sha256
      or v_existing.entry_b_sha256 is distinct from p_entry_b_sha256
      or v_existing.input_spec is distinct from p_spec
    then
      raise exception 'repair_manifest_conflict' using errcode = '23505';
    end if;

    v_new_client_id :=
      (v_existing.result ->> 'new_client_id')::uuid;
    v_new_opportunity_id :=
      (v_existing.result ->> 'new_opportunity_id')::uuid;
    if not exists (
      select 1
        from public.opportunities source
       where source.id = v_source_id
         and source.company_id = p_company_id
         and source.stage = 'discarded'
         and source.deleted_at is not null
         and source.archived_at is not null
    ) or not exists (
      select 1
        from public.opportunities target
       where target.id = v_new_opportunity_id
         and target.company_id = p_company_id
         and target.client_id = v_new_client_id
         and target.deleted_at is null
    ) or not exists (
      select 1
        from public.opportunity_correspondence_events event
       where event.id = v_event_a_id
         and event.opportunity_id = v_new_opportunity_id
         and event.direction = 'outbound'
         and event.party_role = 'ops'
    ) or not exists (
      select 1
        from public.opportunity_correspondence_events event
       where event.id = v_event_b_id
         and event.opportunity_id = v_target_id
         and event.direction = 'outbound'
         and event.party_role = 'ops'
    ) or not exists (
      select 1
        from public.user_email_aliases alias
       where alias.company_id = p_company_id
         and alias.email = v_staff_alias
         and alias.user_id = v_staff_user_id
         and alias.status = 'verified'
         and alias.source = 'operator_verified'
    ) then
      raise exception 'repair_applied_state_changed' using errcode = '40001';
    end if;

    return v_existing.result || pg_catalog.jsonb_build_object(
      'applied',
      false,
      'already_applied',
      true
    );
  end if;

  select connection.*
    into v_connection
    from public.email_connections connection
   where connection.id = v_connection_id
     and connection.company_id = p_company_id::text
     and connection.status = 'active'
     and connection.sync_enabled is true
     and connection.provider = 'gmail'
     and connection.type::text = 'company'
     and connection.default_intake_owner_id = v_default_owner_id
   for update;
  if not found then
    raise exception 'repair_mailbox_snapshot_changed' using errcode = '40001';
  end if;

  select actor.*
    into v_actor
    from public.users actor
   where actor.id = p_actor_user_id
     and actor.company_id = p_company_id
     and actor.deleted_at is null
     and actor.is_active is true
   for share;
  if not found
    or not private.permission_user_is_admin(
      p_actor_user_id,
      p_company_id
    )
    or not public.authorize_email_inbox_action_as_system(
      p_actor_user_id,
      v_connection_id,
      null,
      'view'
    )
  then
    raise exception 'repair_actor_not_authorized' using errcode = '42501';
  end if;

  select staff.*
    into v_staff
    from public.users staff
   where staff.id = v_staff_user_id
     and staff.company_id = p_company_id
     and staff.deleted_at is null
     and staff.is_active is true
   for share;
  if not found
    or lower(btrim(v_staff.email)) is distinct from v_staff_registered_email
    or pg_catalog.regexp_replace(
      coalesce(v_staff.phone, ''),
      '\D',
      '',
      'g'
    ) is distinct from v_staff_phone
    or v_staff_alias = v_staff_registered_email
  then
    raise exception 'registered staff email or phone snapshot changed'
      using errcode = '40001';
  end if;

  for v_locked_opportunity in
    select opportunity.*
      from public.opportunities opportunity
     where opportunity.company_id = p_company_id
       and opportunity.id = any(array[v_source_id, v_target_id])
     order by opportunity.id
     for update
  loop
    if v_locked_opportunity.id = v_source_id then
      v_source := v_locked_opportunity;
    elsif v_locked_opportunity.id = v_target_id then
      v_target := v_locked_opportunity;
    end if;
  end loop;

  if v_source.id is null
    or v_source.deleted_at is not null
    or v_source.archived_at is not null
    or v_source.client_id is distinct from v_source_client_id
    or v_source.client_ref is not null
    or v_source.updated_at is distinct from v_source_updated_at
    or v_source.stage is distinct from v_source_stage
    or v_source.stage_manually_set is distinct from
      v_source_stage_manually_set
    or v_source.assigned_to is distinct from v_source_assigned_to
    or v_source.assignment_version is distinct from
      v_source_assignment_version
    or v_source.project_id is distinct from v_source_project_id
    or v_source.project_ref is distinct from v_source_project_id
    or lower(btrim(coalesce(v_source.contact_email, ''))) is distinct from
      v_staff_alias
    or v_source.correspondence_count <> 2
    or v_source.inbound_count <> 2
    or v_source.outbound_count <> 0
  then
    raise exception 'source_opportunity_snapshot_changed'
      using errcode = '40001';
  end if;

  if v_target.id is null
    or v_target.deleted_at is not null
    or v_target.archived_at is not null
    or v_target.client_id is distinct from v_target_client_id
    or v_target.updated_at is distinct from v_target_updated_at
    or v_target.stage is distinct from v_target_stage
    or v_target.stage_manually_set is distinct from
      v_target_stage_manually_set
    or v_target.assigned_to is distinct from v_target_assigned_to
    or v_target.assignment_version is distinct from
      v_target_assignment_version
    or v_target.project_id is distinct from v_target_project_id
    or v_target.project_ref is distinct from v_target_project_id
    or lower(btrim(coalesce(v_target.contact_email, ''))) is distinct from
      v_customer_b_email
  then
    raise exception 'protected_target_snapshot_changed'
      using errcode = '40001';
  end if;

  perform 1
    from public.clients client
   where client.id in (v_source_client_id, v_target_client_id)
     and client.company_id = p_company_id
     and client.deleted_at is null
   order by client.id
   for update;
  if (select count(*)
        from public.clients client
       where client.id in (v_source_client_id, v_target_client_id)
         and client.company_id = p_company_id
         and client.deleted_at is null) <> 2
    or not exists (
      select 1
        from public.clients client
       where client.id = v_source_client_id
         and lower(btrim(coalesce(client.email, ''))) = v_staff_alias
    )
    or not exists (
      select 1
        from public.clients client
       where client.id = v_target_client_id
         and lower(btrim(coalesce(client.email, ''))) = v_customer_b_email
    )
  then
    raise exception 'repair_client_snapshot_changed' using errcode = '40001';
  end if;

  select coalesce(array_agg(activity.id order by activity.id), '{}'::uuid[])
    into v_actual_ids
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.opportunity_id = v_source_id;
  select array_agg(value order by value)
    into v_expected_pair_ids
    from unnest(array[v_activity_a_id, v_activity_b_id]) value;
  if v_actual_ids is distinct from v_expected_pair_ids then
    raise exception 'staff_false_lead_activity_set_changed'
      using errcode = '40001';
  end if;

  select activity.*
    into v_activity_a
    from public.activities activity
   where activity.id = v_activity_a_id
     and activity.company_id = p_company_id
     and activity.opportunity_id = v_source_id
     and activity.email_connection_id = v_connection_id
     and activity.email_thread_id = v_provider_thread_a
     and activity.email_message_id = v_provider_message_a
     and activity.type = 'email'
     and activity.direction = 'inbound'
     and lower(btrim(coalesce(activity.from_email, ''))) = v_staff_alias
     and v_customer_a_email = any(
       select lower(btrim(participant))
         from unnest(
           coalesce(activity.to_emails, '{}'::text[])
           || coalesce(activity.cc_emails, '{}'::text[])
         ) participant
     )
   for update;
  if not found then
    raise exception 'staff_false_lead_activity_a_changed'
      using errcode = '40001';
  end if;

  select activity.*
    into v_activity_b
    from public.activities activity
   where activity.id = v_activity_b_id
     and activity.company_id = p_company_id
     and activity.opportunity_id = v_source_id
     and activity.email_connection_id = v_connection_id
     and activity.email_thread_id = v_provider_thread_b
     and activity.email_message_id = v_provider_message_b
     and activity.type = 'email'
     and activity.direction = 'inbound'
     and lower(btrim(coalesce(activity.from_email, ''))) = v_staff_alias
     and v_customer_b_email = any(
       select lower(btrim(participant))
         from unnest(
           coalesce(activity.to_emails, '{}'::text[])
           || coalesce(activity.cc_emails, '{}'::text[])
         ) participant
     )
   for update;
  if not found then
    raise exception 'staff_false_lead_activity_b_changed'
      using errcode = '40001';
  end if;

  select coalesce(array_agg(event.id order by event.id), '{}'::uuid[])
    into v_actual_ids
    from public.opportunity_correspondence_events event
   where event.company_id = p_company_id
     and event.opportunity_id = v_source_id;
  select array_agg(value order by value)
    into v_expected_pair_ids
    from unnest(array[v_event_a_id, v_event_b_id]) value;
  if v_actual_ids is distinct from v_expected_pair_ids then
    raise exception 'staff_false_lead_event_set_changed'
      using errcode = '40001';
  end if;

  select event.*
    into v_event_a
    from public.opportunity_correspondence_events event
   where event.id = v_event_a_id
     and event.company_id = p_company_id
     and event.opportunity_id = v_source_id
     and event.activity_id = v_activity_a_id
     and event.connection_id = v_connection_id
     and event.provider_thread_id = v_provider_thread_a
     and event.provider_message_id = v_provider_message_a
     and event.direction = 'inbound'
     and event.party_role = 'customer'
     and event.is_meaningful is true
     and event.opportunity_projection_applied is true
     and lower(btrim(coalesce(event.from_email, ''))) = v_staff_alias
   for update;
  if not found then
    raise exception 'staff_false_lead_event_a_changed'
      using errcode = '40001';
  end if;

  select event.*
    into v_event_b
    from public.opportunity_correspondence_events event
   where event.id = v_event_b_id
     and event.company_id = p_company_id
     and event.opportunity_id = v_source_id
     and event.activity_id = v_activity_b_id
     and event.connection_id = v_connection_id
     and event.provider_thread_id = v_provider_thread_b
     and event.provider_message_id = v_provider_message_b
     and event.direction = 'inbound'
     and event.party_role = 'customer'
     and event.is_meaningful is true
     and event.opportunity_projection_applied is true
     and lower(btrim(coalesce(event.from_email, ''))) = v_staff_alias
   for update;
  if not found then
    raise exception 'staff_false_lead_event_b_changed'
      using errcode = '40001';
  end if;

  select coalesce(array_agg(link.id order by link.id), '{}'::uuid[])
    into v_actual_ids
    from public.opportunity_email_threads link
   where link.opportunity_id = v_source_id;
  select array_agg(value order by value)
    into v_expected_pair_ids
    from unnest(array[v_link_a_id, v_link_b_id]) value;
  if v_actual_ids is distinct from v_expected_pair_ids then
    raise exception 'staff_false_lead_thread_set_changed'
      using errcode = '40001';
  end if;

  perform 1
    from public.opportunity_email_threads link
   where link.id = v_link_a_id
     and link.opportunity_id = v_source_id
     and link.connection_id = v_connection_id
     and link.thread_id = v_provider_thread_a
   for update;
  if not found then
    raise exception 'staff_false_lead_link_a_changed' using errcode = '40001';
  end if;
  perform 1
    from public.opportunity_email_threads link
   where link.id = v_link_b_id
     and link.opportunity_id = v_source_id
     and link.connection_id = v_connection_id
     and link.thread_id = v_provider_thread_b
   for update;
  if not found then
    raise exception 'staff_false_lead_link_b_changed' using errcode = '40001';
  end if;

  perform 1
    from public.email_threads thread
   where thread.id = v_thread_a_row_id
     and thread.company_id = p_company_id
     and thread.connection_id = v_connection_id
     and thread.provider_thread_id = v_provider_thread_a
     and thread.opportunity_id = v_source_id
     and thread.client_id = v_source_client_id
     and thread.message_count = 1
     and thread.latest_direction = 'inbound'
   for update;
  if not found then
    raise exception 'staff_false_lead_thread_a_changed'
      using errcode = '40001';
  end if;
  perform 1
    from public.email_threads thread
   where thread.id = v_thread_b_row_id
     and thread.company_id = p_company_id
     and thread.connection_id = v_connection_id
     and thread.provider_thread_id = v_provider_thread_b
     and thread.opportunity_id is null
     and thread.client_id = v_target_client_id
     and thread.latest_direction = 'inbound'
   for update;
  if not found then
    raise exception 'staff_false_lead_thread_b_changed'
      using errcode = '40001';
  end if;
  if (select count(*)
        from public.email_threads thread
       where thread.company_id = p_company_id
         and thread.connection_id = v_connection_id
         and thread.provider_thread_id in (
           v_provider_thread_a,
           v_provider_thread_b
         )) <> 2
  then
    raise exception 'staff_false_lead_thread_set_changed'
      using errcode = '40001';
  end if;

  perform 1
    from public.email_attachments attachment
   where attachment.id = v_attachment_id
     and attachment.company_id = p_company_id
     and attachment.connection_id = v_connection_id
     and attachment.provider_thread_id = v_provider_thread_a
     and attachment.message_id = v_provider_message_a
     and attachment.activity_id = v_activity_a_id
     and attachment.opportunity_id = v_source_id
     and attachment.attribution_status = 'attributed'
   for update;
  if not found
    or (select count(*)
          from public.email_attachments attachment
         where attachment.activity_id in (v_activity_a_id, v_activity_b_id)) <> 1
  then
    raise exception 'staff_false_lead_attachment_changed'
      using errcode = '40001';
  end if;

  select coalesce(scan.generation, 0)
    into v_prior_scan_generation_a
    from public.email_attachment_scans scan
   where scan.activity_id = v_activity_a_id
     and scan.company_id = p_company_id
     and scan.connection_id = v_connection_id
     and scan.provider_thread_id = v_provider_thread_a
     and scan.message_id = v_provider_message_a
   for update;
  if not found then
    v_prior_scan_generation_a := 0;
  end if;
  select coalesce(scan.generation, 0)
    into v_prior_scan_generation_b
    from public.email_attachment_scans scan
   where scan.activity_id = v_activity_b_id
     and scan.company_id = p_company_id
     and scan.connection_id = v_connection_id
     and scan.provider_thread_id = v_provider_thread_b
     and scan.message_id = v_provider_message_b
   for update;
  if not found then
    v_prior_scan_generation_b := 0;
  end if;

  perform 1
    from public.opportunity_lifecycle_state state
   where state.company_id = p_company_id
     and state.opportunity_id = v_source_id
     and state.updated_at = v_source_lifecycle_updated_at
     and state.last_meaningful_event_id =
       v_source_lifecycle_last_event_id
     and state.last_meaningful_direction = 'inbound'
     and state.stale_status = 'operator_follow_up_miss'
     and state.operator_follow_up_miss_at is not null
   for update;
  if not found then
    raise exception 'staff_false_lead_lifecycle_changed'
      using errcode = '40001';
  end if;

  select coalesce(array_agg(notification.id order by notification.id), '{}'::uuid[])
    into v_notification_ids
    from public.notifications notification
   where notification.company_id = p_company_id::text
     and (
       notification.action_url like '%' || v_source_id::text || '%'
       or notification.dedupe_key like '%' || v_source_id::text || '%'
     );
  if v_notification_ids is distinct from v_expected_notification_ids then
    raise exception 'staff_false_lead_notification_set_changed'
      using errcode = '40001';
  end if;
  perform 1
    from public.notifications notification
   where notification.id = any(v_expected_notification_ids)
   order by notification.id
   for update;
  if (select count(*)
        from public.notifications notification
       where notification.id = any(v_expected_notification_ids)
         and notification.company_id = p_company_id::text
         and notification.resolved_at is null) <>
      cardinality(v_expected_notification_ids)
  then
    raise exception 'staff_false_lead_notification_set_changed'
      using errcode = '40001';
  end if;

  perform 1
    from public.opportunity_assignment_events assignment_event
   where assignment_event.id = v_assignment_event_id
     and assignment_event.company_id = p_company_id
     and assignment_event.opportunity_id = v_source_id
     and assignment_event.assignment_version = v_source_assignment_version
     and assignment_event.new_assignee_id = v_source_assigned_to
   for update;
  if not found
    or (select count(*)
          from public.opportunity_assignment_events assignment_event
         where assignment_event.opportunity_id = v_source_id) <> 1
  then
    raise exception 'staff_false_lead_assignment_changed'
      using errcode = '40001';
  end if;

  perform 1
    from public.opportunity_assignment_deliveries delivery
   where delivery.id = v_delivery_id
     and delivery.company_id = p_company_id
     and delivery.opportunity_id = v_source_id
     and delivery.assignment_event_id = v_assignment_event_id
     and delivery.assignment_version = v_source_assignment_version
     and delivery.state = 'delivered'
   for update;
  if not found
    or (select count(*)
          from public.opportunity_assignment_deliveries delivery
         where delivery.opportunity_id = v_source_id) <> 1
  then
    raise exception 'staff_false_lead_delivery_changed'
      using errcode = '40001';
  end if;

  perform 1
    from public.ai_draft_history draft
   where draft.id = v_ai_draft_id
     and draft.company_id = p_company_id
     and draft.opportunity_id = v_source_id
     and draft.connection_id = v_connection_id
     and draft.thread_id = v_provider_thread_a
     and draft.source_message_id = v_provider_message_a
     and draft.mailbox_draft_id = v_mailbox_draft_id
     and draft.status = 'auto_drafted'
     and draft.sent_at is null
     and draft.discarded_at is null
   for update;
  if not found
    or (select count(*)
          from public.ai_draft_history draft
         where draft.opportunity_id = v_source_id) <> 1
  then
    raise exception 'staff_false_lead_draft_changed'
      using errcode = '40001';
  end if;

  select coalesce(array_agg(provenance.id order by provenance.id), '{}'::uuid[])
    into v_provenance_ids
    from public.lead_field_provenance provenance
   where provenance.company_id = p_company_id
     and provenance.entity_type = 'opportunity'
     and provenance.entity_id = v_source_id;
  if v_provenance_ids is distinct from v_expected_provenance_ids then
    raise exception 'staff_false_lead_provenance_changed'
      using errcode = '40001';
  end if;
  perform 1
    from public.lead_field_provenance provenance
   where provenance.id = any(v_expected_provenance_ids)
   order by provenance.id
   for update;

  if exists (
    select 1 from public.follow_ups row
     where row.opportunity_id = v_source_id
  ) or exists (
    select 1 from public.stage_transitions row
     where row.opportunity_id = v_source_id
  ) or exists (
    select 1 from public.site_visits row
     where row.opportunity_id = v_source_id
  ) or exists (
    select 1 from public.opportunity_follow_up_drafts row
     where row.opportunity_id = v_source_id
  ) or exists (
    select 1 from public.opportunity_lifecycle_action_audit row
     where row.opportunity_id = v_source_id
  ) or exists (
    select 1 from public.pending_auto_sends row
     where row.opportunity_id = v_source_id
  ) or exists (
    select 1 from public.opportunity_dispositions row
     where row.opportunity_id = v_source_id
  ) or exists (
    select 1 from public.deck_designs row
     where row.opportunity_id = v_source_id
  ) or exists (
    select 1 from public.projects row
     where row.opportunity_id = v_source_id::text
  ) or exists (
    select 1 from public.approved_action_email_intents row
     where row.opportunity_id = v_source_id
        or row.source_activity_id in (v_activity_a_id, v_activity_b_id)
  ) or exists (
    select 1 from public.email_assignment_contact_form_draft_queue row
     where row.source_activity_id in (v_activity_a_id, v_activity_b_id)
  ) then
    raise exception 'staff_false_lead_has_unreviewed_children'
      using errcode = '55000';
  end if;

  select alias.*
    into v_alias
    from public.user_email_aliases alias
   where alias.company_id = p_company_id
     and alias.email = v_staff_alias
   for update;
  if found then
    if v_alias.user_id is distinct from v_staff_user_id
      or v_alias.status = 'rejected'
      or (
        v_alias.status = 'verified'
        and v_alias.source is distinct from 'operator_verified'
      )
    then
      raise exception 'staff_alias_conflict' using errcode = '23505';
    end if;
    if v_alias.status = 'pending' then
      update public.user_email_aliases alias
         set status = 'verified',
             source = 'operator_verified',
             reviewed_at = v_now,
             reviewed_by = p_actor_user_id,
             verified_at = v_now,
             verified_by = p_actor_user_id,
             evidence = alias.evidence || pg_catalog.jsonb_build_object(
               'correction_key',
               p_correction_key,
               'manifest_sha256',
               p_manifest_sha256,
               'reviewed_at',
               v_now,
               'reviewed_by',
               p_actor_user_id,
               'review_status',
               'verified'
             )
       where alias.id = v_alias.id;
    end if;
  else
    if exists (
      select 1
        from public.users registered
       where registered.company_id = p_company_id
         and lower(btrim(registered.email)) = v_staff_alias
         and registered.id <> v_staff_user_id
         and registered.deleted_at is null
    ) then
      raise exception 'registered staff email belongs to another user'
        using errcode = '23505';
    end if;
    insert into public.user_email_aliases (
      company_id,
      user_id,
      email,
      status,
      source,
      evidence,
      first_seen_at,
      last_seen_at,
      reviewed_at,
      reviewed_by,
      verified_at,
      verified_by
    ) values (
      p_company_id,
      v_staff_user_id,
      v_staff_alias,
      'verified',
      'operator_verified',
      pg_catalog.jsonb_build_object(
        'connection_id',
        v_connection_id,
        'provider_thread_ids',
        pg_catalog.jsonb_build_array(
          v_provider_thread_a,
          v_provider_thread_b
        ),
        'provider_message_ids',
        pg_catalog.jsonb_build_array(
          v_provider_message_a,
          v_provider_message_b
        ),
        'registered_email_recipient',
        true,
        'signature_phone',
        v_staff_phone,
        'correction_key',
        p_correction_key,
        'manifest_sha256',
        p_manifest_sha256
      ),
      least(v_event_a.occurred_at, v_event_b.occurred_at),
      greatest(v_event_a.occurred_at, v_event_b.occurred_at),
      v_now,
      p_actor_user_id,
      v_now,
      p_actor_user_id
    );
  end if;

  if exists (
    select 1
      from public.clients client
     where client.company_id = p_company_id
       and client.deleted_at is null
       and lower(btrim(coalesce(client.email, ''))) = v_customer_a_email
  ) or exists (
    select 1
      from public.opportunities opportunity
     where opportunity.company_id = p_company_id
       and opportunity.deleted_at is null
       and (
         lower(btrim(coalesce(opportunity.contact_email, ''))) =
           v_customer_a_email
         or opportunity.source_thread_key = v_customer_a_source_thread_key
       )
  ) then
    raise exception 'customer_a_identity_conflict' using errcode = '23505';
  end if;

  insert into public.clients (
    company_id,
    name,
    email,
    address
  ) values (
    p_company_id,
    v_customer_a_name,
    v_customer_a_email,
    v_customer_a_address
  )
  returning id into v_new_client_id;

  insert into public.opportunities (
    company_id,
    client_id,
    title,
    contact_name,
    contact_email,
    address,
    description,
    stage,
    source,
    source_email_id,
    source_message_id,
    source_thread_key,
    tags
  ) values (
    p_company_id,
    v_new_client_id,
    v_customer_a_title,
    v_customer_a_name,
    v_customer_a_email,
    v_customer_a_address,
    v_activity_a.body_text_clean,
    'new_lead',
    'email',
    v_provider_message_a,
    v_provider_message_a,
    v_customer_a_source_thread_key,
    array['email-import', 'staff-alias-correction']::text[]
  )
  returning id into v_new_opportunity_id;

  v_assignment_result := public.change_opportunity_assignment_as_system(
    v_new_opportunity_id,
    0,
    null,
    v_default_owner_id,
    'company_mailbox_default',
    p_actor_user_id,
    null,
    pg_catalog.jsonb_build_object(
      'connection_id',
      v_connection_id,
      'provider_thread_id',
      v_provider_thread_a,
      'ingestion_source',
      'guarded_staff_false_lead_correction',
      'correction_key',
      p_correction_key,
      'manifest_sha256',
      p_manifest_sha256,
      'provider_mutations_disabled',
      true
    )
  );

  update public.notifications notification
     set is_read = true,
         persistent = false,
         resolved_at = v_now,
         resolved_by = p_actor_user_id,
         resolution_reason = 'lead_intake_data_correction'
   where notification.id = any(v_expected_notification_ids)
     and notification.company_id = p_company_id::text
     and notification.resolved_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_expected_notification_ids) then
    raise exception 'staff_false_lead_notification_resolution_race'
      using errcode = '40001';
  end if;

  update public.opportunity_lifecycle_state state
     set stale_status = null,
         stale_status_at = null,
         operator_follow_up_miss_at = null,
         protected_until = null,
         updated_at = v_now
   where state.company_id = p_company_id
     and state.opportunity_id = v_source_id
     and state.updated_at = v_source_lifecycle_updated_at
     and state.last_meaningful_event_id =
       v_source_lifecycle_last_event_id;
  if not found then
    raise exception 'staff_false_lead_lifecycle_race'
      using errcode = '40001';
  end if;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id,
    backend_pid,
    table_name,
    row_id,
    old_opportunity_id,
    new_opportunity_id
  ) values
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'activities',
      v_activity_a_id,
      v_source_id,
      v_new_opportunity_id
    ),
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'opportunity_correspondence_events',
      v_event_a_id,
      v_source_id,
      v_new_opportunity_id
    ),
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'activities',
      v_activity_b_id,
      v_source_id,
      v_target_id
    ),
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'opportunity_correspondence_events',
      v_event_b_id,
      v_source_id,
      v_target_id
    ),
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'email_threads',
      v_thread_a_row_id,
      v_source_id,
      v_new_opportunity_id
    ),
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'opportunity_email_threads',
      v_link_a_id,
      v_source_id,
      v_new_opportunity_id
    ),
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'email_threads',
      v_thread_b_row_id,
      null,
      v_target_id
    ),
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'opportunity_email_threads',
      v_link_b_id,
      v_source_id,
      v_target_id
    )
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set
    old_opportunity_id = excluded.old_opportunity_id,
    new_opportunity_id = excluded.new_opportunity_id;

  update public.opportunity_correspondence_events event
     set opportunity_id = v_new_opportunity_id,
         direction = 'outbound',
         party_role = 'ops',
         linked_contact_kind = 'client',
         linked_contact_id = v_new_client_id
   where event.id = v_event_a_id
     and event.company_id = p_company_id
     and event.opportunity_id = v_source_id
     and event.activity_id = v_activity_a_id
     and event.direction = 'inbound'
     and event.party_role = 'customer';
  if not found then
    raise exception 'staff_false_lead_event_a_move_race'
      using errcode = '40001';
  end if;

  update public.activities activity
     set opportunity_id = v_new_opportunity_id,
         client_id = v_new_client_id,
         direction = 'outbound',
         match_confidence = 'exact_contact_email',
         match_needs_review = false
   where activity.id = v_activity_a_id
     and activity.company_id = p_company_id
     and activity.opportunity_id = v_source_id
     and activity.direction = 'inbound';
  if not found then
    raise exception 'staff_false_lead_activity_a_move_race'
      using errcode = '40001';
  end if;

  update public.opportunity_correspondence_events event
     set opportunity_id = v_target_id,
         direction = 'outbound',
         party_role = 'ops',
         linked_contact_kind = 'client',
         linked_contact_id = v_target_client_id
   where event.id = v_event_b_id
     and event.company_id = p_company_id
     and event.opportunity_id = v_source_id
     and event.activity_id = v_activity_b_id
     and event.direction = 'inbound'
     and event.party_role = 'customer';
  if not found then
    raise exception 'staff_false_lead_event_b_move_race'
      using errcode = '40001';
  end if;

  update public.activities activity
     set opportunity_id = v_target_id,
         client_id = v_target_client_id,
         direction = 'outbound',
         match_confidence = 'exact_contact_email',
         match_needs_review = false
   where activity.id = v_activity_b_id
     and activity.company_id = p_company_id
     and activity.opportunity_id = v_source_id
     and activity.direction = 'inbound';
  if not found then
    raise exception 'staff_false_lead_activity_b_move_race'
      using errcode = '40001';
  end if;

  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_mode',
    'data_review',
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_connection_id',
    v_connection_id::text,
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_thread_id',
    v_provider_thread_a,
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_winner_id',
    v_new_opportunity_id::text,
    true
  );

  update public.opportunity_email_threads link
     set opportunity_id = v_new_opportunity_id
   where link.id = v_link_a_id
     and link.opportunity_id = v_source_id;
  if not found then
    raise exception 'staff_false_lead_link_a_move_race'
      using errcode = '40001';
  end if;
  update public.email_threads thread
     set opportunity_id = v_new_opportunity_id,
         client_id = v_new_client_id,
         latest_direction = 'outbound',
         routing = null,
         routing_reasons = null,
         labels = array_remove(thread.labels, 'FROM_NEW_SENDER'),
         updated_at = v_now
   where thread.id = v_thread_a_row_id
     and thread.opportunity_id = v_source_id
     and thread.client_id = v_source_client_id;
  if not found then
    raise exception 'staff_false_lead_thread_a_move_race'
      using errcode = '40001';
  end if;

  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_thread_id',
    v_provider_thread_b,
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_winner_id',
    v_target_id::text,
    true
  );
  update public.opportunity_email_threads link
     set opportunity_id = v_target_id
   where link.id = v_link_b_id
     and link.opportunity_id = v_source_id;
  if not found then
    raise exception 'staff_false_lead_link_b_move_race'
      using errcode = '40001';
  end if;
  update public.email_threads thread
     set opportunity_id = v_target_id,
         latest_direction = 'outbound',
         routing = null,
         routing_reasons = null,
         labels = array_remove(thread.labels, 'FROM_NEW_SENDER'),
         updated_at = v_now
   where thread.id = v_thread_b_row_id
     and thread.opportunity_id is null
     and thread.client_id = v_target_client_id;
  if not found then
    raise exception 'staff_false_lead_thread_b_move_race'
      using errcode = '40001';
  end if;

  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_mode',
    coalesce(v_previous_mode, ''),
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_connection_id',
    coalesce(v_previous_connection, ''),
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_thread_id',
    coalesce(v_previous_thread, ''),
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_winner_id',
    coalesce(v_previous_winner, ''),
    true
  );

  select scan.generation
    into v_attachment_scan_generation
    from public.email_attachment_scans scan
   where scan.activity_id = v_activity_a_id
     and scan.company_id = p_company_id
     and scan.connection_id = v_connection_id
     and scan.provider_thread_id = v_provider_thread_a
     and scan.message_id = v_provider_message_a
     and scan.status = 'pending'
     and scan.lease_owner is null
     and scan.lease_expires_at is null
   for update;
  if not found
    or v_attachment_scan_generation is distinct from
      v_prior_scan_generation_a + 1
    or exists (
      select 1
        from public.email_attachments attachment
       where attachment.id = v_attachment_id
         and (
           attachment.opportunity_id is not null
           or attachment.attribution_status <> 'pending'
         )
    )
  then
    raise exception 'attachment_requeue_failed' using errcode = '55000';
  end if;

  select scan.generation
    into v_scan_generation_b
    from public.email_attachment_scans scan
   where scan.activity_id = v_activity_b_id
     and scan.company_id = p_company_id
     and scan.connection_id = v_connection_id
     and scan.provider_thread_id = v_provider_thread_b
     and scan.message_id = v_provider_message_b
     and scan.status = 'pending'
     and scan.lease_owner is null
     and scan.lease_expires_at is null
   for update;
  if not found
    or v_scan_generation_b is distinct from v_prior_scan_generation_b + 1
  then
    raise exception 'attachment_requeue_failed' using errcode = '55000';
  end if;

  perform private.recompute_staff_false_lead_projection(
    p_company_id,
    v_source_id
  );
  perform private.recompute_staff_false_lead_projection(
    p_company_id,
    v_new_opportunity_id
  );
  perform private.recompute_staff_false_lead_projection(
    p_company_id,
    v_target_id
  );

  perform private.recompute_exact_message_lifecycle_projection(
    p_company_id,
    v_source_id,
    v_event_b_id
  );
  perform private.recompute_exact_message_lifecycle_projection(
    p_company_id,
    v_new_opportunity_id,
    v_event_a_id
  );
  perform private.recompute_exact_message_lifecycle_projection(
    p_company_id,
    v_target_id,
    v_event_b_id
  );

  select opportunity.*
    into v_target_after
    from public.opportunities opportunity
   where opportunity.id = v_target_id
     and opportunity.company_id = p_company_id
   for update;
  if v_target_after.stage is distinct from v_target.stage
    or v_target_after.stage_manually_set is distinct from
      v_target.stage_manually_set
    or v_target_after.assigned_to is distinct from v_target.assigned_to
    or v_target_after.assignment_version is distinct from
      v_target.assignment_version
    or v_target_after.project_id is distinct from v_target.project_id
    or v_target_after.project_ref is distinct from v_target.project_ref
    or v_target_after.updated_at is distinct from v_target.updated_at
  then
    raise exception 'protected_target_snapshot_changed'
      using errcode = '23514';
  end if;

  update public.ai_draft_history draft
     set status = 'discarded',
         discarded_at = v_now
   where draft.id = v_ai_draft_id
     and draft.opportunity_id = v_source_id
     and draft.status = 'auto_drafted'
     and draft.sent_at is null
     and draft.discarded_at is null;
  if not found then
    raise exception 'staff_false_lead_draft_race' using errcode = '40001';
  end if;

  update public.opportunities opportunity
     set stage = 'discarded',
         stage_manually_set = true,
         stage_entered_at = v_now,
         handled_at = v_now,
         archived_at = v_now,
         deleted_at = v_now,
         client_id = null,
         client_ref = null,
         win_probability = 0,
         next_follow_up_at = null,
         operator_action_required_at = null,
         ai_summary = 'Discarded after verified staff-alias correction. Customer correspondence was retained on the correct records.',
         ai_summary_updated_at = v_now,
         updated_at = v_now
   where opportunity.id = v_source_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.stage = v_source_stage;
  if not found then
    raise exception 'staff_false_lead_discard_race' using errcode = '40001';
  end if;

  insert into public.opportunity_dispositions (
    company_id,
    opportunity_id,
    disposition,
    reason_code,
    reason_notes,
    decided_via,
    decided_by,
    evidence
  ) values (
    p_company_id,
    v_source_id,
    'discarded',
    'internal',
    'Verified staff-authored correspondence was misclassified as a customer lead.',
    'operator_manual',
    p_actor_user_id,
    pg_catalog.jsonb_build_object(
      'policy_version',
      'staff_false_lead_correction_v1',
      'correction_key',
      p_correction_key,
      'manifest_sha256',
      p_manifest_sha256,
      'entry_a_sha256',
      p_entry_a_sha256,
      'entry_b_sha256',
      p_entry_b_sha256,
      'staff_user_id',
      v_staff_user_id,
      'staff_alias',
      v_staff_alias,
      'new_client_id',
      v_new_client_id,
      'new_opportunity_id',
      v_new_opportunity_id,
      'existing_target_opportunity_id',
      v_target_id,
      'provider_mutations_disabled',
      true
    )
  );

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
    v_source_id,
    v_source_stage,
    'discarded',
    v_now,
    p_actor_user_id,
    v_now - v_source.stage_entered_at
  );

  delete from public.opportunity_lifecycle_state state
   where state.company_id = p_company_id
     and state.opportunity_id = v_source_id;
  if not found then
    raise exception 'staff_false_lead_lifecycle_delete_race'
      using errcode = '40001';
  end if;

  for v_reference in
    select column_info.table_schema,
           column_info.table_name,
           column_info.column_name
      from information_schema.columns column_info
     where column_info.table_schema = 'public'
       and column_info.column_name in ('client_id', 'client_ref')
       and column_info.table_name <> 'clients'
     order by column_info.table_name, column_info.column_name
  loop
    execute pg_catalog.format(
      'select count(*) from %I.%I where %I::text = $1',
      v_reference.table_schema,
      v_reference.table_name,
      v_reference.column_name
    )
    into v_reference_count
    using v_source_client_id::text;
    v_total_client_reference_count :=
      v_total_client_reference_count + v_reference_count;
  end loop;
  select count(*)
    into v_reference_count
    from public.clients client
   where client.merged_into_client_id = v_source_client_id;
  v_total_client_reference_count :=
    v_total_client_reference_count + v_reference_count;

  if v_total_client_reference_count = 0 then
    update public.clients client
       set deleted_at = v_now,
           updated_at = v_now
     where client.id = v_source_client_id
       and client.company_id = p_company_id
       and client.deleted_at is null;
    if not found then
      raise exception 'staff_false_client_delete_race' using errcode = '40001';
    end if;
    v_source_client_deleted := true;
  else
    perform 1
      from public.clients client
     where client.id = v_source_client_id
       and client.company_id = p_company_id
       and client.deleted_at is null
     for update;
    if not found then
      raise exception 'staff_false_client_retention_race'
        using errcode = '40001';
    end if;
  end if;

  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = pg_catalog.txid_current()
     and token.backend_pid = pg_catalog.pg_backend_pid();

  v_result := pg_catalog.jsonb_build_object(
    'applied',
    true,
    'already_applied',
    false,
    'source_opportunity_id',
    v_source_id,
    'source_client_id',
    v_source_client_id,
    'source_client_deleted',
    v_source_client_deleted,
    'source_client_reference_count',
    v_total_client_reference_count,
    'new_client_id',
    v_new_client_id,
    'new_opportunity_id',
    v_new_opportunity_id,
    'existing_target_opportunity_id',
    v_target_id,
    'activity_a_id',
    v_activity_a_id,
    'activity_b_id',
    v_activity_b_id,
    'event_a_id',
    v_event_a_id,
    'event_b_id',
    v_event_b_id,
    'attachment_scan_generation',
    v_attachment_scan_generation,
    'message_b_scan_generation',
    v_scan_generation_b,
    'assignment_result',
    v_assignment_result,
    'provider_mutations_disabled',
    true
  );

  insert into public.lead_intake_correction_runs (
    company_id,
    correction_key,
    actor_user_id,
    source_opportunity_id,
    manifest_sha256,
    entry_a_sha256,
    entry_b_sha256,
    input_spec,
    result,
    applied_at
  ) values (
    p_company_id,
    p_correction_key,
    p_actor_user_id,
    v_source_id,
    p_manifest_sha256,
    p_entry_a_sha256,
    p_entry_b_sha256,
    p_spec,
    v_result,
    v_now
  );

  return v_result;
exception when others then
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_mode',
    coalesce(v_previous_mode, ''),
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_connection_id',
    coalesce(v_previous_connection, ''),
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_thread_id',
    coalesce(v_previous_thread, ''),
    true
  );
  perform pg_catalog.set_config(
    'ops.email_thread_reassignment_winner_id',
    coalesce(v_previous_winner, ''),
    true
  );
  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = pg_catalog.txid_current()
     and token.backend_pid = pg_catalog.pg_backend_pid();
  raise;
end;
$function$;

revoke all on function public.apply_staff_authored_false_lead_correction_guarded(
  uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_staff_authored_false_lead_correction_guarded(
  uuid, uuid, text, text, text, text, jsonb
) to service_role;

comment on function public.apply_staff_authored_false_lead_correction_guarded(
  uuid, uuid, text, text, text, text, jsonb
) is
  'Service-only, content-addressed correction for an exact staff-authored false lead. Verifies immutable mailbox evidence, creates the real property lead, moves correspondence as outbound, preserves protected terminal truth, resolves false alerts, and records an immutable receipt.';

commit;
