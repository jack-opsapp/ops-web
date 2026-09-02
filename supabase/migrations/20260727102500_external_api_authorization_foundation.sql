begin;

-- Private, tenant-bound authorization and projection foundation for the
-- server-only external API. This migration creates no public HTTP route and
-- enables no company. The synthetic per-company `external_api` override is
-- fail-closed until an OPS administrator explicitly enables it.

create schema if not exists private;

do $prerequisites$
begin
  if to_regclass('public.companies') is null
    or to_regclass('public.users') is null
    or to_regclass('public.opportunities') is null
    or to_regclass('public.admin_feature_overrides') is null
    or to_regprocedure('public.has_permission(uuid,text,text)') is null
    or to_regprocedure('private.lock_lead_assignment_company(uuid)') is null
    or to_regprocedure(
      'private.company_mailbox_intake_owner_is_eligible(uuid,uuid)'
    ) is null
  then
    raise exception 'external_api_authorization_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create table private.external_api_principals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  credential_family_id uuid not null default gen_random_uuid(),
  principal_type text not null,
  credential_class text not null,
  scopes text[] not null,
  status text not null default 'active',
  authorization_epoch bigint not null default 1,
  granted_by_user_id uuid not null
    references public.users (id) on delete restrict,
  granted_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revoked_by_user_id uuid
    references public.users (id) on delete restrict,
  revocation_reason_code text,
  constraint external_api_principals_company_identity_key
    unique (id, company_id),
  constraint external_api_principals_credential_family_key
    unique (credential_family_id),
  constraint external_api_principals_type_check
    check (principal_type in ('server_key', 'oauth_installation')),
  constraint external_api_principals_class_check
    check (credential_class in ('intake', 'analytics', 'oauth')),
  constraint external_api_principals_scope_policy_check
    check (
      (
        principal_type = 'server_key'
        and
        credential_class = 'intake'
        and scopes = array['intake.write']::text[]
      )
      or
      (
        principal_type = 'server_key'
        and
        credential_class = 'analytics'
        and (
          scopes = array['analytics.leads.read']::text[]
          or scopes = array[
            'analytics.leads.read',
            'analytics.financial.read'
          ]::text[]
        )
        -- analytics.financial.read always requires analytics.leads.read.
        and (
          not (scopes @> array['analytics.financial.read']::text[])
          or scopes @> array['analytics.leads.read']::text[]
        )
      )
      or
      (
        principal_type = 'oauth_installation'
        and credential_class = 'oauth'
        and (
          scopes = array['intake.write']::text[]
          or scopes = array['analytics.leads.read']::text[]
          or scopes = array[
            'analytics.leads.read',
            'analytics.financial.read'
          ]::text[]
          or scopes = array[
            'intake.write',
            'analytics.leads.read'
          ]::text[]
          or scopes = array[
            'intake.write',
            'analytics.leads.read',
            'analytics.financial.read'
          ]::text[]
        )
        and (
          not (scopes @> array['analytics.financial.read']::text[])
          or scopes @> array['analytics.leads.read']::text[]
        )
      )
    ),
  constraint external_api_principals_status_check
    check (status in ('active', 'revoked')),
  constraint external_api_principals_epoch_check
    check (authorization_epoch > 0),
  constraint external_api_principals_revocation_check
    check (
      (
        status = 'active'
        and revoked_at is null
        and revoked_by_user_id is null
        and revocation_reason_code is null
      )
      or
      (
        status = 'revoked'
        and revoked_at is not null
        and revoked_by_user_id is not null
        and revocation_reason_code ~ '^[a-z][a-z0-9_]{0,63}$'
      )
    )
);

create index external_api_principals_company_status_idx
  on private.external_api_principals (company_id, status);

create table private.lead_intake_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  public_source_id uuid not null default gen_random_uuid(),
  integration_type text not null default 'custom_website',
  site_label text not null,
  canonical_host text not null,
  default_phone_region text not null,
  allowed_browser_origins text[] not null default '{}'::text[],
  default_coarse_source text not null default 'website',
  attribution_policy jsonb not null default '{}'::jsonb,
  default_intake_owner_id uuid
    references public.users (id) on delete set null,
  status text not null default 'active',
  created_by_user_id uuid not null
    references public.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint lead_intake_sources_company_identity_key
    unique (id, company_id),
  constraint lead_intake_sources_public_source_key
    unique (public_source_id),
  constraint lead_intake_sources_integration_type_check
    check (integration_type in ('custom_website', 'managed_plugin')),
  constraint lead_intake_sources_label_check
    check (
      char_length(btrim(site_label)) between 1 and 120
      and site_label !~ '[[:cntrl:]]'
    ),
  constraint lead_intake_sources_host_check
    check (
      canonical_host = lower(btrim(canonical_host))
      and char_length(canonical_host) between 1 and 253
      and canonical_host ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
      and canonical_host !~ '\.\.'
      and canonical_host !~ '[:/?#@]'
    ),
  constraint lead_intake_sources_phone_region_check
    check (default_phone_region ~ '^[A-Z]{2}$'),
  constraint lead_intake_sources_origin_count_check
    check (
      cardinality(allowed_browser_origins) <= 20
      and array_position(allowed_browser_origins, null) is null
    ),
  constraint lead_intake_sources_coarse_source_check
    check (
      default_coarse_source in (
        'referral',
        'website',
        'email',
        'phone',
        'walk_in',
        'social_media',
        'repeat_client',
        'other'
      )
    ),
  constraint lead_intake_sources_attribution_policy_check
    check (
      jsonb_typeof(attribution_policy) = 'object'
      and octet_length(attribution_policy::text) <= 8192
    ),
  constraint lead_intake_sources_status_check
    check (status in ('active', 'revoked')),
  constraint lead_intake_sources_revocation_check
    check (
      (status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null)
    )
);

create index lead_intake_sources_company_status_idx
  on private.lead_intake_sources (company_id, status, public_source_id);

create index lead_intake_sources_default_owner_idx
  on private.lead_intake_sources (default_intake_owner_id)
  where default_intake_owner_id is not null;

create table private.lead_intake_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  source_id uuid not null,
  public_form_id uuid not null default gen_random_uuid(),
  form_key text not null,
  label text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint lead_intake_forms_company_identity_key
    unique (id, company_id),
  constraint lead_intake_forms_public_form_key
    unique (public_form_id),
  constraint lead_intake_forms_source_key
    unique (source_id, form_key),
  constraint lead_intake_forms_source_company_fkey
    foreign key (source_id, company_id)
    references private.lead_intake_sources (id, company_id)
    on delete cascade,
  constraint lead_intake_forms_key_check
    check (form_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint lead_intake_forms_label_check
    check (
      char_length(btrim(label)) between 1 and 120
      and label !~ '[[:cntrl:]]'
    ),
  constraint lead_intake_forms_default_key_check
    check (
      (is_default and form_key = 'default')
      or (not is_default and form_key <> 'default')
    )
);

create unique index lead_intake_forms_one_default_idx
  on private.lead_intake_forms (source_id)
  where is_default;

create index lead_intake_forms_company_source_idx
  on private.lead_intake_forms (company_id, source_id, is_active);

create table private.external_api_principal_sources (
  principal_id uuid not null,
  company_id uuid not null,
  source_id uuid not null,
  granted_at timestamptz not null default clock_timestamp(),
  primary key (principal_id, source_id),
  constraint external_api_principal_sources_principal_company_fkey
    foreign key (principal_id, company_id)
    references private.external_api_principals (id, company_id)
    on delete cascade,
  constraint external_api_principal_sources_source_company_fkey
    foreign key (source_id, company_id)
    references private.lead_intake_sources (id, company_id)
    on delete restrict
);

create index external_api_principal_sources_company_source_idx
  on private.external_api_principal_sources (company_id, source_id);

create table private.external_api_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  principal_id uuid not null,
  name text not null,
  digest_version smallint not null,
  secret_digest bytea not null,
  visible_prefix text not null,
  issued_authorization_epoch bigint not null,
  status text not null default 'active',
  expires_at timestamptz,
  overlap_started_at timestamptz,
  overlap_until timestamptz,
  rotated_from_credential_id uuid
    references private.external_api_credentials (id) on delete restrict,
  created_by_user_id uuid not null
    references public.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  last_rejected_at timestamptz,
  rejection_count bigint not null default 0,
  retired_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid
    references public.users (id) on delete restrict,
  revocation_reason_code text,
  constraint external_api_credentials_company_identity_key
    unique (id, company_id),
  constraint external_api_credentials_principal_company_fkey
    foreign key (principal_id, company_id)
    references private.external_api_principals (id, company_id)
    on delete restrict,
  constraint external_api_credentials_digest_key
    unique (digest_version, secret_digest),
  constraint external_api_credentials_prefix_key
    unique (digest_version, visible_prefix),
  constraint external_api_credentials_name_check
    check (
      char_length(btrim(name)) between 1 and 120
      and name !~ '[[:cntrl:]]'
    ),
  constraint external_api_credentials_digest_version_check
    check (digest_version > 0),
  constraint external_api_credentials_digest_length_check
    check (octet_length(secret_digest) = 32),
  constraint external_api_credentials_prefix_check
    check (
      char_length(visible_prefix) between 8 and 32
      and visible_prefix ~ '^[A-Za-z0-9_-]+$'
    ),
  constraint external_api_credentials_epoch_check
    check (issued_authorization_epoch > 0),
  constraint external_api_credentials_status_check
    check (status in ('active', 'overlap', 'retired', 'revoked')),
  constraint external_api_credentials_expiry_check
    check (expires_at is null or expires_at > created_at),
  constraint external_api_credentials_overlap_check
    check (
      (
        status = 'overlap'
        and overlap_started_at is not null
        and overlap_until is not null
        and overlap_until > overlap_started_at
        and overlap_until <= overlap_started_at + interval '24 hours'
      )
      or
      (
        status <> 'overlap'
        and overlap_started_at is null
        and overlap_until is null
      )
    ),
  constraint external_api_credentials_retirement_check
    check (
      (status = 'retired' and retired_at is not null)
      or (status <> 'retired' and retired_at is null)
    ),
  constraint external_api_credentials_revocation_check
    check (
      (
        status = 'revoked'
        and revoked_at is not null
        and revoked_by_user_id is not null
        and revocation_reason_code ~ '^[a-z][a-z0-9_]{0,63}$'
      )
      or
      (
        status <> 'revoked'
        and revoked_at is null
        and revoked_by_user_id is null
        and revocation_reason_code is null
      )
    ),
  constraint external_api_credentials_rejection_count_check
    check (rejection_count >= 0)
);

create unique index external_api_credentials_one_active_idx
  on private.external_api_credentials (principal_id)
  where status = 'active';

create index external_api_credentials_principal_status_idx
  on private.external_api_credentials (principal_id, status, created_at desc);

create index external_api_credentials_expiry_idx
  on private.external_api_credentials (expires_at)
  where expires_at is not null and status in ('active', 'overlap');

create index external_api_credentials_overlap_expiry_idx
  on private.external_api_credentials (overlap_until)
  where status = 'overlap';

