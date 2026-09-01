-- Delivery-source normalization re-projection (bug 8db73af6).
--
-- The evidence normalizer rejected 100% of real HTML mail, so the immutable
-- provider ledger stored `[CONTENT OMITTED: UNSAFE SOURCE]` in place of
-- correspondence the operator can read perfectly well in their own mailbox.
-- The normalizer was repaired in the same sweep; this file makes the ledger
-- able to accept the repaired reading of source bytes it already retains.
--
-- APPLY ORDER — this file is safe to apply BEFORE any code deploy, and MUST
-- be. It is purely additive:
--   * the `normalization_revision` CHECK is widened from the single v1
--     literal to {v1, v2}, so already-deployed code writing v1 stays valid
--     and nothing has to be re-deployed in lockstep;
--   * `capture_agent_provider_delivery_source_as_system` keeps every existing
--     rejection, and only stops treating a re-projection as a conflict.
-- Deploying the v2 constant BEFORE this migration is applied would fail every
-- capture on a check violation — a full evidence-capture outage. Apply first.
--
-- Changed lines in `capture_agent_provider_delivery_source_as_system`
-- (against 20260807224500_agent_provider_delivery_sources.sql:641-1554,
-- byte-identical everywhere else):
--   1. declare block  — added `v_projection_drift boolean := false;`
--   2. argument validation — the single-literal revision test
--        `p_normalization_revision is distinct from '…v1'`
--      became the null-safe two-literal test
--        `coalesce(p_normalization_revision, '') not in ('…v1', '…v2')`
--   3. idempotency branch head — the four projection comparisons
--      (normalized_subject, normalized_plain_text, normalization_revision,
--      normalization_status) were lifted out of the conflict test into
--      `v_projection_drift`
--   4. idempotency branch tail — the `source_sha256` comparison is now
--      evaluated only when the projection did not move, and a bounded UPDATE
--      writes the four projection columns when it did
-- Nothing else in the function changed: differing source bytes, subject,
-- identities, media type, charset, selection revision, part ids, attachment
-- descriptors or evidence ids all still raise
-- `agent_provider_delivery_source_idempotency_conflict`.
--
-- The capture-time `source_sha256` is deliberately NEVER rewritten. It is the
-- tenant hash key that `public.job_conversation_turns` references, so moving
-- it would break immutable conversation turns; it stays the digest of the
-- message as first captured.
--
-- No explicit BEGIN/COMMIT: the Supabase migration runner wraps each file in
-- one transaction, and `tests/sql/delivery-source-reprojection-contract.sql`
-- includes this file inside its own rolled-back transaction.

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'private.agent_provider_delivery_sources',
    'public.agent_control_plane_tenant_roots'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception
        'delivery_source_reprojection_prerequisite_missing: %',
        v_relation
        using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.reject_agent_job_memory_mutation()',
    'private.agent_provider_email_identity_is_valid(text)',
    'private.agent_provider_identity_array_is_canonical(text[],integer)',
    'extensions.digest(bytea,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception
        'delivery_source_reprojection_prerequisite_missing: %',
        v_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