create table private.external_api_request_audit (
  request_id uuid primary key,
  company_id uuid
    references public.companies (id) on delete restrict,
  principal_id uuid,
  credential_id uuid,
  route text not null,
  method text not null,
  request_received_at timestamptz not null,
  base_recorded_at timestamptz not null default clock_timestamp(),
  outcome text not null,
  error_code text,
  finalized_at timestamptz,
  response_class smallint,
  duration_ms integer,
  rate_limit_result text,
  idempotency_result text,
  cache_result text,
  metric_set text[],
  grouping text[],
  result_size bigint,
  constraint external_api_request_audit_principal_company_fkey
    foreign key (principal_id, company_id)
    references private.external_api_principals (id, company_id)
    on delete restrict,
  constraint external_api_request_audit_credential_company_fkey
    foreign key (credential_id, company_id)
    references private.external_api_credentials (id, company_id)
    on delete restrict,
  constraint external_api_request_audit_identity_check
    check (
      (
        company_id is null
        and principal_id is null
        and credential_id is null
      )
      or
      (
        company_id is not null
        and principal_id is not null
        and credential_id is not null
      )
    ),
  constraint external_api_request_audit_route_check
    check (
      route ~ '^/v1/[A-Za-z0-9_./{}-]{1,180}$'
      and route !~ '[?#]'
    ),
  constraint external_api_request_audit_method_check
    check (method in ('GET', 'POST', 'PATCH', 'DELETE', 'HEAD')),
  constraint external_api_request_audit_outcome_check
    check (
      outcome in (
        'authenticated',
        'accepted',
        'rejected',
        'not_found',
        'conflict',
        'rate_limited',
        'unavailable',
        'error'
      )
    ),
  constraint external_api_request_audit_error_code_check
    check (
      error_code is null
      or error_code ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  constraint external_api_request_audit_response_class_check
    check (response_class is null or response_class between 2 and 5),
  constraint external_api_request_audit_duration_check
    check (duration_ms is null or duration_ms between 0 and 3600000),
  constraint external_api_request_audit_rate_limit_check
    check (
      rate_limit_result is null
      or rate_limit_result in (
        'allowed',
        'denied',
        'unavailable',
        'not_applicable'
      )
    ),
  constraint external_api_request_audit_idempotency_check
    check (
      idempotency_result is null
      or idempotency_result in (
        'new',
        'replay',
        'conflict',
        'expired',
        'not_applicable'
      )
    ),
  constraint external_api_request_audit_cache_check
    check (
      cache_result is null
      or cache_result in (
        'hit',
        'miss',
        'bypass',
        'not_applicable'
      )
    ),
  constraint external_api_request_audit_metric_count_check
    check (metric_set is null or cardinality(metric_set) <= 32),
  constraint external_api_request_audit_grouping_count_check
    check (grouping is null or cardinality(grouping) <= 8),
  constraint external_api_request_audit_result_size_check
    check (result_size is null or result_size >= 0),
  constraint external_api_request_audit_finalization_check
    check (
      (
        finalized_at is null
        and response_class is null
        and duration_ms is null
      )
      or
      (
        finalized_at is not null
        and response_class is not null
        and duration_ms is not null
      )
    )
);

create index external_api_request_audit_company_time_idx
  on private.external_api_request_audit (
    company_id,
    request_received_at desc
  )
  where company_id is not null;

create index external_api_request_audit_principal_time_idx
  on private.external_api_request_audit (
    principal_id,
    request_received_at desc
  )
  where principal_id is not null;

create index external_api_request_audit_credential_time_idx
  on private.external_api_request_audit (
    credential_id,
    request_received_at desc
  )
  where credential_id is not null;

create or replace function private.guard_external_api_request_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'external_api_request_audit_delete_denied'
      using errcode = '42501';
  end if;

  if old.finalized_at is not null
    or new.finalized_at is null
    or row(
      new.request_id,
      new.company_id,
      new.principal_id,
      new.credential_id,
      new.route,
      new.method,
      new.request_received_at,
      new.base_recorded_at
    ) is distinct from row(
      old.request_id,
      old.company_id,
      old.principal_id,
      old.credential_id,
      old.route,
      old.method,
      old.request_received_at,
      old.base_recorded_at
    )
  then
    raise exception 'external_api_request_audit_mutation_denied'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

create trigger external_api_request_audit_finalize_once
before update or delete on private.external_api_request_audit
for each row
execute function private.guard_external_api_request_audit_mutation();

create table private.external_api_network_fingerprints (
  request_id uuid primary key
    references private.external_api_request_audit (request_id)
    on delete cascade,
  fingerprint_version smallint not null,
  fingerprint_digest bytea not null,
  presented_prefix text,
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null
    default (now() + interval '30 days'),
  constraint external_api_network_fingerprints_version_check
    check (fingerprint_version > 0),
  constraint external_api_network_fingerprints_digest_check
    check (octet_length(fingerprint_digest) = 32),
  constraint external_api_network_fingerprints_prefix_check
    check (
      presented_prefix is null
      or (
        char_length(presented_prefix) between 1 and 32
        and presented_prefix ~ '^[A-Za-z0-9_-]+$'
      )
    ),
  constraint external_api_network_fingerprints_retention_check
    check (
      expires_at > captured_at
      and expires_at <= captured_at + interval '30 days'
    )
);

create index external_api_network_fingerprints_expiry_idx
  on private.external_api_network_fingerprints (expires_at);

create table private.external_api_security_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid
    references public.companies (id) on delete restrict,
  principal_id uuid,
  credential_id uuid,
  related_credential_id uuid,
  request_id uuid,
  actor_user_id uuid
    references public.users (id) on delete restrict,
  event_type text not null,
  reason_code text,
  authorization_epoch bigint,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint external_api_security_events_principal_company_fkey
    foreign key (principal_id, company_id)
    references private.external_api_principals (id, company_id)
    on delete restrict,
  constraint external_api_security_events_credential_fkey
    foreign key (credential_id)
    references private.external_api_credentials (id)
    on delete restrict,
  constraint external_api_security_events_related_credential_fkey
    foreign key (related_credential_id)
    references private.external_api_credentials (id)
    on delete restrict,
  constraint external_api_security_events_request_fkey
    foreign key (request_id)
    references private.external_api_request_audit (request_id)
    on delete set null,
  constraint external_api_security_events_type_check
    check (
      event_type in (
        'principal_created',
        'credential_created',
        'credential_updated',
        'credential_rotated',
        'credential_revoked',
        'credential_rejected',
        'source_created',
        'source_updated',
        'scope_denied',
        'cross_tenant_denied'
      )
    ),
  constraint external_api_security_events_reason_check
    check (
      reason_code is null
      or reason_code ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  constraint external_api_security_events_epoch_check
    check (authorization_epoch is null or authorization_epoch > 0)
);

create index external_api_security_events_company_time_idx
  on private.external_api_security_events (company_id, occurred_at desc);

create index external_api_security_events_principal_time_idx
  on private.external_api_security_events (principal_id, occurred_at desc)
  where principal_id is not null;

create index external_api_security_events_credential_rejection_time_idx
  on private.external_api_security_events (credential_id, occurred_at desc)
  where credential_id is not null
    and event_type = 'credential_rejected';

create or replace function private.reject_external_api_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  raise exception 'external_api_security_events_append_only'
    using errcode = '42501';
end;
$function$;

create trigger external_api_security_events_append_only
before update or delete on private.external_api_security_events
for each row
execute function private.reject_external_api_audit_mutation();

create table private.external_lead_handles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  opportunity_id uuid not null
    references public.opportunities (id) on delete restrict,
  public_lead_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  constraint external_lead_handles_company_identity_key
    unique (id, company_id),
  constraint external_lead_handles_company_opportunity_key
    unique (company_id, opportunity_id),
  constraint external_lead_handles_public_lead_key
    unique (public_lead_id)
);

create index external_lead_handles_opportunity_idx
  on private.external_lead_handles (opportunity_id);

create index external_lead_handles_company_public_idx
  on private.external_lead_handles (company_id, public_lead_id);

create table private.external_attribution_dictionary (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  source_id uuid,
  dimension text not null,
  public_attribution_id uuid not null default gen_random_uuid(),
  approved_label text,
  label_approved boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_attribution_dictionary_company_identity_key
    unique (id, company_id),
  constraint external_attribution_dictionary_public_key
    unique (public_attribution_id),
  constraint external_attribution_dictionary_source_company_fkey
    foreign key (source_id, company_id)
    references private.lead_intake_sources (id, company_id)
    on delete restrict,
  constraint external_attribution_dictionary_dimension_check
    check (
      dimension in (
        'campaign',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'landing_path',
        'referrer_path'
      )
    ),
  constraint external_attribution_dictionary_label_check
    check (
      (
        not label_approved
        and approved_label is null
      )
      or
      (
        label_approved
        and char_length(btrim(approved_label)) between 1 and 120
        and approved_label !~ '[[:cntrl:]]'
      )
    )
);

create index external_attribution_dictionary_source_dimension_idx
  on private.external_attribution_dictionary (
    company_id,
    source_id,
    dimension
  );

create table private.external_attribution_lookup_digests (
  dictionary_id uuid not null,
  company_id uuid not null,
  lookup_key_version smallint not null,
  lookup_digest bytea not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (dictionary_id, lookup_key_version),
  constraint external_attribution_lookup_dictionary_company_fkey
    foreign key (dictionary_id, company_id)
    references private.external_attribution_dictionary (id, company_id)
    on delete cascade,
  constraint external_attribution_lookup_version_check
    check (lookup_key_version > 0),
  constraint external_attribution_lookup_digest_check
    check (octet_length(lookup_digest) = 32),
  constraint external_attribution_lookup_digest_key
    unique (company_id, lookup_key_version, lookup_digest)
);

create table private.external_lead_source_projections (
  company_id uuid not null,
  handle_id uuid not null,
  opportunity_id uuid not null,
  projection_schema_version smallint not null,
  normalized_source_projection jsonb not null,
  source_record_updated_at timestamptz not null,
  projected_at timestamptz not null default clock_timestamp(),
  primary key (company_id, handle_id),
  constraint external_lead_source_projections_handle_company_fkey
    foreign key (handle_id, company_id)
    references private.external_lead_handles (id, company_id)
    on delete restrict,
  constraint external_lead_source_projections_opportunity_fkey
    foreign key (opportunity_id)
    references public.opportunities (id)
    on delete restrict,
  constraint external_lead_source_projections_version_check
    check (projection_schema_version > 0),
  constraint external_lead_source_projections_payload_check
    check (
      jsonb_typeof(normalized_source_projection) = 'object'
      and octet_length(normalized_source_projection::text) <= 65536
    )
);

create unique index external_lead_source_projections_company_opportunity_idx
  on private.external_lead_source_projections (company_id, opportunity_id);

create table private.external_lead_projection_state (
  company_id uuid primary key
    references public.companies (id) on delete restrict,
  high_water_sequence bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_lead_projection_state_sequence_check
    check (high_water_sequence >= 0)
);

create table private.external_lead_projection_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  handle_id uuid not null,
  public_lead_id uuid not null,
  change_sequence bigint not null,
  projection_schema_version smallint not null,
  operation text not null,
  public_projection jsonb not null,
  source_record_updated_at timestamptz not null,
  projected_at timestamptz not null default clock_timestamp(),
  constraint external_lead_projection_versions_company_identity_key
    unique (id, company_id),
  constraint external_lead_projection_versions_company_sequence_key
    unique (company_id, change_sequence),
  constraint external_lead_projection_versions_handle_company_fkey
    foreign key (handle_id, company_id)
    references private.external_lead_handles (id, company_id)
    on delete restrict,
  constraint external_lead_projection_versions_sequence_check
    check (change_sequence > 0),
  constraint external_lead_projection_versions_version_check
    check (projection_schema_version > 0),
  constraint external_lead_projection_versions_operation_check
    check (operation in ('upsert', 'merge', 'deletion')),
  constraint external_lead_projection_versions_payload_check
    check (
      jsonb_typeof(public_projection) = 'object'
      and octet_length(public_projection::text) <= 131072
    )
);

create index external_lead_projection_versions_handle_sequence_idx
  on private.external_lead_projection_versions (
    company_id,
    handle_id,
    change_sequence desc
  );

create index external_lead_projection_versions_projected_at_idx
  on private.external_lead_projection_versions (company_id, projected_at);

create table private.external_lead_projection_baselines (
  company_id uuid not null,
  handle_id uuid not null,
  version_id uuid not null,
  public_lead_id uuid not null,
  latest_sequence bigint not null,
  projection_schema_version smallint not null,
  operation text not null,
  public_projection jsonb not null,
  source_record_updated_at timestamptz not null,
  projected_at timestamptz not null,
  primary key (company_id, handle_id),
  constraint external_lead_projection_baselines_handle_company_fkey
    foreign key (handle_id, company_id)
    references private.external_lead_handles (id, company_id)
    on delete restrict,
  constraint external_lead_projection_baselines_version_company_fkey
    foreign key (version_id, company_id)
    references private.external_lead_projection_versions (id, company_id)
    on delete restrict,
  constraint external_lead_projection_baselines_sequence_check
    check (latest_sequence > 0),
  constraint external_lead_projection_baselines_version_check
    check (projection_schema_version > 0),
  constraint external_lead_projection_baselines_operation_check
    check (operation in ('upsert', 'merge', 'deletion')),
  constraint external_lead_projection_baselines_payload_check
    check (
      jsonb_typeof(public_projection) = 'object'
      and octet_length(public_projection::text) <= 131072
    )
);

create index external_lead_projection_baselines_public_idx
  on private.external_lead_projection_baselines (
    company_id,
    public_lead_id
  );

create or replace function private.reject_external_lead_projection_version_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  raise exception 'external_lead_projection_versions_append_only'
    using errcode = '42501';
end;
$function$;

create trigger external_lead_projection_versions_append_only
before update or delete on private.external_lead_projection_versions
for each row
execute function private.reject_external_lead_projection_version_mutation();

-- Authorization helpers -----------------------------------------------------

create or replace function private.require_external_api_service_role()
returns void
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
end;
$function$;

create or replace function private.lock_external_api_company_shared(
  p_company_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if p_company_id is null then
    raise exception 'external_api_company_lock_required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended(
      'external-api-company:' || p_company_id::text,
      250300
    )
  );
end;
$function$;

create or replace function private.lock_external_api_company_exclusive(
  p_company_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if p_company_id is null then
    raise exception 'external_api_company_lock_required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'external-api-company:' || p_company_id::text,
      250300
    )
  );
end;
$function$;

create or replace function private.lock_external_api_feature_override_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.feature_key = 'external_api' then
      perform private.lock_external_api_company_exclusive(
        new.company_id::text::uuid
      );
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.feature_key = 'external_api' then
      perform private.lock_external_api_company_exclusive(
        old.company_id::text::uuid
      );
    end if;
    return old;
  end if;

  if old.feature_key = 'external_api' then
    v_old_company_id := old.company_id::text::uuid;
  end if;
  if new.feature_key = 'external_api' then
    v_new_company_id := new.company_id::text::uuid;
  end if;

  -- A feature row can change company or feature key. Lock both affected
  -- companies in UUID order so two cross-company updates cannot deadlock.
  if v_old_company_id is not null
    and v_new_company_id is not null
    and v_old_company_id is distinct from v_new_company_id
  then
    if v_old_company_id < v_new_company_id then
      perform private.lock_external_api_company_exclusive(v_old_company_id);
      perform private.lock_external_api_company_exclusive(v_new_company_id);
    else
      perform private.lock_external_api_company_exclusive(v_new_company_id);
      perform private.lock_external_api_company_exclusive(v_old_company_id);
    end if;
  elsif v_old_company_id is not null then
    perform private.lock_external_api_company_exclusive(v_old_company_id);
  elsif v_new_company_id is not null then
    perform private.lock_external_api_company_exclusive(v_new_company_id);
  end if;

  return new;
end;
$function$;

create trigger admin_feature_overrides_external_api_lock
before insert or update or delete on public.admin_feature_overrides
for each row
execute function private.lock_external_api_feature_override_mutation();

create or replace function private.external_api_company_feature_enabled(
  p_company_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.admin_feature_overrides feature
    where feature.company_id::text = p_company_id::text
      and feature.feature_key = 'external_api'
      and coalesce(feature.enabled, false)
  );
$function$;

create or replace function private.require_external_api_management_actor(
  p_actor_user_id uuid,
  p_mutates_configuration boolean
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_tentative_company_id uuid;
  v_company_id uuid;
  v_feature_enabled boolean;
begin
  perform private.require_external_api_service_role();

  if p_actor_user_id is null or p_mutates_configuration is null then
    raise exception 'external_api_actor_required'
      using errcode = '22023';
  end if;

  select actor.company_id
  into v_tentative_company_id
  from public.users actor
  where actor.id = p_actor_user_id;

  if not found or v_tentative_company_id is null then
    raise exception 'external_api_actor_ineligible'
      using errcode = '42501';
  end if;

  -- Permission mutation wrappers use this same company lock. Once acquired,
  -- re-read every actor fact so a revocation that won the lock is observed.
  perform private.lock_lead_assignment_company(v_tentative_company_id);
  if p_mutates_configuration then
    perform private.lock_external_api_company_exclusive(
      v_tentative_company_id
    );
  else
    perform private.lock_external_api_company_shared(
      v_tentative_company_id
    );
  end if;

  select actor.company_id
  into v_company_id
  from public.users actor
  where actor.id = p_actor_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
  for share;

  if not found
    or v_company_id is null
    or v_company_id is distinct from v_tentative_company_id
  then
    raise exception 'external_api_actor_ineligible'
      using errcode = '42501';
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'settings.integrations',
    'all'
  ) then
    raise exception 'external_api_management_access_denied'
      using errcode = '42501';
  end if;

  v_feature_enabled :=
    private.external_api_company_feature_enabled(v_company_id);

  if not v_feature_enabled then
    raise exception 'external_api_feature_enabled_required'
      using errcode = '42501';
  end if;

  return v_company_id;
end;
$function$;

create or replace function private.append_external_api_security_event(
  p_company_id uuid,
  p_event_type text,
  p_principal_id uuid default null,
  p_credential_id uuid default null,
  p_related_credential_id uuid default null,
  p_request_id uuid default null,
  p_actor_user_id uuid default null,
  p_reason_code text default null,
  p_authorization_epoch bigint default null
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event_id uuid;
begin
  insert into private.external_api_security_events (
    company_id,
    principal_id,
    credential_id,
    related_credential_id,
    request_id,
    actor_user_id,
    event_type,
    reason_code,
    authorization_epoch
  ) values (
    p_company_id,
    p_principal_id,
    p_credential_id,
    p_related_credential_id,
    p_request_id,
    p_actor_user_id,
    p_event_type,
    p_reason_code,
    p_authorization_epoch
  )
  returning id into v_event_id;

  return v_event_id;
end;
$function$;

create or replace function private.external_api_origins_are_valid(
  p_origins text[]
) returns boolean
language plpgsql
immutable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_origin text;
begin
  if p_origins is null
    or cardinality(p_origins) > 20
    or array_position(p_origins, null) is not null
  then
    return false;
  end if;

  foreach v_origin in array p_origins
  loop
    if v_origin <> btrim(v_origin)
      or char_length(v_origin) > 253
      or (
        v_origin !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]{0,240}[A-Za-z0-9])?(?::[0-9]{1,5})?$'
        and v_origin !~ '^http://(?:localhost|127[.]0[.]0[.]1)(?::[0-9]{1,5})?$'
      )
    then
      return false;
    end if;
  end loop;

  if cardinality(p_origins) <> (
    select count(distinct origin)
    from unnest(p_origins) origin
  ) then
    return false;
  end if;

  return true;
end;
$function$;

create or replace function private.guard_lead_intake_source_owner()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if not private.external_api_origins_are_valid(
    new.allowed_browser_origins
  ) then
    raise exception 'lead_intake_source_origins_invalid'
      using errcode = '22023';
  end if;

  if new.default_intake_owner_id is not null
    and not private.company_mailbox_intake_owner_is_eligible(
      new.default_intake_owner_id,
      new.company_id
    )
  then
    raise exception 'lead_intake_source_owner_ineligible'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

create trigger lead_intake_sources_guard_owner
before insert or update of
  company_id,
  default_intake_owner_id,
  allowed_browser_origins
on private.lead_intake_sources
for each row
execute function private.guard_lead_intake_source_owner();

create or replace function private.assert_lead_intake_source_default_form()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_source_id uuid;
begin
  if tg_table_name = 'lead_intake_sources' then
    v_source_id := new.id;
  elsif tg_op = 'DELETE' then
    v_source_id := old.source_id;
  else
    v_source_id := new.source_id;
  end if;

  if not exists (
    select 1
    from private.lead_intake_sources source
    where source.id = v_source_id
  ) then
    return null;
  end if;

  if (
    select count(*)
    from private.lead_intake_forms form_row
    where form_row.source_id = v_source_id
      and form_row.form_key = 'default'
      and form_row.is_default
      and form_row.is_active
  ) <> 1 then
    raise exception 'lead_intake_source_default_form_required'
      using errcode = '23514';
  end if;

  return null;
end;
$function$;

create constraint trigger lead_intake_sources_require_default_form
after insert or update on private.lead_intake_sources
deferrable initially deferred
for each row
execute function private.assert_lead_intake_source_default_form();

create constraint trigger lead_intake_forms_preserve_default_form
after insert or update or delete on private.lead_intake_forms
deferrable initially deferred
for each row
execute function private.assert_lead_intake_source_default_form();

create or replace function private.guard_lead_intake_form_identity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if tg_op = 'UPDATE' then
    if (
      new.company_id is distinct from old.company_id
      or new.source_id is distinct from old.source_id
      or new.public_form_id is distinct from old.public_form_id
      or new.form_key is distinct from old.form_key
      or new.is_default is distinct from old.is_default
    ) then
      raise exception 'lead_intake_form_identity_immutable'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

create trigger lead_intake_forms_guard_identity
before update on private.lead_intake_forms
for each row
execute function private.guard_lead_intake_form_identity();