-- ── 1. Widen the stored revision CHECK ────────────────────────────────────
-- The original constraint is an unnamed column CHECK, so its generated name is
-- not something to guess at. Find every CHECK on this table that mentions the
-- column (which includes this migration's own named constraint on a re-run),
-- drop it, and install the widened one under a stable name.
do $revision_check$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select constraint_definition.conname
      from pg_catalog.pg_constraint constraint_definition
     where constraint_definition.conrelid =
             'private.agent_provider_delivery_sources'::regclass
       and constraint_definition.contype = 'c'
       and pg_catalog.pg_get_constraintdef(constraint_definition.oid)
             like '%normalization_revision%'
  loop
    execute format(
      'alter table private.agent_provider_delivery_sources'
        || ' drop constraint %I',
      v_constraint_name
    );
  end loop;
end;
$revision_check$;

alter table private.agent_provider_delivery_sources
  add constraint agent_provider_delivery_sources_normalization_revision_check
  check (
    normalization_revision in (
      'ops.correspondence.normalized-text.v1',
      'ops.correspondence.normalized-text.v2'
    )
  );

-- ── 2. A table-scoped immutability guard ──────────────────────────────────
-- `private.reject_agent_job_memory_mutation()` guards six tables and stays
-- exactly as strict as it is today — it is not touched here. The delivery
-- ledger gets its own guard instead, identical in every respect but one: it
-- admits the transaction-local re-projection write, and only when every
-- column other than the derived text projection is byte-identical. The row
-- still cannot be edited by anything else: the table grants nothing to any
-- Supabase role and RLS is on, so only SECURITY DEFINER functions owned by
-- the table owner can reach it at all.
create or replace function private.reject_agent_provider_delivery_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_projection_keys text[] := array[
    'normalized_subject',
    'normalized_plain_text',
    'normalization_revision',
    'normalization_status'
  ];
begin
  if tg_op = 'DELETE' then
    -- Unchanged from the shared guard: the audited company-data purge is the
    -- only thing that may remove exact delivered evidence.
    if pg_catalog.current_setting(
         'ops.company_data_purge_company_id',
         true
       ) = old.company_id::text
       and coalesce(
         pg_catalog.current_setting('request.jwt.claims', true),
         ''
       ) = '' then
      return old;
    end if;

    raise exception 'agent_job_memory_record_is_immutable'
      using errcode = '55000';
  end if;

  -- Re-projection: the marker names the exact row, and the row's own bytes
  -- must be untouched. Any other UPDATE — including one that changes a single
  -- byte of `content_value` alongside the projection — falls through to the
  -- immutability failure below.
  if tg_op = 'UPDATE'
     and pg_catalog.current_setting(
       'ops.agent_provider_delivery_source_reprojection',
       true
     ) = old.id::text
     and pg_catalog.to_jsonb(new) - v_projection_keys
       = pg_catalog.to_jsonb(old) - v_projection_keys then
    return new;
  end if;

  raise exception 'agent_job_memory_record_is_immutable'
    using errcode = '55000';
end;
$function$;

revoke all on function private.reject_agent_provider_delivery_source_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists agent_provider_delivery_sources_immutable
  on private.agent_provider_delivery_sources;

create trigger agent_provider_delivery_sources_immutable
before update or delete on private.agent_provider_delivery_sources
for each row
execute function private.reject_agent_provider_delivery_source_mutation();

-- ── 3. Capture accepts a re-projection of bytes it already holds ──────────
create or replace function public.capture_agent_provider_delivery_source_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_direction text,
  p_delivered_at timestamptz,
  p_subject text,
  p_normalized_subject text,
  p_normalized_plain_text text,
  p_normalization_revision text,
  p_normalization_status text,
  p_sender_identity text,
  p_recipient_identities text[],
  p_cc_recipient_identities text[],
  p_content_media_type text,
  p_content_value text,
  p_content_charset text,
  p_content_source_kind text,
  p_content_selection_revision text,
  p_provider_part_id text,
  p_provider_body_attachment_id text,
  p_outbound_intent_kind text,
  p_outbound_intent_id uuid,
  p_attachment_enumeration_complete boolean,
  p_attachment_descriptors jsonb
) returns table (
  source_id uuid,
  source_sha256 text,
  inserted boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_approved_action_candidate_ids uuid[] := '{}'::uuid[];
  v_approved_action_intent public.approved_action_email_intents%rowtype;
  v_attachment public.email_attachments%rowtype;
  v_attachment_id uuid;
  v_attachment_evidence_ids text[] := '{}'::text[];
  v_attachment_provider_id text;
  v_canonical_descriptor jsonb;
  v_canonical_descriptors jsonb := '[]'::jsonb;
  v_content_id text;
  v_descriptor jsonb;
  v_descriptor_message_id text;
  v_existing_authority
    private.agent_provider_outbound_authority_attestations%rowtype;
  v_existing_source private.agent_provider_delivery_sources%rowtype;
  v_email_send_candidate_ids uuid[] := '{}'::uuid[];
  v_email_send_intent public.email_send_intents%rowtype;
  v_filename text;
  v_from_email text;
  v_is_inline boolean;
  v_mime_type text;
  v_occurred_at timestamptz;
  v_outbound_actor_user_id uuid;
  v_outbound_intent_id uuid := p_outbound_intent_id;
  v_outbound_intent_kind text := p_outbound_intent_kind;
  v_outbound_opportunity_id uuid;
  v_outbound_project_id uuid;
  v_previous_attachment_provider_id text;
  v_projection_drift boolean := false;
  v_provider_kind text;
  v_provider_part_id text;
  v_size_bytes bigint;
  v_source_envelope jsonb;
  v_source_id uuid;
  v_source_sha256 text;
  v_source_url text;
  v_inserted boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null
     or p_connection_id is null
     or p_provider not in ('gmail', 'microsoft365')
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or p_provider_message_id is distinct from btrim(p_provider_message_id)
     or octet_length(p_provider_message_id) > 512
     or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null
     or p_provider_thread_id is distinct from btrim(p_provider_thread_id)
     or octet_length(p_provider_thread_id) > 512
     or p_direction not in ('inbound', 'outbound')
     or p_delivered_at is null
     or p_subject is null
     or octet_length(p_subject) > 8192
     or octet_length(p_normalized_subject) > 8192
     or p_normalized_plain_text is null
     or octet_length(p_normalized_plain_text) > 8388608
     or coalesce(p_normalization_revision, '') not in (
       'ops.correspondence.normalized-text.v1',
       'ops.correspondence.normalized-text.v2'
     )
     or p_normalization_status not in ('normalized', 'rejected')
     or (
       p_normalization_status = 'rejected'
       and (
         p_normalized_subject
           is distinct from '[SUBJECT OMITTED: UNSAFE SOURCE]'
         or p_normalized_plain_text
           is distinct from '[CONTENT OMITTED: UNSAFE SOURCE]'
       )
     )
     or not private.agent_provider_email_identity_is_valid(
       p_sender_identity
     )
     or cardinality(p_recipient_identities) > 100
     or cardinality(p_cc_recipient_identities) > 100
     or not private.agent_provider_identity_array_is_canonical(
       p_recipient_identities,
       100
     )
     or not private.agent_provider_identity_array_is_canonical(
       p_cc_recipient_identities,
       100
     )
     or p_content_media_type not in ('text/plain', 'text/html')
     or p_content_value is null
     or octet_length(p_content_value) > 8388608
     or (
       p_content_charset is not null
       and (
         p_content_charset is distinct from lower(btrim(p_content_charset))
         or nullif(p_content_charset, '') is null
         or octet_length(p_content_charset) > 64
         or p_content_charset !~ '^[a-z0-9._:-]+$'
       )
     )
     or nullif(btrim(coalesce(p_content_selection_revision, '')), '') is null
     or p_content_selection_revision
       is distinct from btrim(p_content_selection_revision)
     or octet_length(p_content_selection_revision) > 256
     or (
       p_provider_part_id is not null
       and (
         p_provider_part_id is distinct from btrim(p_provider_part_id)
         or nullif(p_provider_part_id, '') is null
         or octet_length(p_provider_part_id) > 512
       )
     )
     or (
       p_provider_body_attachment_id is not null
       and (
         p_provider_body_attachment_id
           is distinct from btrim(p_provider_body_attachment_id)
         or nullif(p_provider_body_attachment_id, '') is null
         or octet_length(p_provider_body_attachment_id) > 512
       )
     )
     or p_attachment_enumeration_complete is distinct from true
     or p_attachment_descriptors is null
     or jsonb_typeof(p_attachment_descriptors) <> 'array'
     or jsonb_array_length(p_attachment_descriptors) > 100 then
    raise exception 'agent_provider_delivery_source_invalid'
      using errcode = '22023';
  end if;

  if (
    p_content_source_kind = 'gmail_mime_part'
    and (
      p_provider <> 'gmail'
      or p_content_selection_revision
        <> 'gmail.mime.text-plain-first.charset-decoded.v2'
      or p_content_charset is null
      or p_outbound_intent_kind is not null
      or p_outbound_intent_id is not null
    )
  ) or (
    p_content_source_kind = 'microsoft_graph_body'
    and (
      p_provider <> 'microsoft365'
      or p_content_selection_revision <> 'microsoft.graph.body.v1'
      or p_content_charset is not null
      or p_outbound_intent_kind is not null
      or p_outbound_intent_id is not null
    )
  ) or (
    p_content_source_kind = 'ops_rendered_outbound'
    and (
      p_direction <> 'outbound'
      or p_content_selection_revision
        <> 'ops.accepted-send.rendered-body.v1'
      or p_content_charset is not null
      or p_outbound_intent_kind not in (
        'email_send_intent',
        'approved_action_email_intent'
      )
      or p_outbound_intent_id is null
      or jsonb_array_length(p_attachment_descriptors) <> 0
    )
  ) or p_content_source_kind not in (
    'gmail_mime_part',
    'microsoft_graph_body',
    'ops_rendered_outbound'
  ) then
    raise exception 'agent_provider_delivery_source_content_invalid'
      using errcode = '22023';
  end if;

  perform 1
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.provider = p_provider
  for share;
  if not found then
    raise exception 'agent_provider_delivery_source_connection_invalid'
      using errcode = '23503';
  end if;

  insert into public.agent_control_plane_tenant_roots (company_id)
  values (p_company_id)
  on conflict (company_id) do nothing;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'agent-provider-delivery-source:v1:'
        || p_company_id::text || ':'
        || p_connection_id::text || ':'
        || p_provider_message_id,
      0
    )
  );

  if p_content_source_kind = 'ops_rendered_outbound' then
    if p_outbound_intent_kind = 'email_send_intent' then
      select intent.actor_user_id,
             intent.opportunity_id
      into v_outbound_actor_user_id,
           v_outbound_opportunity_id
      from public.email_send_intents intent
      where intent.id = p_outbound_intent_id
        and intent.company_id = p_company_id
        and intent.connection_id = p_connection_id
        and intent.status in (
          'provider_accepted',
          'reconciling',
          'reconciliation_failed',
          'reconciled'
        )
        and intent.provider_message_id = p_provider_message_id
        and intent.accepted_provider_thread_id = p_provider_thread_id
        and intent.provider_accepted_at = p_delivered_at
        and lower(btrim(intent.client_from_address_snapshot))
          = p_sender_identity
        and private.agent_provider_canonical_identities(intent.to_emails)
          = p_recipient_identities
        and private.agent_provider_canonical_identities(intent.cc_emails)
          = p_cc_recipient_identities
        and intent.subject = p_subject
        and intent.rendered_body = p_content_value
        and (
          (intent.content_type = 'text'
            and p_content_media_type = 'text/plain')
          or
          (intent.content_type = 'html'
            and p_content_media_type = 'text/html')
        )
        and intent.rendered_body_hash = encode(
          extensions.digest(
            convert_to(p_content_value, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      for share;
    elsif p_outbound_intent_kind = 'approved_action_email_intent' then
      select intent.actor_user_id,
             intent.opportunity_id,
             intent.project_id
      into v_outbound_actor_user_id,
           v_outbound_opportunity_id,
           v_outbound_project_id
      from public.approved_action_email_intents intent
      where intent.id = p_outbound_intent_id
        and intent.company_id = p_company_id
        and intent.connection_id = p_connection_id
        and intent.status in (
          'provider_accepted',
          'reconciling',
          'reconciliation_failed',
          'reconciled'
        )
        and intent.provider_message_id = p_provider_message_id
        and intent.accepted_provider_thread_id = p_provider_thread_id
        and intent.provider_accepted_at = p_delivered_at
        and lower(btrim(intent.client_from_address_snapshot))
          = p_sender_identity
        and private.agent_provider_canonical_identities(intent.to_emails)
          = p_recipient_identities
        and private.agent_provider_canonical_identities(intent.cc_emails)
          = p_cc_recipient_identities
        and intent.subject = p_subject
        and intent.rendered_body = p_content_value
        and (
          (intent.content_type = 'text'
            and p_content_media_type = 'text/plain')
          or
          (intent.content_type = 'html'
            and p_content_media_type = 'text/html')
        )
        and intent.rendered_body_hash = encode(
          extensions.digest(
            convert_to(p_content_value, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      for share;
    end if;

    if not found then
      raise exception 'agent_provider_delivery_outbound_intent_invalid'
        using errcode = '23503';
    end if;
  end if;

  -- Provider sync can observe the accepted message before the reconciliation
  -- worker reaches this RPC. Resolve exactly one already-accepted intent while
  -- holding the same delivery-key lock so native content cannot be materialized
  -- into an immutable ops:system turn before its actor/job authority exists.
  if p_direction = 'outbound'
     and p_content_source_kind in (
       'gmail_mime_part',
       'microsoft_graph_body'
     ) then
    select array(
      select intent.id
      from public.email_send_intents intent
      where intent.company_id = p_company_id
        and intent.connection_id = p_connection_id
        and intent.status in (
          'provider_accepted',
          'reconciling',
          'reconciliation_failed',
          'reconciled'
        )
        and intent.provider_message_id = p_provider_message_id
        and intent.accepted_provider_thread_id = p_provider_thread_id
      order by intent.id
      for share
    ) into v_email_send_candidate_ids;

    select array(
      select intent.id
      from public.approved_action_email_intents intent
      where intent.company_id = p_company_id
        and intent.connection_id = p_connection_id
        and intent.status in (
          'provider_accepted',
          'reconciling',
          'reconciliation_failed',
          'reconciled'
        )
        and intent.provider_message_id = p_provider_message_id
        and intent.accepted_provider_thread_id = p_provider_thread_id
      order by intent.id
      for share
    ) into v_approved_action_candidate_ids;

    if cardinality(v_email_send_candidate_ids)
         + cardinality(v_approved_action_candidate_ids) > 1 then
      raise exception 'agent_provider_delivery_outbound_intent_ambiguous'
        using errcode = '23505';
    elsif cardinality(v_email_send_candidate_ids) = 1 then
      select intent.*
      into v_email_send_intent
      from public.email_send_intents intent
      where intent.company_id = p_company_id
        and intent.id = v_email_send_candidate_ids[1]
      for share;

      if not found
         or lower(btrim(v_email_send_intent.client_from_address_snapshot))
           is distinct from p_sender_identity
         or private.agent_provider_canonical_identities(
           v_email_send_intent.to_emails
         ) is distinct from p_recipient_identities
         or private.agent_provider_canonical_identities(
           v_email_send_intent.cc_emails
         ) is distinct from p_cc_recipient_identities
         or v_email_send_intent.subject is distinct from p_subject
         or v_email_send_intent.rendered_body_hash is distinct from encode(
           extensions.digest(
             convert_to(v_email_send_intent.rendered_body, 'UTF8'),
             'sha256'
           ),
           'hex'
         ) then
        raise exception 'agent_provider_delivery_outbound_intent_invalid'
          using errcode = '23503';
      end if;

      v_outbound_intent_kind := 'email_send_intent';
      v_outbound_intent_id := v_email_send_intent.id;
      v_outbound_actor_user_id := v_email_send_intent.actor_user_id;
      v_outbound_opportunity_id := v_email_send_intent.opportunity_id;
      v_outbound_project_id := null;
    elsif cardinality(v_approved_action_candidate_ids) = 1 then
      select intent.*
      into v_approved_action_intent
      from public.approved_action_email_intents intent
      where intent.company_id = p_company_id
        and intent.id = v_approved_action_candidate_ids[1]
      for share;

      if not found
         or lower(btrim(
           v_approved_action_intent.client_from_address_snapshot
         )) is distinct from p_sender_identity
         or private.agent_provider_canonical_identities(
           v_approved_action_intent.to_emails
         ) is distinct from p_recipient_identities
         or private.agent_provider_canonical_identities(
           v_approved_action_intent.cc_emails
         ) is distinct from p_cc_recipient_identities
         or v_approved_action_intent.subject is distinct from p_subject
         or v_approved_action_intent.rendered_body is null
         or v_approved_action_intent.rendered_body_hash
           is distinct from encode(
             extensions.digest(
               convert_to(v_approved_action_intent.rendered_body, 'UTF8'),
               'sha256'
             ),
             'hex'
           ) then
        raise exception 'agent_provider_delivery_outbound_intent_invalid'
          using errcode = '23503';
      end if;

      v_outbound_intent_kind := 'approved_action_email_intent';
      v_outbound_intent_id := v_approved_action_intent.id;
      v_outbound_actor_user_id := v_approved_action_intent.actor_user_id;
      v_outbound_opportunity_id := v_approved_action_intent.opportunity_id;
      v_outbound_project_id := v_approved_action_intent.project_id;
    end if;
  end if;

  for v_descriptor in
    select descriptor.value
    from jsonb_array_elements(p_attachment_descriptors)
      with ordinality descriptor(value, position)
    order by descriptor.position
  loop
    if jsonb_typeof(v_descriptor) <> 'object'
       or not v_descriptor ?& array[
         'attachment_id',
         'filename',
         'mime_type',
         'size_bytes',
         'provider_kind',
         'provider_part_id',
         'content_id',
         'is_inline',
         'source_url',
         'occurred_at',
         'from_email'
       ]
       or v_descriptor - array[
         'attachment_id',
         'filename',
         'mime_type',
         'size_bytes',
         'provider_kind',
         'provider_part_id',
         'content_id',
         'is_inline',
         'source_url',
         'occurred_at',
         'from_email'
       ] <> '{}'::jsonb then
      raise exception 'agent_provider_delivery_attachment_descriptor_invalid'
        using errcode = '22023';
    end if;

    begin
      v_attachment_provider_id := v_descriptor ->> 'attachment_id';
      v_filename := v_descriptor ->> 'filename';
      v_mime_type := v_descriptor ->> 'mime_type';
      v_size_bytes := (v_descriptor ->> 'size_bytes')::bigint;
      v_provider_kind := v_descriptor ->> 'provider_kind';
      v_provider_part_id := v_descriptor ->> 'provider_part_id';
      v_content_id := v_descriptor ->> 'content_id';
      v_is_inline := (v_descriptor ->> 'is_inline')::boolean;
      v_source_url := v_descriptor ->> 'source_url';
      v_occurred_at := (v_descriptor ->> 'occurred_at')::timestamptz;
      v_from_email := v_descriptor ->> 'from_email';
      v_descriptor_message_id := p_provider_message_id;
    exception when others then
      raise exception 'agent_provider_delivery_attachment_descriptor_invalid'
        using errcode = '22023';
    end;

    if nullif(btrim(coalesce(v_attachment_provider_id, '')), '') is null
       or v_attachment_provider_id
         is distinct from btrim(v_attachment_provider_id)
       or octet_length(v_attachment_provider_id) > 512
       or (
         v_previous_attachment_provider_id is not null
         and (v_attachment_provider_id collate "C")
           <= (v_previous_attachment_provider_id collate "C")
       )
       or v_filename is null
       or octet_length(v_filename) > 4096
       or nullif(btrim(coalesce(v_mime_type, '')), '') is null
       or v_mime_type is distinct from lower(btrim(v_mime_type))
       or octet_length(v_mime_type) > 255
       or v_size_bytes is null
       or v_size_bytes < 0
       or v_provider_kind not in ('file', 'inline', 'item', 'reference')
       or (
         v_provider_part_id is not null
         and (
           nullif(btrim(v_provider_part_id), '') is null
           or v_provider_part_id is distinct from btrim(v_provider_part_id)
           or octet_length(v_provider_part_id) > 512
         )
       )
       or (
         v_content_id is not null
         and (
           nullif(btrim(v_content_id), '') is null
           or v_content_id is distinct from btrim(v_content_id)
           or octet_length(v_content_id) > 512
         )
       )
       or v_is_inline is null
       or (
         v_source_url is not null
         and (
           nullif(v_source_url, '') is null
           or octet_length(v_source_url) > 8192
         )
       )
       or v_occurred_at is distinct from p_delivered_at
       or v_descriptor_message_id is distinct from p_provider_message_id
       or not private.agent_provider_email_identity_is_valid(v_from_email)
       or v_from_email is distinct from p_sender_identity then
      raise exception 'agent_provider_delivery_attachment_descriptor_invalid'
        using errcode = '22023';
    end if;

    begin
      insert into public.email_attachments (
        company_id,
        connection_id,
        provider_thread_id,
        message_id,
        attachment_id,
        filename,
        mime_type,
        size_bytes,
        from_email,
        provider_kind,
        provider_part_id,
        content_id,
        is_inline,
        occurred_at,
        source_url,
        ingest_status,
        attribution_status,
        last_seen_at,
        updated_at
      ) values (
        p_company_id,
        p_connection_id,
        p_provider_thread_id,
        v_descriptor_message_id,
        v_attachment_provider_id,
        v_filename,
        v_mime_type,
        v_size_bytes,
        v_from_email,
        v_provider_kind,
        v_provider_part_id,
        v_content_id,
        v_is_inline,
        v_occurred_at,
        v_source_url,
        'discovered',
        'pending',
        clock_timestamp(),
        clock_timestamp()
      )
      on conflict (company_id, connection_id, message_id, attachment_id)
      do nothing;
    exception when unique_violation then
      raise exception
        'agent_provider_delivery_attachment_idempotency_conflict'
        using errcode = '23505';
    end;

    select attachment.*
    into v_attachment
    from public.email_attachments attachment
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.message_id = v_descriptor_message_id
      and attachment.attachment_id = v_attachment_provider_id
    for share;

    if not found
       or v_attachment.provider_thread_id
         is distinct from p_provider_thread_id
       or v_attachment.filename is distinct from v_filename
       or lower(v_attachment.mime_type) is distinct from v_mime_type
       or v_attachment.size_bytes is distinct from v_size_bytes
       or lower(btrim(v_attachment.from_email)) is distinct from v_from_email
       or v_attachment.provider_kind is distinct from v_provider_kind
       or v_attachment.provider_part_id is distinct from v_provider_part_id
       or v_attachment.content_id is distinct from v_content_id
       or v_attachment.is_inline is distinct from v_is_inline
       or v_attachment.occurred_at is distinct from v_occurred_at
       or v_attachment.source_url is distinct from v_source_url then
      raise exception
        'agent_provider_delivery_attachment_idempotency_conflict'
        using errcode = '23505';
    end if;

    v_attachment_id := v_attachment.id;
    v_attachment_evidence_ids := pg_catalog.array_append(
      v_attachment_evidence_ids,
      'email_attachment:' || v_attachment_id::text
    );
    if v_attachment_evidence_ids[cardinality(v_attachment_evidence_ids)]
       !~ '^email_attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'agent_provider_delivery_attachment_identity_invalid'
        using errcode = '22023';
    end if;

    v_canonical_descriptor := jsonb_build_object(
      'attachment_id', v_attachment_provider_id,
      'filename', v_filename,
      'mime_type', v_mime_type,
      'size_bytes', v_size_bytes,
      'provider_kind', v_provider_kind,
      'provider_part_id', v_provider_part_id,
      'content_id', v_content_id,
      'is_inline', v_is_inline,
      'source_url', v_source_url,
      'occurred_at', to_char(
        v_occurred_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'from_email', v_from_email
    );
    v_canonical_descriptors := v_canonical_descriptors
      || jsonb_build_array(v_canonical_descriptor);
    v_previous_attachment_provider_id := v_attachment_provider_id;
  end loop;

  select coalesce(
    array_agg(evidence_id order by evidence_id collate "C"),
    '{}'::text[]
  )
  into v_attachment_evidence_ids
  from unnest(v_attachment_evidence_ids) evidence(evidence_id);

  v_source_envelope := jsonb_build_object(
    'schema', 'ops.agent-provider-delivery-source.v1',
    'company_id', p_company_id,
    'connection_id', p_connection_id,
    'provider', p_provider,
    'provider_message_id', p_provider_message_id,
    'provider_thread_id', p_provider_thread_id,
    'direction', p_direction,
    'delivered_at', to_char(
      p_delivered_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'subject', p_subject,
    'normalized_subject', p_normalized_subject,
    'normalized_plain_text', p_normalized_plain_text,
    'normalization_revision', p_normalization_revision,
    'normalization_status', p_normalization_status,
    'sender_identity', p_sender_identity,
    'recipient_identities', to_jsonb(p_recipient_identities),
    'cc_recipient_identities', to_jsonb(p_cc_recipient_identities),
    'content_media_type', p_content_media_type,
    'content_value', p_content_value,
    'content_charset', p_content_charset,
    'content_source_kind', p_content_source_kind,
    'content_selection_revision', p_content_selection_revision,
    'provider_part_id', p_provider_part_id,
    'provider_body_attachment_id', p_provider_body_attachment_id,
    'attachment_enumeration_complete', true,
    'attachment_descriptors', v_canonical_descriptors,
    'attachment_evidence_ids', to_jsonb(v_attachment_evidence_ids)
  );
  v_source_sha256 := 'sha256:' || encode(
    extensions.digest(
      convert_to(v_source_envelope::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into private.agent_provider_delivery_sources (
    company_id,
    connection_id,
    provider,
    provider_message_id,
    provider_thread_id,
    direction,
    delivered_at,
    subject,
    normalized_subject,
    normalized_plain_text,
    normalization_revision,
    normalization_status,
    sender_identity,
    recipient_identities,
    cc_recipient_identities,
    content_media_type,
    content_value,
    content_charset,
    content_source_kind,
    content_selection_revision,
    provider_part_id,
    provider_body_attachment_id,
    attachment_enumeration_complete,
    attachment_descriptors,
    attachment_evidence_ids,
    source_sha256
  ) values (
    p_company_id,
    p_connection_id,
    p_provider,
    p_provider_message_id,
    p_provider_thread_id,
    p_direction,
    p_delivered_at,
    p_subject,
    p_normalized_subject,
    p_normalized_plain_text,
    p_normalization_revision,
    p_normalization_status,
    p_sender_identity,
    p_recipient_identities,
    p_cc_recipient_identities,
    p_content_media_type,
    p_content_value,
    p_content_charset,
    p_content_source_kind,
    p_content_selection_revision,
    p_provider_part_id,
    p_provider_body_attachment_id,
    true,
    v_canonical_descriptors,
    v_attachment_evidence_ids,
    v_source_sha256
  )
  on conflict (company_id, connection_id, provider_message_id)
  do nothing
  returning id into v_source_id;

  v_inserted := v_source_id is not null;
  if not v_inserted then
    select source.*
    into v_existing_source
    from private.agent_provider_delivery_sources source
    where source.company_id = p_company_id
      and source.connection_id = p_connection_id
      and source.provider_message_id = p_provider_message_id
    for share;

    if not found
       or v_existing_source.provider is distinct from p_provider
       or v_existing_source.provider_thread_id
         is distinct from p_provider_thread_id
       or v_existing_source.direction is distinct from p_direction then
      raise exception
        'agent_provider_delivery_source_idempotency_conflict'
        using errcode = '23505';
    end if;

    if v_existing_source.content_source_kind = p_content_source_kind then
      -- The derived text projection is a pure function of the retained
      -- source bytes and the normalizer revision. When every byte the
      -- ledger pins is identical and only that projection moved, this is
      -- the same delivered message read by a newer normalizer, not a
      -- competing capture (8db73af6).
      v_projection_drift :=
        v_existing_source.normalized_subject
          is distinct from p_normalized_subject
        or v_existing_source.normalized_plain_text
          is distinct from p_normalized_plain_text
        or v_existing_source.normalization_revision
          is distinct from p_normalization_revision
        or v_existing_source.normalization_status
          is distinct from p_normalization_status;

      if v_existing_source.delivered_at is distinct from p_delivered_at
         or v_existing_source.subject is distinct from p_subject
         or v_existing_source.sender_identity
           is distinct from p_sender_identity
         or v_existing_source.recipient_identities
           is distinct from p_recipient_identities
         or v_existing_source.cc_recipient_identities
           is distinct from p_cc_recipient_identities
         or v_existing_source.content_media_type
           is distinct from p_content_media_type
         or v_existing_source.content_value is distinct from p_content_value
         or v_existing_source.content_charset
           is distinct from p_content_charset
         or v_existing_source.content_selection_revision
           is distinct from p_content_selection_revision
         or v_existing_source.provider_part_id
           is distinct from p_provider_part_id
         or v_existing_source.provider_body_attachment_id
           is distinct from p_provider_body_attachment_id
         or v_existing_source.attachment_enumeration_complete
           is distinct from true
         or v_existing_source.attachment_descriptors
           is distinct from v_canonical_descriptors
         or v_existing_source.attachment_evidence_ids
           is distinct from v_attachment_evidence_ids
         or (
           -- The stored digest covers the projection, so it can only be
           -- compared byte-exactly while the projection stands still. The
           -- re-projection arm below deliberately leaves the digest at its
           -- capture-time value: it is the tenant hash key that immutable
           -- job conversation turns reference.
           not v_projection_drift
           and v_existing_source.source_sha256 is distinct from v_source_sha256
         ) then
        raise exception
          'agent_provider_delivery_source_idempotency_conflict'
          using errcode = '23505';
      end if;

      if v_projection_drift then
        perform pg_catalog.set_config(
          'ops.agent_provider_delivery_source_reprojection',
          v_existing_source.id::text,
          true
        );
        update private.agent_provider_delivery_sources as source
           set normalized_subject = p_normalized_subject,
               normalized_plain_text = p_normalized_plain_text,
               normalization_revision = p_normalization_revision,
               normalization_status = p_normalization_status
         where source.id = v_existing_source.id;
        perform pg_catalog.set_config(
          'ops.agent_provider_delivery_source_reprojection',
          '',
          true
        );
      end if;
    elsif not (
      p_direction = 'outbound'
      and (
        (
          v_existing_source.content_source_kind = 'ops_rendered_outbound'
          and p_content_source_kind in (
            'gmail_mime_part',
            'microsoft_graph_body'
          )
        )
        or
        (
          p_content_source_kind = 'ops_rendered_outbound'
          and v_existing_source.content_source_kind in (
            'gmail_mime_part',
            'microsoft_graph_body'
          )
        )
      )
    ) then
      raise exception
        'agent_provider_delivery_source_idempotency_conflict'
        using errcode = '23505';
    end if;

    v_source_id := v_existing_source.id;
    v_source_sha256 := v_existing_source.source_sha256;
  end if;

  if v_outbound_intent_kind is not null then
    begin
      insert into private.agent_provider_outbound_authority_attestations (
        company_id,
        provider_source_id,
        source_sha256,
        accepted_intent_kind,
        email_send_intent_id,
        approved_action_email_intent_id,
        actor_user_id,
        opportunity_id,
        project_id
      ) values (
        p_company_id,
        v_source_id,
        v_source_sha256,
        v_outbound_intent_kind,
        case
          when v_outbound_intent_kind = 'email_send_intent'
            then v_outbound_intent_id
          else null
        end,
        case
          when v_outbound_intent_kind = 'approved_action_email_intent'
            then v_outbound_intent_id
          else null
        end,
        v_outbound_actor_user_id,
        v_outbound_opportunity_id,
        v_outbound_project_id
      )
      on conflict (company_id, provider_source_id) do nothing;
    exception when unique_violation then
      raise exception
        'agent_provider_outbound_authority_idempotency_conflict'
        using errcode = '23505';
    end;

    select authority.*
    into v_existing_authority
    from private.agent_provider_outbound_authority_attestations authority
    where authority.company_id = p_company_id
      and authority.provider_source_id = v_source_id
    for share;

    if not found
       or v_existing_authority.source_sha256
         is distinct from v_source_sha256
       or v_existing_authority.accepted_intent_kind
         is distinct from v_outbound_intent_kind
       or v_existing_authority.accepted_intent_id
         is distinct from v_outbound_intent_id
       or v_existing_authority.actor_user_id
         is distinct from v_outbound_actor_user_id
       or v_existing_authority.opportunity_id
         is distinct from v_outbound_opportunity_id
       or v_existing_authority.project_id
         is distinct from v_outbound_project_id then
      raise exception
        'agent_provider_outbound_authority_idempotency_conflict'
        using errcode = '23505';
    end if;
  end if;

  return query select v_source_id, v_source_sha256, v_inserted;
end;
$function$;

revoke all on function public.capture_agent_provider_delivery_source_as_system(
  uuid, uuid, text, text, text, text, timestamptz, text, text, text, text, text,
  text,
  text[], text[], text, text, text, text, text, text, text, text, uuid,
  boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.capture_agent_provider_delivery_source_as_system(
  uuid, uuid, text, text, text, text, timestamptz, text, text, text, text, text,
  text,
  text[], text[], text, text, text, text, text, text, text, text, uuid,
  boolean, jsonb
) to service_role;

-- ── 4. Bounded backfill read ──────────────────────────────────────────────
-- `scripts/renormalize-delivery-sources.ts` re-reads retained source bytes and
-- re-projects them under the current normalizer. The table grants nothing to
-- any Supabase role, so the script needs a bounded service-role reader.
-- Keyset paginated newest-first: `p_before_delivered_at`/`p_before_id` carry
-- the last row of the previous page.
create or replace function public.list_agent_provider_delivery_sources_for_renormalization_as_system(
  p_limit integer,
  p_before_delivered_at timestamptz,
  p_before_id uuid
) returns table (
  source_id uuid,
  company_id uuid,
  connection_id uuid,
  provider text,
  provider_message_id text,
  delivered_at timestamptz,
  subject text,
  normalized_subject text,
  normalized_plain_text text,
  normalization_revision text,
  normalization_status text,
  content_media_type text,
  content_value text
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select source.id,
         source.company_id,
         source.connection_id,
         source.provider,
         source.provider_message_id,
         source.delivered_at,
         source.subject,
         source.normalized_subject,
         source.normalized_plain_text,
         source.normalization_revision,
         source.normalization_status,
         source.content_media_type,
         source.content_value
    from private.agent_provider_delivery_sources source
   where source.normalization_status = 'rejected'
     and (
       p_before_delivered_at is null
       or p_before_id is null
       or (source.delivered_at, source.id)
          < (p_before_delivered_at, p_before_id)
     )
   order by source.delivered_at desc, source.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$function$;

revoke all on function public.list_agent_provider_delivery_sources_for_renormalization_as_system(integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_agent_provider_delivery_sources_for_renormalization_as_system(integer, timestamptz, uuid) to service_role;

-- ── 5. Bounded backfill write ─────────────────────────────────────────────
-- The only other door to the re-projection UPDATE. It validates the incoming
-- projection with exactly the rules `capture_agent_provider_delivery_source_as_system`
-- applies, writes nothing else, and reports whether the row actually moved so
-- the script's counters cannot overstate what it did.
create or replace function public.reproject_agent_provider_delivery_source_as_system(
  p_company_id uuid,
  p_source_id uuid,
  p_normalized_subject text,
  p_normalized_plain_text text,
  p_normalization_revision text,
  p_normalization_status text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_existing_source private.agent_provider_delivery_sources%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null
     or p_source_id is null
     or octet_length(p_normalized_subject) > 8192
     or p_normalized_plain_text is null
     or octet_length(p_normalized_plain_text) > 8388608
     or coalesce(p_normalization_revision, '') not in (
       'ops.correspondence.normalized-text.v1',
       'ops.correspondence.normalized-text.v2'
     )
     or p_normalization_status not in ('normalized', 'rejected')
     or (
       p_normalization_status = 'rejected'
       and (
         p_normalized_subject
           is distinct from '[SUBJECT OMITTED: UNSAFE SOURCE]'
         or p_normalized_plain_text
           is distinct from '[CONTENT OMITTED: UNSAFE SOURCE]'
       )
     ) then
    raise exception 'agent_provider_delivery_source_reprojection_invalid'
      using errcode = '22023';
  end if;

  select source.*
    into v_existing_source
    from private.agent_provider_delivery_sources source
   where source.company_id = p_company_id
     and source.id = p_source_id
     for update;

  if not found then
    raise exception 'agent_provider_delivery_source_reprojection_unknown'
      using errcode = '22023';
  end if;

  if v_existing_source.normalized_subject
       is not distinct from p_normalized_subject
     and v_existing_source.normalized_plain_text
       is not distinct from p_normalized_plain_text
     and v_existing_source.normalization_revision
       is not distinct from p_normalization_revision
     and v_existing_source.normalization_status
       is not distinct from p_normalization_status then
    return false;
  end if;

  perform pg_catalog.set_config(
    'ops.agent_provider_delivery_source_reprojection',
    v_existing_source.id::text,
    true
  );
  update private.agent_provider_delivery_sources as source
     set normalized_subject = p_normalized_subject,
         normalized_plain_text = p_normalized_plain_text,
         normalization_revision = p_normalization_revision,
         normalization_status = p_normalization_status
   where source.id = v_existing_source.id;
  perform pg_catalog.set_config(
    'ops.agent_provider_delivery_source_reprojection',
    '',
    true
  );

  return true;
end;
$function$;

revoke all on function public.reproject_agent_provider_delivery_source_as_system(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.reproject_agent_provider_delivery_source_as_system(uuid, uuid, text, text, text, text) to service_role;