create or replace function private.replace_lead_intake_source_forms(
  p_company_id uuid,
  p_source_id uuid,
  p_forms jsonb
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_form jsonb;
  v_form_key text;
  v_label text;
  v_active boolean;
  v_seen_keys text[] := '{}'::text[];
begin
  -- NULL means "leave custom forms unchanged". Source creation passes an
  -- explicit empty array when no custom forms were supplied.
  if p_forms is null then
    return;
  end if;
  if jsonb_typeof(p_forms) <> 'array'
    or jsonb_array_length(p_forms) > 49
  then
    raise exception 'lead_intake_forms_invalid'
      using errcode = '22023';
  end if;

  for v_form in
    select value
    from jsonb_array_elements(p_forms)
  loop
    if jsonb_typeof(v_form) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_form) key_name
        where key_name not in ('key', 'label', 'active')
      )
      or not (v_form ? 'key')
      or jsonb_typeof(v_form -> 'key') <> 'string'
      or not (v_form ? 'label')
      or jsonb_typeof(v_form -> 'label') <> 'string'
      or (
        v_form ? 'active'
        and jsonb_typeof(v_form -> 'active') <> 'boolean'
      )
    then
      raise exception 'lead_intake_form_invalid'
        using errcode = '22023';
    end if;

    v_form_key := lower(btrim(coalesce(v_form ->> 'key', '')));
    v_label := btrim(coalesce(v_form ->> 'label', ''));
    v_active := coalesce((v_form ->> 'active')::boolean, true);

    if v_form_key = 'default'
      or v_form_key !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
      or char_length(v_label) not between 1 and 120
      or v_label ~ '[[:cntrl:]]'
      or v_form_key = any(v_seen_keys)
    then
      raise exception 'lead_intake_form_invalid'
        using errcode = '22023';
    end if;

    v_seen_keys := array_append(v_seen_keys, v_form_key);
  end loop;

  update private.lead_intake_forms form_row
  set is_active = false,
      updated_at = clock_timestamp()
  where form_row.company_id = p_company_id
    and form_row.source_id = p_source_id
    and not form_row.is_default
    and not (form_row.form_key = any(v_seen_keys));

  for v_form in
    select value
    from jsonb_array_elements(p_forms)
  loop
    v_form_key := lower(btrim(v_form ->> 'key'));
    v_label := btrim(v_form ->> 'label');
    v_active := coalesce((v_form ->> 'active')::boolean, true);

    insert into private.lead_intake_forms (
      company_id,
      source_id,
      form_key,
      label,
      is_default,
      is_active
    ) values (
      p_company_id,
      p_source_id,
      v_form_key,
      v_label,
      false,
      v_active
    )
    on conflict (source_id, form_key)
    do update
    set label = excluded.label,
        is_active = excluded.is_active,
        updated_at = clock_timestamp();
  end loop;
end;
$function$;

create or replace function private.guard_external_api_principal_source()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_principal private.external_api_principals%rowtype;
  v_source private.lead_intake_sources%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (
      new.principal_id is distinct from old.principal_id
      or new.company_id is distinct from old.company_id
      or new.source_id is distinct from old.source_id
    ) then
      raise exception 'external_api_source_grant_identity_immutable'
        using errcode = '42501';
    end if;
  end if;

  select principal.*
  into v_principal
  from private.external_api_principals principal
  where principal.id = new.principal_id
    and principal.company_id = new.company_id
  for share;

  if not found
    or not (
      v_principal.scopes @> array['intake.write']::text[]
    )
  then
    raise exception 'external_api_source_grant_requires_intake_principal'
      using errcode = '23514';
  end if;

  select source.*
  into v_source
  from private.lead_intake_sources source
  where source.id = new.source_id
    and source.company_id = new.company_id
  for share;

  if not found or v_source.status <> 'active' then
    raise exception 'external_api_source_grant_requires_active_source'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

create trigger external_api_principal_sources_guard
before insert or update on private.external_api_principal_sources
for each row
execute function private.guard_external_api_principal_source();

create or replace function private.assert_external_api_principal_source_policy()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_principal_id uuid;
  v_scopes text[];
  v_source_count bigint;
begin
  if tg_table_name = 'external_api_principals' then
    v_principal_id := new.id;
  elsif tg_op = 'DELETE' then
    v_principal_id := old.principal_id;
  else
    v_principal_id := new.principal_id;
  end if;

  select principal.scopes
  into v_scopes
  from private.external_api_principals principal
  where principal.id = v_principal_id;

  if not found then
    return null;
  end if;

  select count(*)
  into v_source_count
  from private.external_api_principal_sources source_grant
  where source_grant.principal_id = v_principal_id;

  if (
      v_scopes @> array['intake.write']::text[]
      and v_source_count = 0
    )
    or (
      not (v_scopes @> array['intake.write']::text[])
      and v_source_count <> 0
    )
  then
    raise exception 'external_api_principal_source_policy_invalid'
      using errcode = '23514';
  end if;

  return null;
end;
$function$;

create constraint trigger external_api_principals_require_source_policy
after insert or update on private.external_api_principals
deferrable initially deferred
for each row
execute function private.assert_external_api_principal_source_policy();

create constraint trigger external_api_principal_sources_require_policy
after insert or update or delete on private.external_api_principal_sources
deferrable initially deferred
for each row
execute function private.assert_external_api_principal_source_policy();

create or replace function private.guard_external_api_credential_identity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_principal private.external_api_principals%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (
      new.company_id is distinct from old.company_id
      or new.principal_id is distinct from old.principal_id
      or new.digest_version is distinct from old.digest_version
      or new.secret_digest is distinct from old.secret_digest
      or new.visible_prefix is distinct from old.visible_prefix
      or new.issued_authorization_epoch
        is distinct from old.issued_authorization_epoch
      or new.rotated_from_credential_id
        is distinct from old.rotated_from_credential_id
      or new.created_by_user_id is distinct from old.created_by_user_id
      or new.created_at is distinct from old.created_at
    ) then
      raise exception 'external_api_credential_identity_immutable'
        using errcode = '42501';
    end if;
  end if;

  select principal.*
  into v_principal
  from private.external_api_principals principal
  where principal.id = new.principal_id
    and principal.company_id = new.company_id
  for share;

  if not found
    or v_principal.principal_type <> 'server_key'
    or (
      tg_op = 'INSERT'
      and new.issued_authorization_epoch <> v_principal.authorization_epoch
    )
  then
    raise exception 'external_api_credential_principal_invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

create trigger external_api_credentials_guard_identity
before insert or update on private.external_api_credentials
for each row
execute function private.guard_external_api_credential_identity();

create or replace function private.external_api_safe_tokens(
  p_tokens text[],
  p_max_count integer
) returns boolean
language plpgsql
immutable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token text;
begin
  if p_tokens is null then
    return true;
  end if;
  if cardinality(p_tokens) > p_max_count
    or array_position(p_tokens, null) is not null
  then
    return false;
  end if;
  foreach v_token in array p_tokens
  loop
    if v_token !~ '^[a-z][a-z0-9_.-]{0,63}$' then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

create or replace function private.insert_external_api_authenticated_audit_base(
  p_request_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_route text,
  p_method text,
  p_request_received_at timestamptz
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_credential_class text;
  v_feature_enabled boolean;
  v_source_grant_count bigint;
  v_active_source_count bigint;
begin
  if p_request_id is null
    or p_principal_id is null
    or p_credential_id is null
    or p_route is null
    or p_method is null
    or p_request_received_at is null
  then
    raise exception 'external_api_audit_base_arguments_required'
      using errcode = '22023';
  end if;

  select principal.company_id
  into v_company_id
  from private.external_api_principals principal
  join private.external_api_credentials credential
    on credential.principal_id = principal.id
   and credential.company_id = principal.company_id
  where principal.id = p_principal_id
    and credential.id = p_credential_id;

  if not found then
    raise exception 'external_api_audit_identity_invalid'
      using errcode = '42501';
  end if;

  -- Guarded command/read RPCs call this helper inside their business
  -- transaction. The shared company fence makes credential/source/feature
  -- revocation linearizable with the command and its base audit evidence.
  -- It is intentionally private and is never a standalone service-role RPC.
  perform private.lock_external_api_company_shared(v_company_id);

  select principal.credential_class
  into v_credential_class
  from private.external_api_principals principal
  where principal.id = p_principal_id
    and principal.company_id = v_company_id
  for share;

  if not found then
    raise exception 'external_api_audit_identity_invalid'
      using errcode = '42501';
  end if;

  perform 1
  from private.external_api_credentials credential
  where credential.id = p_credential_id
    and credential.principal_id = p_principal_id
    and credential.company_id = v_company_id
  for share;

  if not found then
    raise exception 'external_api_audit_identity_invalid'
      using errcode = '42501';
  end if;

  v_feature_enabled :=
    private.external_api_company_feature_enabled(v_company_id);

  if not coalesce(v_feature_enabled, false) then
    raise exception 'external_api_audit_identity_invalid'
      using errcode = '42501';
  end if;

  perform 1
  from private.external_api_principals principal
  join private.external_api_credentials credential
    on credential.principal_id = principal.id
   and credential.company_id = principal.company_id
  where principal.id = p_principal_id
    and credential.id = p_credential_id
    and principal.status = 'active'
    and principal.revoked_at is null
    and credential.issued_authorization_epoch =
      principal.authorization_epoch
    and (
      credential.status = 'active'
      or (
        credential.status = 'overlap'
        and credential.overlap_until > clock_timestamp()
      )
    )
    and (
      credential.expires_at is null
      or credential.expires_at > clock_timestamp()
    );

  if not found then
    raise exception 'external_api_audit_identity_invalid'
      using errcode = '42501';
  end if;

  select
    count(*),
    count(*) filter (where source.status = 'active')
  into v_source_grant_count, v_active_source_count
  from private.external_api_principal_sources source_grant
  join private.lead_intake_sources source
    on source.id = source_grant.source_id
   and source.company_id = source_grant.company_id
  where source_grant.principal_id = p_principal_id
    and source_grant.company_id = v_company_id;

  if (
      v_credential_class = 'intake'
      and (
        v_source_grant_count = 0
        or v_active_source_count <> v_source_grant_count
      )
    )
    or (
      v_credential_class = 'analytics'
      and v_source_grant_count <> 0
    )
  then
    raise exception 'external_api_audit_identity_invalid'
      using errcode = '42501';
  end if;

  insert into private.external_api_request_audit (
    request_id,
    company_id,
    principal_id,
    credential_id,
    route,
    method,
    request_received_at,
    outcome
  ) values (
    p_request_id,
    v_company_id,
    p_principal_id,
    p_credential_id,
    p_route,
    p_method,
    p_request_received_at,
    'authenticated'
  );
end;
$function$;

create or replace function private.append_external_lead_projection_foundation(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_projection_schema_version smallint,
  p_operation text,
  p_normalized_source_projection jsonb,
  p_public_projection jsonb,
  p_source_record_updated_at timestamptz
) returns table (
  public_lead_id uuid,
  change_sequence bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_handle_id uuid;
  v_public_lead_id uuid;
  v_sequence bigint;
  v_version_id uuid := gen_random_uuid();
begin
  if p_company_id is null
    or p_opportunity_id is null
    or p_projection_schema_version is null
    or p_projection_schema_version <= 0
    or p_operation is null
    or p_operation not in ('upsert', 'merge', 'deletion')
    or p_normalized_source_projection is null
    or jsonb_typeof(p_normalized_source_projection) <> 'object'
    or p_public_projection is null
    or jsonb_typeof(p_public_projection) <> 'object'
    or octet_length(p_normalized_source_projection::text) > 65536
    or octet_length(p_public_projection::text) > 131072
    or p_source_record_updated_at is null
  then
    raise exception 'external_lead_projection_arguments_invalid'
      using errcode = '22023';
  end if;

  perform 1
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
  for share;

  if not found then
    raise exception 'external_lead_projection_opportunity_mismatch'
      using errcode = '42501';
  end if;

  insert into private.external_lead_handles (
    company_id,
    opportunity_id
  ) values (
    p_company_id,
    p_opportunity_id
  )
  on conflict (company_id, opportunity_id) do nothing;

  select handle.id, handle.public_lead_id
  into v_handle_id, v_public_lead_id
  from private.external_lead_handles handle
  where handle.company_id = p_company_id
    and handle.opportunity_id = p_opportunity_id
  for update;

  insert into private.external_lead_source_projections (
    company_id,
    handle_id,
    opportunity_id,
    projection_schema_version,
    normalized_source_projection,
    source_record_updated_at
  ) values (
    p_company_id,
    v_handle_id,
    p_opportunity_id,
    p_projection_schema_version,
    p_normalized_source_projection,
    p_source_record_updated_at
  )
  on conflict (company_id, handle_id)
  do update
  set projection_schema_version = excluded.projection_schema_version,
      normalized_source_projection = excluded.normalized_source_projection,
      source_record_updated_at = excluded.source_record_updated_at,
      projected_at = clock_timestamp();

  insert into private.external_lead_projection_state (
    company_id,
    high_water_sequence
  ) values (
    p_company_id,
    0
  )
  on conflict (company_id) do nothing;

  update private.external_lead_projection_state state
  set high_water_sequence = state.high_water_sequence + 1,
      updated_at = clock_timestamp()
  where state.company_id = p_company_id
  returning state.high_water_sequence into v_sequence;

  insert into private.external_lead_projection_versions (
    id,
    company_id,
    handle_id,
    public_lead_id,
    change_sequence,
    projection_schema_version,
    operation,
    public_projection,
    source_record_updated_at
  ) values (
    v_version_id,
    p_company_id,
    v_handle_id,
    v_public_lead_id,
    v_sequence,
    p_projection_schema_version,
    p_operation,
    p_public_projection,
    p_source_record_updated_at
  );

  insert into private.external_lead_projection_baselines (
    company_id,
    handle_id,
    version_id,
    public_lead_id,
    latest_sequence,
    projection_schema_version,
    operation,
    public_projection,
    source_record_updated_at,
    projected_at
  ) values (
    p_company_id,
    v_handle_id,
    v_version_id,
    v_public_lead_id,
    v_sequence,
    p_projection_schema_version,
    p_operation,
    p_public_projection,
    p_source_record_updated_at,
    clock_timestamp()
  )
  on conflict (company_id, handle_id)
  do update
  set version_id = excluded.version_id,
      public_lead_id = excluded.public_lead_id,
      latest_sequence = excluded.latest_sequence,
      projection_schema_version = excluded.projection_schema_version,
      operation = excluded.operation,
      public_projection = excluded.public_projection,
      source_record_updated_at = excluded.source_record_updated_at,
      projected_at = excluded.projected_at;

  return query
  select v_public_lead_id, v_sequence;
end;
$function$;

-- Management wrappers -------------------------------------------------------

create or replace function public.authenticate_external_api_credential_as_system(
  p_digest_version smallint,
  p_secret_digest bytea,
  p_visible_prefix text
) returns table (
  authenticated boolean,
  denial_code text,
  principal_id uuid,
  credential_id uuid,
  company_id uuid,
  credential_class text,
  scopes text[],
  allowed_source_ids uuid[],
  authorization_epoch bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_credential private.external_api_credentials%rowtype;
  v_principal private.external_api_principals%rowtype;
  v_allowed_source_ids uuid[];
  v_source_grant_count bigint;
  v_active_source_count bigint;
  v_denial_code text;
  v_feature_enabled boolean;
  v_lookup_credential_id uuid;
  v_lookup_company_id uuid;
begin
  perform private.require_external_api_service_role();

  if p_digest_version is null
    or p_digest_version <= 0
    or p_secret_digest is null
    or octet_length(p_secret_digest) <> 32
    or p_visible_prefix is null
    or char_length(p_visible_prefix) not between 8 and 32
    or p_visible_prefix !~ '^[A-Za-z0-9_-]+$'
  then
    return query
    select
      false,
      'invalid_credential'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text[],
      null::uuid[],
      null::bigint;
    return;
  end if;

  select credential.*
  into v_credential
  from private.external_api_credentials credential
  where credential.digest_version = p_digest_version
    and credential.secret_digest = p_secret_digest
    and credential.visible_prefix = p_visible_prefix
  limit 1;

  if not found then
    return query
    select
      false,
      'invalid_credential'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text[],
      null::uuid[],
      null::bigint;
    return;
  end if;

  v_lookup_credential_id := v_credential.id;
  v_lookup_company_id := v_credential.company_id;
  perform private.lock_external_api_company_shared(v_lookup_company_id);

  -- Re-read under the shared company fence. Every credential/source/feature
  -- mutation takes the matching exclusive fence before it can lock rows.
  select credential.*
  into v_credential
  from private.external_api_credentials credential
  where credential.id = v_lookup_credential_id
    and credential.company_id = v_lookup_company_id
    and credential.digest_version = p_digest_version
    and credential.secret_digest = p_secret_digest
    and credential.visible_prefix = p_visible_prefix
  for update;

  if not found then
    return query
    select
      false,
      'invalid_credential'::text,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text[],
      null::uuid[],
      null::bigint;
    return;
  end if;

  select principal.*
  into v_principal
  from private.external_api_principals principal
  where principal.id = v_credential.principal_id
    and principal.company_id = v_credential.company_id
  for share;

  v_feature_enabled :=
    private.external_api_company_feature_enabled(
      v_credential.company_id
    );

  select
    count(*),
    count(*) filter (where source.status = 'active'),
    coalesce(
      array_agg(source.public_source_id order by source.public_source_id)
        filter (where source.status = 'active'),
      '{}'::uuid[]
    )
  into
    v_source_grant_count,
    v_active_source_count,
    v_allowed_source_ids
  from private.external_api_principal_sources source_grant
  join private.lead_intake_sources source
    on source.id = source_grant.source_id
   and source.company_id = source_grant.company_id
  where source_grant.principal_id = v_principal.id
    and source_grant.company_id = v_principal.company_id;

  v_denial_code := case
    when v_principal.id is null then 'invalid_credential'
    when not coalesce(v_feature_enabled, false) then 'feature_disabled'
    when v_principal.status <> 'active'
      or v_principal.revoked_at is not null
      then 'invalid_credential'
    when v_credential.issued_authorization_epoch
      <> v_principal.authorization_epoch
      then 'invalid_credential'
    when v_credential.status = 'active' then null
    when v_credential.status = 'overlap'
      and v_credential.overlap_until > clock_timestamp()
      then null
    else 'invalid_credential'
  end;

  if v_denial_code is null
    and v_credential.expires_at is not null
    and v_credential.expires_at <= clock_timestamp()
  then
    v_denial_code := 'invalid_credential';
  end if;

  if v_denial_code is null
    and (
      (
        v_principal.credential_class = 'intake'
        and (
          v_source_grant_count = 0
          or v_active_source_count <> v_source_grant_count
        )
      )
      or (
        v_principal.credential_class = 'analytics'
        and v_source_grant_count <> 0
      )
    )
  then
    v_denial_code := 'invalid_credential';
  end if;

  if v_denial_code is not null then
    update private.external_api_credentials credential
    set last_rejected_at = clock_timestamp(),
        rejection_count = credential.rejection_count + 1
    where credential.id = v_credential.id;

    perform private.append_external_api_security_event(
      v_principal.company_id,
      'credential_rejected',
      v_principal.id,
      v_credential.id,
      null,
      null,
      null,
      case
        when v_denial_code = 'feature_disabled' then 'feature_disabled'
        else 'credential_invalid'
      end,
      v_principal.authorization_epoch
    );

    return query
    select
      false,
      v_denial_code,
      null::uuid,
      null::uuid,
      null::uuid,
      null::text,
      null::text[],
      null::uuid[],
      null::bigint;
    return;
  end if;

  update private.external_api_credentials credential
  set last_used_at = clock_timestamp()
  where credential.id = v_credential.id;

  return query
  select
    true,
    null::text,
    v_principal.id,
    v_credential.id,
    v_principal.company_id,
    v_principal.credential_class,
    v_principal.scopes,
    v_allowed_source_ids,
    v_principal.authorization_epoch;
end;
$function$;

create or replace function public.list_external_api_settings_as_system(
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_sources jsonb;
  v_credentials jsonb;
begin
  v_company_id :=
    private.require_external_api_management_actor(p_actor_user_id, false);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceId', source.public_source_id,
        'integrationType', source.integration_type,
        'siteLabel', source.site_label,
        'canonicalHost', source.canonical_host,
        'defaultPhoneRegion', source.default_phone_region,
        'allowedBrowserOrigins', source.allowed_browser_origins,
        'defaultCoarseSource', source.default_coarse_source,
        'defaultIntakeOwnerId', source.default_intake_owner_id,
        'status', source.status,
        'createdAt', source.created_at,
        'updatedAt', source.updated_at,
        'forms', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'formId', form_row.public_form_id,
                'key', form_row.form_key,
                'label', form_row.label,
                'isDefault', form_row.is_default,
                'active', form_row.is_active
              )
              order by form_row.is_default desc, form_row.form_key
            ),
            '[]'::jsonb
          )
          from private.lead_intake_forms form_row
          where form_row.company_id = source.company_id
            and form_row.source_id = source.id
        )
      )
      order by source.site_label, source.public_source_id
    ),
    '[]'::jsonb
  )
  into v_sources
  from private.lead_intake_sources source
  where source.company_id = v_company_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'credentialId', credential.id,
        'principalId', principal.id,
        'name', credential.name,
        'class', principal.credential_class,
        'scopes', principal.scopes,
        'sourceIds', (
          select coalesce(
            jsonb_agg(source.public_source_id order by source.public_source_id),
            '[]'::jsonb
          )
          from private.external_api_principal_sources source_grant
          join private.lead_intake_sources source
            on source.id = source_grant.source_id
           and source.company_id = source_grant.company_id
          where source_grant.principal_id = principal.id
        ),
        'prefix', credential.visible_prefix,
        'status', case
          when principal.status = 'revoked'
            or credential.status = 'revoked'
            then 'revoked'
          when credential.expires_at is not null
            and credential.expires_at <= clock_timestamp()
            then 'expired'
          when credential.status = 'overlap'
            and credential.overlap_until <= clock_timestamp()
            then 'retired'
          else credential.status
        end,
        'createdByUserId', credential.created_by_user_id,
        'createdAt', credential.created_at,
        'updatedAt', credential.updated_at,
        'lastUsedAt', credential.last_used_at,
        'expiresAt', credential.expires_at,
        'overlapUntil', credential.overlap_until,
        'rejectionCount', credential.rejection_count,
        'recentRejectionCount', (
          select count(*)
          from private.external_api_security_events event
          where event.credential_id = credential.id
            and event.event_type = 'credential_rejected'
            and event.occurred_at >= clock_timestamp() - interval '30 days'
        ),
        'authorizationEpoch', principal.authorization_epoch
      )
      order by principal.granted_at desc, credential.created_at desc
    ),
    '[]'::jsonb
  )
  into v_credentials
  from private.external_api_credentials credential
  join private.external_api_principals principal
    on principal.id = credential.principal_id
   and principal.company_id = credential.company_id
  where principal.company_id = v_company_id;

  return jsonb_build_object(
    'featureEnabled', true,
    'sources', v_sources,
    'credentials', v_credentials
  );
end;
$function$;

create or replace function public.create_lead_intake_source_as_system(
  p_actor_user_id uuid,
  p_site_label text,
  p_canonical_host text,
  p_default_phone_region text,
  p_allowed_browser_origins text[],
  p_default_coarse_source text,
  p_default_intake_owner_id uuid,
  p_forms jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_source private.lead_intake_sources%rowtype;
  v_canonical_host text;
  v_default_phone_region text;
begin
  v_company_id :=
    private.require_external_api_management_actor(p_actor_user_id, true);
  v_canonical_host := lower(btrim(coalesce(p_canonical_host, '')));
  v_default_phone_region :=
    upper(btrim(coalesce(p_default_phone_region, '')));

  if p_site_label is null
    or char_length(btrim(p_site_label)) not between 1 and 120
    or p_site_label ~ '[[:cntrl:]]'
    or v_canonical_host !~
      '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
    or v_canonical_host ~ '\.\.'
    or v_canonical_host ~ '[:/?#@]'
    or v_default_phone_region !~ '^[A-Z]{2}$'
    or not private.external_api_origins_are_valid(
      p_allowed_browser_origins
    )
    or p_default_coarse_source is null
    or p_default_coarse_source not in (
      'referral',
      'website',
      'email',
      'phone',
      'walk_in',
      'social_media',
      'repeat_client',
      'other'
    )
  then
    raise exception 'lead_intake_source_arguments_invalid'
      using errcode = '22023';
  end if;

  insert into private.lead_intake_sources (
    company_id,
    site_label,
    canonical_host,
    default_phone_region,
    allowed_browser_origins,
    default_coarse_source,
    default_intake_owner_id,
    created_by_user_id
  ) values (
    v_company_id,
    btrim(p_site_label),
    v_canonical_host,
    v_default_phone_region,
    p_allowed_browser_origins,
    p_default_coarse_source,
    p_default_intake_owner_id,
    p_actor_user_id
  )
  returning * into v_source;

  insert into private.lead_intake_forms (
    company_id,
    source_id,
    form_key,
    label,
    is_default,
    is_active
  ) values (
    v_company_id,
    v_source.id,
    'default',
    'Default',
    true,
    true
  );

  perform private.replace_lead_intake_source_forms(
    v_company_id,
    v_source.id,
    coalesce(p_forms, '[]'::jsonb)
  );

  perform private.append_external_api_security_event(
    v_company_id,
    'source_created',
    null,
    null,
    null,
    null,
    p_actor_user_id,
    null,
    null
  );

  return jsonb_build_object(
    'sourceId', v_source.public_source_id,
    'siteLabel', v_source.site_label,
    'canonicalHost', v_source.canonical_host,
    'defaultPhoneRegion', v_source.default_phone_region,
    'allowedBrowserOrigins', v_source.allowed_browser_origins,
    'defaultCoarseSource', v_source.default_coarse_source,
    'defaultIntakeOwnerId', v_source.default_intake_owner_id,
    'status', v_source.status,
    'createdAt', v_source.created_at,
    'updatedAt', v_source.updated_at,
    'forms', (
      select jsonb_agg(
        jsonb_build_object(
          'formId', form_row.public_form_id,
          'key', form_row.form_key,
          'label', form_row.label,
          'isDefault', form_row.is_default,
          'active', form_row.is_active
        )
        order by form_row.is_default desc, form_row.form_key
      )
      from private.lead_intake_forms form_row
      where form_row.source_id = v_source.id
    )
  );
end;
$function$;

create or replace function public.update_lead_intake_source_as_system(
  p_actor_user_id uuid,
  p_source_id uuid,
  p_expected_updated_at timestamptz,
  p_site_label text,
  p_canonical_host text,
  p_default_phone_region text,
  p_allowed_browser_origins text[],
  p_default_coarse_source text,
  p_default_intake_owner_id uuid,
  p_active boolean,
  p_forms jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_source private.lead_intake_sources%rowtype;
  v_canonical_host text;
  v_default_phone_region text;
begin
  v_company_id :=
    private.require_external_api_management_actor(p_actor_user_id, true);
  v_canonical_host := lower(btrim(coalesce(p_canonical_host, '')));
  v_default_phone_region :=
    upper(btrim(coalesce(p_default_phone_region, '')));

  if p_source_id is null
    or p_expected_updated_at is null
    or p_active is null
    or p_site_label is null
    or char_length(btrim(p_site_label)) not between 1 and 120
    or p_site_label ~ '[[:cntrl:]]'
    or v_canonical_host !~
      '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
    or v_canonical_host ~ '\.\.'
    or v_canonical_host ~ '[:/?#@]'
    or v_default_phone_region !~ '^[A-Z]{2}$'
    or not private.external_api_origins_are_valid(
      p_allowed_browser_origins
    )
    or p_default_coarse_source is null
    or p_default_coarse_source not in (
      'referral',
      'website',
      'email',
      'phone',
      'walk_in',
      'social_media',
      'repeat_client',
      'other'
    )
  then
    raise exception 'lead_intake_source_arguments_invalid'
      using errcode = '22023';
  end if;

  select source.*
  into v_source
  from private.lead_intake_sources source
  where source.public_source_id = p_source_id
    and source.company_id = v_company_id
  for update;

  if not found then
    raise exception 'lead_intake_source_not_found'
      using errcode = 'P0002';
  end if;
  if v_source.updated_at is distinct from p_expected_updated_at then
    raise exception 'lead_intake_source_stale'
      using errcode = '40001';
  end if;

  update private.lead_intake_sources source
  set site_label = btrim(p_site_label),
      canonical_host = v_canonical_host,
      default_phone_region = v_default_phone_region,
      allowed_browser_origins = p_allowed_browser_origins,
      default_coarse_source = p_default_coarse_source,
      default_intake_owner_id = p_default_intake_owner_id,
      status = case when p_active then 'active' else 'revoked' end,
      revoked_at = case
        when p_active then null
        else coalesce(source.revoked_at, clock_timestamp())
      end,
      updated_at = clock_timestamp()
  where source.id = v_source.id
  returning * into v_source;

  perform private.replace_lead_intake_source_forms(
    v_company_id,
    v_source.id,
    -- PATCH semantics: NULL preserves the current custom-form set.
    p_forms
  );

  perform private.append_external_api_security_event(
    v_company_id,
    'source_updated',
    null,
    null,
    null,
    null,
    p_actor_user_id,
    case when p_active then 'source_active' else 'source_revoked' end,
    null
  );

  return jsonb_build_object(
    'sourceId', v_source.public_source_id,
    'siteLabel', v_source.site_label,
    'canonicalHost', v_source.canonical_host,
    'defaultPhoneRegion', v_source.default_phone_region,
    'allowedBrowserOrigins', v_source.allowed_browser_origins,
    'defaultCoarseSource', v_source.default_coarse_source,
    'defaultIntakeOwnerId', v_source.default_intake_owner_id,
    'status', v_source.status,
    'updatedAt', v_source.updated_at,
    'forms', (
      select jsonb_agg(
        jsonb_build_object(
          'formId', form_row.public_form_id,
          'key', form_row.form_key,
          'label', form_row.label,
          'isDefault', form_row.is_default,
          'active', form_row.is_active
        )
        order by form_row.is_default desc, form_row.form_key
      )
      from private.lead_intake_forms form_row
      where form_row.source_id = v_source.id
    )
  );
end;
$function$;

create or replace function public.create_external_api_credential_as_system(
  p_actor_user_id uuid,
  p_name text,
  p_credential_class text,
  p_scopes text[],
  p_source_ids uuid[],
  p_digest_version smallint,
  p_secret_digest bytea,
  p_visible_prefix text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_principal private.external_api_principals%rowtype;
  v_credential private.external_api_credentials%rowtype;
  v_internal_source_ids uuid[];
  v_source_ids uuid[] := coalesce(p_source_ids, '{}'::uuid[]);
  v_distinct_source_count bigint;
begin
  v_company_id :=
    private.require_external_api_management_actor(p_actor_user_id, true);

  if p_name is null
    or char_length(btrim(p_name)) not between 1 and 120
    or p_name ~ '[[:cntrl:]]'
    or p_digest_version is null
    or p_digest_version <= 0
    or p_secret_digest is null
    or octet_length(p_secret_digest) <> 32
    or p_visible_prefix is null
    or char_length(p_visible_prefix) not between 8 and 32
    or p_visible_prefix !~ '^[A-Za-z0-9_-]+$'
    or (p_expires_at is not null and p_expires_at <= clock_timestamp())
    or p_credential_class is null
    or p_scopes is null
  then
    raise exception 'external_api_credential_arguments_invalid'
      using errcode = '22023';
  end if;

  if not coalesce((
    (
      p_credential_class = 'intake'
      and p_scopes = array['intake.write']::text[]
      and cardinality(v_source_ids) > 0
    )
    or
    (
      p_credential_class = 'analytics'
      and (
        p_scopes = array['analytics.leads.read']::text[]
        or p_scopes = array[
          'analytics.leads.read',
          'analytics.financial.read'
        ]::text[]
      )
      and cardinality(v_source_ids) = 0
    )
  ), false) then
    raise exception 'external_api_credential_scope_policy_invalid'
      using errcode = '22023';
  end if;

  select count(distinct source_id)
  into v_distinct_source_count
  from unnest(v_source_ids) source_id;

  if v_distinct_source_count <> cardinality(v_source_ids) then
    raise exception 'external_api_credential_source_duplicate'
      using errcode = '22023';
  end if;

  if p_credential_class = 'intake' then
    select coalesce(
      array_agg(source.id order by source.public_source_id),
      '{}'::uuid[]
    )
    into v_internal_source_ids
    from private.lead_intake_sources source
    where source.company_id = v_company_id
      and source.status = 'active'
      and source.public_source_id = any(v_source_ids);

    if cardinality(v_internal_source_ids) <> cardinality(v_source_ids) then
      raise exception 'external_api_credential_source_invalid'
        using errcode = '42501';
    end if;
  else
    v_internal_source_ids := '{}'::uuid[];
  end if;

  insert into private.external_api_principals (
    company_id,
    principal_type,
    credential_class,
    scopes,
    granted_by_user_id
  ) values (
    v_company_id,
    'server_key',
    p_credential_class,
    p_scopes,
    p_actor_user_id
  )
  returning * into v_principal;

  insert into private.external_api_principal_sources (
    principal_id,
    company_id,
    source_id
  )
  select
    v_principal.id,
    v_company_id,
    source_id
  from unnest(v_internal_source_ids) source_id;

  insert into private.external_api_credentials (
    company_id,
    principal_id,
    name,
    digest_version,
    secret_digest,
    visible_prefix,
    issued_authorization_epoch,
    expires_at,
    created_by_user_id
  ) values (
    v_company_id,
    v_principal.id,
    btrim(p_name),
    p_digest_version,
    p_secret_digest,
    p_visible_prefix,
    v_principal.authorization_epoch,
    p_expires_at,
    p_actor_user_id
  )
  returning * into v_credential;

  perform private.append_external_api_security_event(
    v_company_id,
    'principal_created',
    v_principal.id,
    null,
    null,
    null,
    p_actor_user_id,
    null,
    v_principal.authorization_epoch
  );
  perform private.append_external_api_security_event(
    v_company_id,
    'credential_created',
    v_principal.id,
    v_credential.id,
    null,
    null,
    p_actor_user_id,
    null,
    v_principal.authorization_epoch
  );

  return jsonb_build_object(
    'credentialId', v_credential.id,
    'principalId', v_principal.id,
    'name', v_credential.name,
    'class', v_principal.credential_class,
    'scopes', v_principal.scopes,
    'sourceIds', v_source_ids,
    'prefix', v_credential.visible_prefix,
    'status', v_credential.status,
    'createdAt', v_credential.created_at,
    'updatedAt', v_credential.updated_at,
    'expiresAt', v_credential.expires_at,
    'authorizationEpoch', v_principal.authorization_epoch
  );
end;
$function$;

create or replace function public.update_external_api_credential_as_system(
  p_actor_user_id uuid,
  p_credential_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_credential private.external_api_credentials%rowtype;
  v_principal private.external_api_principals%rowtype;
begin
  v_company_id :=
    private.require_external_api_management_actor(p_actor_user_id, true);

  if p_credential_id is null
    or p_expected_updated_at is null
    or p_name is null
    or char_length(btrim(p_name)) not between 1 and 120
    or p_name ~ '[[:cntrl:]]'
    or (p_expires_at is not null and p_expires_at <= clock_timestamp())
  then
    raise exception 'external_api_credential_arguments_invalid'
      using errcode = '22023';
  end if;

  select credential.*
  into v_credential
  from private.external_api_credentials credential
  where credential.id = p_credential_id
    and credential.company_id = v_company_id
  for update;

  if not found then
    raise exception 'external_api_credential_not_found'
      using errcode = 'P0002';
  end if;
  if v_credential.updated_at is distinct from p_expected_updated_at then
    raise exception 'external_api_credential_stale'
      using errcode = '40001';
  end if;
  if v_credential.status <> 'active' then
    raise exception 'external_api_credential_not_active'
      using errcode = '23514';
  end if;

  select principal.*
  into v_principal
  from private.external_api_principals principal
  where principal.id = v_credential.principal_id
    and principal.company_id = v_company_id
  for update;

  if not found or v_principal.status <> 'active' then
    raise exception 'external_api_principal_not_active'
      using errcode = '23514';
  end if;

  update private.external_api_credentials credential
  set name = btrim(p_name),
      expires_at = p_expires_at,
      updated_at = clock_timestamp()
  where credential.id = v_credential.id
  returning * into v_credential;

  perform private.append_external_api_security_event(
    v_company_id,
    'credential_updated',
    v_principal.id,
    v_credential.id,
    null,
    null,
    p_actor_user_id,
    'metadata_updated',
    v_principal.authorization_epoch
  );

  return jsonb_build_object(
    'credentialId', v_credential.id,
    'principalId', v_principal.id,
    'name', v_credential.name,
    'class', v_principal.credential_class,
    'scopes', v_principal.scopes,
    'prefix', v_credential.visible_prefix,
    'status', v_credential.status,
    'updatedAt', v_credential.updated_at,
    'expiresAt', v_credential.expires_at,
    'authorizationEpoch', v_principal.authorization_epoch
  );
end;
$function$;

create or replace function public.rotate_external_api_credential_as_system(
  p_actor_user_id uuid,
  p_credential_id uuid,
  p_expected_updated_at timestamptz,
  p_digest_version smallint,
  p_secret_digest bytea,
  p_visible_prefix text,
  p_overlap_seconds integer,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_prior private.external_api_credentials%rowtype;
  v_new private.external_api_credentials%rowtype;
  v_principal private.external_api_principals%rowtype;
  v_rotation_at timestamptz;
begin
  v_company_id :=
    private.require_external_api_management_actor(p_actor_user_id, true);

  if p_credential_id is null
    or p_expected_updated_at is null
    or p_digest_version is null
    or p_digest_version <= 0
    or p_secret_digest is null
    or octet_length(p_secret_digest) <> 32
    or p_visible_prefix is null
    or char_length(p_visible_prefix) not between 8 and 32
    or p_visible_prefix !~ '^[A-Za-z0-9_-]+$'
    or p_overlap_seconds is null
    or p_overlap_seconds not between 0 and 86400
  then
    raise exception 'external_api_credential_rotation_arguments_invalid'
      using errcode = '22023';
  end if;

  select credential.*
  into v_prior
  from private.external_api_credentials credential
  where credential.id = p_credential_id
    and credential.company_id = v_company_id
  for update;

  if not found then
    raise exception 'external_api_credential_not_found'
      using errcode = 'P0002';
  end if;
  if v_prior.updated_at is distinct from p_expected_updated_at then
    raise exception 'external_api_credential_stale'
      using errcode = '40001';
  end if;
  if v_prior.status <> 'active' then
    raise exception 'external_api_credential_not_active'
      using errcode = '23514';
  end if;

  select principal.*
  into v_principal
  from private.external_api_principals principal
  where principal.id = v_prior.principal_id
    and principal.company_id = v_company_id
  for update;

  if not found
    or v_principal.status <> 'active'
    or v_prior.issued_authorization_epoch
      <> v_principal.authorization_epoch
  then
    raise exception 'external_api_principal_not_active'
      using errcode = '23514';
  end if;

  v_rotation_at := clock_timestamp();
  if p_expires_at is not null and p_expires_at <= v_rotation_at then
    raise exception 'external_api_credential_rotation_arguments_invalid'
      using errcode = '22023';
  end if;

  if p_overlap_seconds = 0 then
    update private.external_api_credentials credential
    set status = 'retired',
        retired_at = v_rotation_at,
        overlap_started_at = null,
        overlap_until = null,
        updated_at = v_rotation_at
    where credential.id = v_prior.id;
  else
    update private.external_api_credentials credential
    set status = 'overlap',
        retired_at = null,
        overlap_started_at = v_rotation_at,
        overlap_until = v_rotation_at
          + make_interval(secs => p_overlap_seconds),
        updated_at = v_rotation_at
    where credential.id = v_prior.id;
  end if;

  insert into private.external_api_credentials (
    company_id,
    principal_id,
    name,
    digest_version,
    secret_digest,
    visible_prefix,
    issued_authorization_epoch,
    expires_at,
    rotated_from_credential_id,
    created_by_user_id,
    created_at,
    updated_at
  ) values (
    v_company_id,
    v_principal.id,
    v_prior.name,
    p_digest_version,
    p_secret_digest,
    p_visible_prefix,
    v_principal.authorization_epoch,
    p_expires_at,
    v_prior.id,
    p_actor_user_id,
    v_rotation_at,
    v_rotation_at
  )
  returning * into v_new;

  perform private.append_external_api_security_event(
    v_company_id,
    'credential_rotated',
    v_principal.id,
    v_prior.id,
    v_new.id,
    null,
    p_actor_user_id,
    case
      when p_overlap_seconds = 0 then 'no_overlap'
      else 'overlap_enabled'
    end,
    v_principal.authorization_epoch
  );

  return jsonb_build_object(
    'credentialId', v_new.id,
    'principalId', v_principal.id,
    'replacesCredentialId', v_prior.id,
    'name', v_new.name,
    'class', v_principal.credential_class,
    'scopes', v_principal.scopes,
    'prefix', v_new.visible_prefix,
    'status', v_new.status,
    'createdAt', v_new.created_at,
    'expiresAt', v_new.expires_at,
    'priorCredentialOverlapUntil', case
      when p_overlap_seconds = 0 then null
      else v_rotation_at + make_interval(secs => p_overlap_seconds)
    end,
    'authorizationEpoch', v_principal.authorization_epoch
  );
end;
$function$;

create or replace function public.revoke_external_api_credential_as_system(
  p_actor_user_id uuid,
  p_credential_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_credential private.external_api_credentials%rowtype;
  v_principal private.external_api_principals%rowtype;
  v_revoked_at timestamptz;
begin
  v_company_id :=
    private.require_external_api_management_actor(p_actor_user_id, true);

  if p_credential_id is null
    or p_reason_code is null
    or p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$'
  then
    raise exception 'external_api_credential_revocation_arguments_invalid'
      using errcode = '22023';
  end if;

  select credential.*
  into v_credential
  from private.external_api_credentials credential
  where credential.id = p_credential_id
    and credential.company_id = v_company_id
  for update;

  if not found then
    raise exception 'external_api_credential_not_found'
      using errcode = 'P0002';
  end if;

  select principal.*
  into v_principal
  from private.external_api_principals principal
  where principal.id = v_credential.principal_id
    and principal.company_id = v_company_id
  for update;

  if not found then
    raise exception 'external_api_principal_not_found'
      using errcode = 'P0002';
  end if;

  if v_principal.status = 'revoked' then
    return jsonb_build_object(
      'credentialId', p_credential_id,
      'principalId', v_principal.id,
      'status', 'revoked',
      'revokedAt', v_principal.revoked_at,
      'authorizationEpoch', v_principal.authorization_epoch,
      'idempotent', true
    );
  end if;

  v_revoked_at := clock_timestamp();

  update private.external_api_principals principal
  set status = 'revoked',
      authorization_epoch = principal.authorization_epoch + 1,
      updated_at = v_revoked_at,
      revoked_at = v_revoked_at,
      revoked_by_user_id = p_actor_user_id,
      revocation_reason_code = p_reason_code
  where principal.id = v_principal.id
  returning * into v_principal;

  update private.external_api_credentials credential
  set status = 'revoked',
      overlap_started_at = null,
      overlap_until = null,
      retired_at = null,
      revoked_at = v_revoked_at,
      revoked_by_user_id = p_actor_user_id,
      revocation_reason_code = p_reason_code,
      updated_at = v_revoked_at
  where credential.principal_id = v_principal.id
    and credential.company_id = v_company_id;

  perform private.append_external_api_security_event(
    v_company_id,
    'credential_revoked',
    v_principal.id,
    p_credential_id,
    null,
    null,
    p_actor_user_id,
    p_reason_code,
    v_principal.authorization_epoch
  );

  return jsonb_build_object(
    'credentialId', p_credential_id,
    'principalId', v_principal.id,
    'status', 'revoked',
    'revokedAt', v_principal.revoked_at,
    'authorizationEpoch', v_principal.authorization_epoch,
    'idempotent', false
  );
end;
$function$;

create or replace function public.record_external_api_request_audit_as_system(
  p_phase text,
  p_request_id uuid,
  p_route text,
  p_method text,
  p_request_received_at timestamptz,
  p_outcome text,
  p_error_code text,
  p_response_class smallint,
  p_duration_ms integer,
  p_rate_limit_result text,
  p_idempotency_result text,
  p_cache_result text,
  p_metric_set text[],
  p_grouping text[],
  p_result_size bigint,
  p_fingerprint_version smallint,
  p_fingerprint_digest bytea,
  p_presented_prefix text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_audit private.external_api_request_audit%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform private.require_external_api_service_role();

  if p_phase is null
    or p_phase not in ('pre_auth', 'finalize')
    or p_request_id is null
    or p_outcome is null
    or p_outcome not in (
      'authenticated',
      'accepted',
      'rejected',
      'not_found',
      'conflict',
      'rate_limited',
      'unavailable',
      'error'
    )
    or (
      p_error_code is not null
      and p_error_code !~ '^[a-z][a-z0-9_]{0,63}$'
    )
    or p_response_class is null
    or p_response_class not between 2 and 5
    or p_duration_ms is null
    or p_duration_ms not between 0 and 3600000
    or p_rate_limit_result is null
    or p_rate_limit_result not in (
      'allowed',
      'denied',
      'unavailable',
      'not_applicable'
    )
    or p_idempotency_result is null
    or p_idempotency_result not in (
      'new',
      'replay',
      'conflict',
      'expired',
      'not_applicable'
    )
    or p_cache_result is null
    or p_cache_result not in (
      'hit',
      'miss',
      'bypass',
      'not_applicable'
    )
    or not private.external_api_safe_tokens(p_metric_set, 32)
    or not private.external_api_safe_tokens(p_grouping, 8)
    or (p_result_size is not null and p_result_size < 0)
  then
    raise exception 'external_api_audit_arguments_invalid'
      using errcode = '22023';
  end if;

  if p_phase = 'pre_auth' then
    if p_route is null
      or p_method is null
      or p_request_received_at is null
      or p_outcome not in (
        'rejected',
        'not_found',
        'rate_limited',
        'unavailable',
        'error'
      )
      or (
        p_fingerprint_version is null
        and (
          p_fingerprint_digest is not null
          or p_presented_prefix is not null
        )
      )
      or (
        p_fingerprint_version is not null
        and (
          p_fingerprint_version <= 0
          or p_fingerprint_digest is null
          or octet_length(p_fingerprint_digest) <> 32
        )
      )
      or (
        p_presented_prefix is not null
        and (
          char_length(p_presented_prefix) not between 1 and 32
          or p_presented_prefix !~ '^[A-Za-z0-9_-]+$'
        )
      )
    then
      raise exception 'external_api_audit_pre_auth_arguments_invalid'
        using errcode = '22023';
    end if;

    insert into private.external_api_request_audit (
      request_id,
      route,
      method,
      request_received_at,
      outcome,
      error_code,
      finalized_at,
      response_class,
      duration_ms,
      rate_limit_result,
      idempotency_result,
      cache_result,
      metric_set,
      grouping,
      result_size
    ) values (
      p_request_id,
      p_route,
      p_method,
      p_request_received_at,
      p_outcome,
      p_error_code,
      v_now,
      p_response_class,
      p_duration_ms,
      p_rate_limit_result,
      p_idempotency_result,
      p_cache_result,
      p_metric_set,
      p_grouping,
      p_result_size
    );

    if p_fingerprint_version is not null then
      insert into private.external_api_network_fingerprints (
        request_id,
        fingerprint_version,
        fingerprint_digest,
        presented_prefix,
        captured_at,
        expires_at
      ) values (
        p_request_id,
        p_fingerprint_version,
        p_fingerprint_digest,
        p_presented_prefix,
        v_now,
        v_now + interval '30 days'
      );
    end if;

    return;
  end if;

  if p_route is not null
    or p_method is not null
    or p_request_received_at is not null
    or p_fingerprint_version is not null
    or p_fingerprint_digest is not null
    or p_presented_prefix is not null
  then
    raise exception 'external_api_audit_finalize_arguments_invalid'
      using errcode = '22023';
  end if;

  select audit_row.*
  into v_audit
  from private.external_api_request_audit audit_row
  where audit_row.request_id = p_request_id
  for update;

  if not found then
    raise exception 'external_api_audit_base_missing'
      using errcode = 'P0002';
  end if;
  if v_audit.finalized_at is not null then
    raise exception 'external_api_audit_already_finalized'
      using errcode = '23505';
  end if;

  update private.external_api_request_audit audit_row
  set outcome = p_outcome,
      error_code = p_error_code,
      finalized_at = v_now,
      response_class = p_response_class,
      duration_ms = p_duration_ms,
      rate_limit_result = p_rate_limit_result,
      idempotency_result = p_idempotency_result,
      cache_result = p_cache_result,
      metric_set = p_metric_set,
      grouping = p_grouping,
      result_size = p_result_size
  where audit_row.request_id = p_request_id;
end;
$function$;

create or replace function public.purge_external_api_network_fingerprints_as_system(
  p_cutoff timestamptz
) returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_deleted bigint;
  v_cutoff timestamptz := least(
    coalesce(p_cutoff, clock_timestamp()),
    clock_timestamp()
  );
begin
  perform private.require_external_api_service_role();

  delete from private.external_api_network_fingerprints fingerprint
  where fingerprint.expires_at <= v_cutoff;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

-- Private relations are never a Data API surface. RLS is a second line of
-- defense; explicit ACL denial is the primary direct-access boundary.

alter table private.external_api_principals enable row level security;
alter table private.external_api_principal_sources enable row level security;
alter table private.external_api_credentials enable row level security;
alter table private.lead_intake_sources enable row level security;
alter table private.lead_intake_forms enable row level security;
alter table private.external_api_request_audit enable row level security;
alter table private.external_api_network_fingerprints enable row level security;
alter table private.external_api_security_events enable row level security;
alter table private.external_lead_handles enable row level security;
alter table private.external_attribution_dictionary enable row level security;
alter table private.external_attribution_lookup_digests enable row level security;
alter table private.external_lead_source_projections enable row level security;
alter table private.external_lead_projection_state enable row level security;
alter table private.external_lead_projection_versions enable row level security;
alter table private.external_lead_projection_baselines enable row level security;

revoke all on table private.external_api_principals
  from public, anon, authenticated, service_role;
revoke all on table private.external_api_principal_sources
  from public, anon, authenticated, service_role;
revoke all on table private.external_api_credentials
  from public, anon, authenticated, service_role;
revoke all on table private.lead_intake_sources
  from public, anon, authenticated, service_role;
revoke all on table private.lead_intake_forms
  from public, anon, authenticated, service_role;
revoke all on table private.external_api_request_audit
  from public, anon, authenticated, service_role;
revoke all on table private.external_api_network_fingerprints
  from public, anon, authenticated, service_role;
revoke all on table private.external_api_security_events
  from public, anon, authenticated, service_role;
revoke all on table private.external_lead_handles
  from public, anon, authenticated, service_role;
revoke all on table private.external_attribution_dictionary
  from public, anon, authenticated, service_role;
revoke all on table private.external_attribution_lookup_digests
  from public, anon, authenticated, service_role;
revoke all on table private.external_lead_source_projections
  from public, anon, authenticated, service_role;
revoke all on table private.external_lead_projection_state
  from public, anon, authenticated, service_role;
revoke all on table private.external_lead_projection_versions
  from public, anon, authenticated, service_role;
revoke all on table private.external_lead_projection_baselines
  from public, anon, authenticated, service_role;

revoke all on function private.reject_external_api_audit_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_external_api_request_audit_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_external_lead_projection_version_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.require_external_api_service_role()
  from public, anon, authenticated, service_role;
revoke all on function private.lock_external_api_company_shared(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_external_api_company_exclusive(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_external_api_feature_override_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.external_api_company_feature_enabled(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_external_api_management_actor(
  uuid, boolean
)
  from public, anon, authenticated, service_role;
revoke all on function private.append_external_api_security_event(
  uuid, text, uuid, uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated, service_role;
revoke all on function private.external_api_origins_are_valid(text[])
  from public, anon, authenticated, service_role;
revoke all on function private.guard_lead_intake_source_owner()
  from public, anon, authenticated, service_role;
revoke all on function private.assert_lead_intake_source_default_form()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_lead_intake_form_identity()
  from public, anon, authenticated, service_role;
revoke all on function private.replace_lead_intake_source_forms(
  uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.guard_external_api_principal_source()
  from public, anon, authenticated, service_role;
revoke all on function private.assert_external_api_principal_source_policy()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_external_api_credential_identity()
  from public, anon, authenticated, service_role;
revoke all on function private.external_api_safe_tokens(text[], integer)
  from public, anon, authenticated, service_role;
revoke all on function private.insert_external_api_authenticated_audit_base(
  uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.append_external_lead_projection_foundation(
  uuid, uuid, smallint, text, jsonb, jsonb, timestamptz
) from public, anon, authenticated, service_role;

revoke all on function public.authenticate_external_api_credential_as_system(
  smallint, bytea, text
) from public, anon, authenticated, service_role;
grant execute on function public.authenticate_external_api_credential_as_system(
  smallint, bytea, text
) to service_role;

revoke all on function public.list_external_api_settings_as_system(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_external_api_settings_as_system(uuid)
  to service_role;

revoke all on function public.create_lead_intake_source_as_system(
  uuid, text, text, text, text[], text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_lead_intake_source_as_system(
  uuid, text, text, text, text[], text, uuid, jsonb
) to service_role;

revoke all on function public.update_lead_intake_source_as_system(
  uuid, uuid, timestamptz, text, text, text, text[], text, uuid, boolean,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.update_lead_intake_source_as_system(
  uuid, uuid, timestamptz, text, text, text, text[], text, uuid, boolean,
  jsonb
) to service_role;

revoke all on function public.create_external_api_credential_as_system(
  uuid, text, text, text[], uuid[], smallint, bytea, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.create_external_api_credential_as_system(
  uuid, text, text, text[], uuid[], smallint, bytea, text, timestamptz
) to service_role;

revoke all on function public.update_external_api_credential_as_system(
  uuid, uuid, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.update_external_api_credential_as_system(
  uuid, uuid, timestamptz, text, timestamptz
) to service_role;

revoke all on function public.rotate_external_api_credential_as_system(
  uuid, uuid, timestamptz, smallint, bytea, text, integer, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.rotate_external_api_credential_as_system(
  uuid, uuid, timestamptz, smallint, bytea, text, integer, timestamptz
) to service_role;

revoke all on function public.revoke_external_api_credential_as_system(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.revoke_external_api_credential_as_system(
  uuid, uuid, text
) to service_role;

revoke all on function public.record_external_api_request_audit_as_system(
  text, uuid, text, text, timestamptz, text, text, smallint, integer, text,
  text, text, text[], text[], bigint, smallint, bytea, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_external_api_request_audit_as_system(
  text, uuid, text, text, timestamptz, text, text, smallint, integer, text,
  text, text, text[], text[], bigint, smallint, bytea, text
) to service_role;

revoke all on function public.purge_external_api_network_fingerprints_as_system(
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.purge_external_api_network_fingerprints_as_system(
  timestamptz
) to service_role;

comment on table private.external_api_request_audit is
  'Redacted request evidence only. Never stores credentials, headers, bodies, contact content, file data, or signed links.';
comment on table private.external_api_network_fingerprints is
  'Separately purgeable keyed network evidence with a hard 30-day maximum lifetime.';
comment on table private.external_lead_projection_versions is
  'Immutable pseudonymous lead projection stream; current state lives in the separate baseline table.';

commit;
