-- Version the MCP OAuth consent catalogue and make dynamically registered
-- client ceilings immutable. Existing v1 clients, codes, grants, and tokens
-- retain their exact scope bytes; this migration only records the policy and
-- labels under which that authority was accepted.

do $prerequisites$
begin
  if to_regclass('private.mcp_oauth_clients') is null
     or to_regclass('private.mcp_oauth_authorization_codes') is null
     or to_regclass('private.mcp_oauth_grants') is null
     or to_regclass('private.mcp_oauth_tokens') is null then
    raise exception 'mcp_oauth_consent_catalog prerequisite missing';
  end if;
end;
$prerequisites$;

-- ---------------------------------------------------------------------------
-- Closed v1 parsing and consent helpers
-- ---------------------------------------------------------------------------

create or replace function private.mcp_oauth_scope_array(p_scope text)
returns text[]
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when btrim(p_scope) = '' then null::text[]
    else regexp_split_to_array(btrim(p_scope), '[[:space:]]+')
  end
$function$;

revoke all on function private.mcp_oauth_scope_array(text)
  from public, anon, authenticated, service_role;

create or replace function private.mcp_oauth_scope_array_is_valid(
  p_scopes text[]
) returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select coalesce(
    cardinality(p_scopes) between 1 and 32
    and array_position(p_scopes, null) is null
    and not exists (
      select 1
      from unnest(p_scopes) as scope(value)
      where btrim(scope.value) = ''
         or length(scope.value) > 128
    )
    and cardinality(array(
      select distinct scope.value
      from unnest(p_scopes) as scope(value)
    )) = cardinality(p_scopes),
    false
  )
$function$;

revoke all on function private.mcp_oauth_scope_array_is_valid(text[])
  from public, anon, authenticated, service_role;

create or replace function private.mcp_oauth_labels_for_scopes(
  p_scopes text[],
  p_consent_catalog_revision text
) returns text[]
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when p_consent_catalog_revision is distinct from
      '2026-08-22.mcp-consent-catalog.v1'
      or not private.mcp_oauth_scope_array_is_valid(p_scopes)
      then null::text[]
    when exists (
      select 1
      from unnest(p_scopes) as requested(scope)
      where case requested.scope
        when 'ops.jobs.read' then 'See your jobs and their status'
        when 'ops.schedule.read' then 'See your schedule and who''s assigned'
        when 'ops.customers.read' then 'See your clients and their jobs'
        when 'ops.customer_contacts.read' then
          'See who to contact on a job and how to reach them'
        when 'ops.photos.read' then 'See which jobs are missing photos'
        when 'ops.correspondence.read' then
          'See client email history on your jobs'
        when 'ops.financials.read' then
          'See estimate and invoice summaries on your jobs'
        when 'ops.tasks.read' then 'See tasks and work that needs attention'
        when 'ops.site_visits.read' then
          'See site visits and their evidence status'
        when 'ops.files.read' then
          'See authorized job photos, files, and documents'
        when 'ops.financial_documents.read' then
          'See estimates and invoices in detail'
        when 'ops.payments.read' then
          'See payment records on authorized invoices'
        when 'ops.expenses.read' then
          'See authorized expenses and reimbursements'
        when 'ops.catalog.read' then
          'See products, stock levels, and selling prices'
        when 'ops.purchasing.read' then 'See purchase orders'
        when 'ops.catalog_costs.read' then
          'See authorized supplier cost facts'
        when 'ops.company.read' then 'See the company operating profile'
        when 'ops.team.read' then
          'See the team directory and company availability'
        when 'ops.integrations.read' then
          'See integration health without credentials'
        when 'ops.operations.read' then
          'See authorized work queues and operational summaries'
        else null
      end is null
    ) then null::text[]
    else array(
      select case requested.scope
        when 'ops.jobs.read' then 'See your jobs and their status'
        when 'ops.schedule.read' then 'See your schedule and who''s assigned'
        when 'ops.customers.read' then 'See your clients and their jobs'
        when 'ops.customer_contacts.read' then
          'See who to contact on a job and how to reach them'
        when 'ops.photos.read' then 'See which jobs are missing photos'
        when 'ops.correspondence.read' then
          'See client email history on your jobs'
        when 'ops.financials.read' then
          'See estimate and invoice summaries on your jobs'
        when 'ops.tasks.read' then 'See tasks and work that needs attention'
        when 'ops.site_visits.read' then
          'See site visits and their evidence status'
        when 'ops.files.read' then
          'See authorized job photos, files, and documents'
        when 'ops.financial_documents.read' then
          'See estimates and invoices in detail'
        when 'ops.payments.read' then
          'See payment records on authorized invoices'
        when 'ops.expenses.read' then
          'See authorized expenses and reimbursements'
        when 'ops.catalog.read' then
          'See products, stock levels, and selling prices'
        when 'ops.purchasing.read' then 'See purchase orders'
        when 'ops.catalog_costs.read' then
          'See authorized supplier cost facts'
        when 'ops.company.read' then 'See the company operating profile'
        when 'ops.team.read' then
          'See the team directory and company availability'
        when 'ops.integrations.read' then
          'See integration health without credentials'
        when 'ops.operations.read' then
          'See authorized work queues and operational summaries'
      end
      from unnest(p_scopes) with ordinality as requested(scope, ordinal)
      order by requested.ordinal
    )
  end
$function$;

revoke all on function private.mcp_oauth_labels_for_scopes(text[], text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One-time exact-visible-consent previews
-- ---------------------------------------------------------------------------

create table if not exists private.mcp_oauth_consent_previews (
  preview_hash text primary key,
  client_id uuid not null,
  user_id uuid not null,
  company_id uuid not null,
  client_name text not null,
  company_name text not null,
  redirect_uri text not null,
  response_type text not null,
  scopes text[] not null,
  accepted_labels text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null,
  state text,
  code_challenge text not null,
  code_challenge_method text not null,
  resource text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint mcp_oauth_consent_previews_snapshot_valid check (
    preview_hash ~ '^[0-9a-f]{64}$'
    and length(client_name) between 1 and 256
    and length(company_name) between 1 and 512
    and length(redirect_uri) between 1 and 2048
    and response_type = 'code'
    and private.mcp_oauth_scope_array_is_valid(scopes)
    and cardinality(accepted_labels) = cardinality(scopes)
    and accepted_labels = private.mcp_oauth_labels_for_scopes(
      scopes,
      consent_catalog_revision
    )
    and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    and (
      state is null
      or (length(state) <= 2048 and state !~ '[[:cntrl:]]')
    )
    and code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'
    and code_challenge_method = 'S256'
    and length(resource) between 1 and 2048
    and expires_at > created_at
    and expires_at <= created_at + interval '5 minutes'
    and (
      consumed_at is null
      or (consumed_at >= created_at and consumed_at < expires_at)
    )
  )
);

-- `CREATE TABLE IF NOT EXISTS` must not preserve a same-name constraint with
-- different semantics on replay. Rebuild the complete snapshot check before
-- any preview can be issued.
alter table private.mcp_oauth_consent_previews
  drop constraint if exists mcp_oauth_consent_previews_snapshot_valid;
alter table private.mcp_oauth_consent_previews
  add constraint mcp_oauth_consent_previews_snapshot_valid check (
    preview_hash ~ '^[0-9a-f]{64}$'
    and length(client_name) between 1 and 256
    and length(company_name) between 1 and 512
    and length(redirect_uri) between 1 and 2048
    and response_type = 'code'
    and private.mcp_oauth_scope_array_is_valid(scopes)
    and cardinality(accepted_labels) = cardinality(scopes)
    and accepted_labels = private.mcp_oauth_labels_for_scopes(
      scopes,
      consent_catalog_revision
    )
    and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    and (
      state is null
      or (length(state) <= 2048 and state !~ '[[:cntrl:]]')
    )
    and code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'
    and code_challenge_method = 'S256'
    and length(resource) between 1 and 2048
    and expires_at > created_at
    and expires_at <= created_at + interval '5 minutes'
    and (
      consumed_at is null
      or (consumed_at >= created_at and consumed_at < expires_at)
    )
  );

create index if not exists mcp_oauth_consent_previews_expiry_idx
  on private.mcp_oauth_consent_previews (expires_at, preview_hash);

create index if not exists mcp_oauth_consent_previews_binding_expiry_idx
  on private.mcp_oauth_consent_previews (user_id, company_id, expires_at, preview_hash);

revoke all on table private.mcp_oauth_consent_previews
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Versioned columns, v1 backfill, and exact constraints
-- ---------------------------------------------------------------------------

alter table private.mcp_oauth_clients
  add column if not exists scope_ceiling text[];
alter table private.mcp_oauth_clients
  add column if not exists consent_catalog_revision text;
alter table private.mcp_oauth_clients
  add column if not exists exposure_revision text;

alter table private.mcp_oauth_authorization_codes
  add column if not exists accepted_labels text[];
alter table private.mcp_oauth_authorization_codes
  add column if not exists consent_catalog_revision text;
alter table private.mcp_oauth_authorization_codes
  add column if not exists exposure_revision text;

alter table private.mcp_oauth_grants
  add column if not exists accepted_labels text[];
alter table private.mcp_oauth_grants
  add column if not exists consent_catalog_revision text;
alter table private.mcp_oauth_grants
  add column if not exists exposure_revision text;

update private.mcp_oauth_clients
set scope_ceiling = private.mcp_oauth_scope_array(scope)
where scope_ceiling is null;

update private.mcp_oauth_clients
set consent_catalog_revision = coalesce(
      consent_catalog_revision,
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    exposure_revision = coalesce(
      exposure_revision,
      '2026-08-22.mcp-exposure.v1'
    )
where consent_catalog_revision is null
   or exposure_revision is null;

update private.mcp_oauth_authorization_codes
set accepted_labels = private.mcp_oauth_labels_for_scopes(
      scopes,
      '2026-08-22.mcp-consent-catalog.v1'
    )
where accepted_labels is null;

update private.mcp_oauth_authorization_codes
set consent_catalog_revision = coalesce(
      consent_catalog_revision,
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    exposure_revision = coalesce(
      exposure_revision,
      '2026-08-22.mcp-exposure.v1'
    )
where consent_catalog_revision is null
   or exposure_revision is null;

update private.mcp_oauth_grants
set accepted_labels = private.mcp_oauth_labels_for_scopes(
      scopes,
      '2026-08-22.mcp-consent-catalog.v1'
    )
where accepted_labels is null;

update private.mcp_oauth_grants
set consent_catalog_revision = coalesce(
      consent_catalog_revision,
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    exposure_revision = coalesce(
      exposure_revision,
      '2026-08-22.mcp-exposure.v1'
    )
where consent_catalog_revision is null
   or exposure_revision is null;

alter table private.mcp_oauth_clients
  alter column scope_ceiling set not null,
  alter column consent_catalog_revision set not null,
  alter column exposure_revision set not null;
alter table private.mcp_oauth_authorization_codes
  alter column accepted_labels set not null,
  alter column consent_catalog_revision set not null,
  alter column exposure_revision set not null;
alter table private.mcp_oauth_grants
  alter column accepted_labels set not null,
  alter column consent_catalog_revision set not null,
  alter column exposure_revision set not null;

-- Rebuild every inherited CHECK constraint whose table originated behind
-- CREATE TABLE IF NOT EXISTS. This removes the possibility that a legacy
-- same-name object carries weaker semantics into a replay.
alter table private.mcp_oauth_clients
  drop constraint if exists mcp_oauth_clients_name_bounded;
alter table private.mcp_oauth_clients
  add constraint mcp_oauth_clients_name_bounded check (
    length(client_name) between 1 and 256
  );
alter table private.mcp_oauth_clients
  drop constraint if exists mcp_oauth_clients_redirect_uris_present;
alter table private.mcp_oauth_clients
  add constraint mcp_oauth_clients_redirect_uris_present check (
    cardinality(redirect_uris) between 1 and 8
  );
alter table private.mcp_oauth_clients
  drop constraint if exists mcp_oauth_clients_public_only;
alter table private.mcp_oauth_clients
  add constraint mcp_oauth_clients_public_only check (
    token_endpoint_auth_method = 'none'
  );
alter table private.mcp_oauth_clients
  drop constraint if exists mcp_oauth_clients_registration_source;
alter table private.mcp_oauth_clients
  add constraint mcp_oauth_clients_registration_source check (
    registration_source in ('dynamic', 'manual')
  );

alter table private.mcp_oauth_authorization_codes
  drop constraint if exists mcp_oauth_codes_hash_shape;
alter table private.mcp_oauth_authorization_codes
  add constraint mcp_oauth_codes_hash_shape check (
    code_hash ~ '^[0-9a-f]{64}$'
  );
alter table private.mcp_oauth_authorization_codes
  drop constraint if exists mcp_oauth_codes_scopes_present;
alter table private.mcp_oauth_authorization_codes
  add constraint mcp_oauth_codes_scopes_present check (
    cardinality(scopes) between 1 and 32
  );
alter table private.mcp_oauth_authorization_codes
  drop constraint if exists mcp_oauth_codes_challenge_shape;
alter table private.mcp_oauth_authorization_codes
  add constraint mcp_oauth_codes_challenge_shape check (
    code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'
  );
alter table private.mcp_oauth_authorization_codes
  drop constraint if exists mcp_oauth_codes_challenge_method;
alter table private.mcp_oauth_authorization_codes
  add constraint mcp_oauth_codes_challenge_method check (
    code_challenge_method = 'S256'
  );

alter table private.mcp_oauth_grants
  drop constraint if exists mcp_oauth_grants_scopes_present;
alter table private.mcp_oauth_grants
  add constraint mcp_oauth_grants_scopes_present check (
    cardinality(scopes) between 1 and 32
  );
alter table private.mcp_oauth_grants
  drop constraint if exists mcp_oauth_grants_revision_shape;
alter table private.mcp_oauth_grants
  add constraint mcp_oauth_grants_revision_shape check (
    revision ~ '^[0-9a-f]{32}$'
  );

alter table private.mcp_oauth_tokens
  drop constraint if exists mcp_oauth_tokens_hash_shape;
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_hash_shape check (
    token_hash ~ '^[0-9a-f]{64}$'
  );
alter table private.mcp_oauth_tokens
  drop constraint if exists mcp_oauth_tokens_kind;
alter table private.mcp_oauth_tokens
  add constraint mcp_oauth_tokens_kind check (
    kind in ('access', 'refresh')
  );

alter table private.mcp_oauth_clients
  drop constraint if exists mcp_oauth_clients_scope_ceiling_valid;
alter table private.mcp_oauth_clients
  add constraint mcp_oauth_clients_scope_ceiling_valid check (
    private.mcp_oauth_scope_array_is_valid(scope_ceiling)
    and scope = array_to_string(scope_ceiling, ' ')
    and private.mcp_oauth_labels_for_scopes(
      scope_ceiling,
      consent_catalog_revision
    ) is not null
    and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
  );

alter table private.mcp_oauth_authorization_codes
  drop constraint if exists mcp_oauth_codes_consent_snapshot_valid;
alter table private.mcp_oauth_authorization_codes
  add constraint mcp_oauth_codes_consent_snapshot_valid check (
    private.mcp_oauth_scope_array_is_valid(scopes)
    and cardinality(accepted_labels) = cardinality(scopes)
    and accepted_labels = private.mcp_oauth_labels_for_scopes(
      scopes,
      consent_catalog_revision
    )
    and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
  );

alter table private.mcp_oauth_grants
  drop constraint if exists mcp_oauth_grants_consent_snapshot_valid;
alter table private.mcp_oauth_grants
  add constraint mcp_oauth_grants_consent_snapshot_valid check (
    private.mcp_oauth_scope_array_is_valid(scopes)
    and cardinality(accepted_labels) = cardinality(scopes)
    and accepted_labels = private.mcp_oauth_labels_for_scopes(
      scopes,
      consent_catalog_revision
    )
    and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
  );

-- ---------------------------------------------------------------------------
-- Immutable authority snapshots
-- ---------------------------------------------------------------------------

create or replace function private.enforce_mcp_oauth_consent_immutability()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
begin
  if tg_table_name = 'mcp_oauth_clients' then
    if new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name
       or new.redirect_uris is distinct from old.redirect_uris
       or new.token_endpoint_auth_method is distinct from old.token_endpoint_auth_method
       or new.grant_types is distinct from old.grant_types
       or new.response_types is distinct from old.response_types
       or new.scope is distinct from old.scope
       or new.scope_ceiling is distinct from old.scope_ceiling
       or new.registration_source is distinct from old.registration_source
       or new.software_id is distinct from old.software_id
       or new.software_version is distinct from old.software_version
       or new.consent_catalog_revision is distinct from old.consent_catalog_revision
       or new.exposure_revision is distinct from old.exposure_revision
       or new.created_at is distinct from old.created_at then
      raise exception 'mcp_oauth_client_authority_immutable'
        using errcode = '22023';
    end if;
  elsif tg_table_name = 'mcp_oauth_authorization_codes' then
    if new.code_hash is distinct from old.code_hash
       or new.client_id is distinct from old.client_id
       or new.user_id is distinct from old.user_id
       or new.company_id is distinct from old.company_id
       or new.scopes is distinct from old.scopes
       or new.accepted_labels is distinct from old.accepted_labels
       or new.consent_catalog_revision is distinct from old.consent_catalog_revision
       or new.exposure_revision is distinct from old.exposure_revision
       or new.redirect_uri is distinct from old.redirect_uri
       or new.code_challenge is distinct from old.code_challenge
       or new.code_challenge_method is distinct from old.code_challenge_method
       or new.resource is distinct from old.resource
       or new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at then
      raise exception 'mcp_oauth_code_consent_immutable'
        using errcode = '22023';
    end if;
  elsif tg_table_name = 'mcp_oauth_grants' then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.company_id is distinct from old.company_id
       or new.client_id is distinct from old.client_id
       or new.scopes is distinct from old.scopes
       or new.accepted_labels is distinct from old.accepted_labels
       or new.consent_catalog_revision is distinct from old.consent_catalog_revision
       or new.exposure_revision is distinct from old.exposure_revision
       or new.revision is distinct from old.revision
       or new.created_at is distinct from old.created_at then
      raise exception 'mcp_oauth_grant_consent_immutable'
        using errcode = '22023';
    end if;
  elsif tg_table_name = 'mcp_oauth_consent_previews' then
    if new.preview_hash is distinct from old.preview_hash
       or new.client_id is distinct from old.client_id
       or new.user_id is distinct from old.user_id
       or new.company_id is distinct from old.company_id
       or new.client_name is distinct from old.client_name
       or new.company_name is distinct from old.company_name
       or new.redirect_uri is distinct from old.redirect_uri
       or new.response_type is distinct from old.response_type
       or new.scopes is distinct from old.scopes
       or new.accepted_labels is distinct from old.accepted_labels
       or new.consent_catalog_revision is distinct from old.consent_catalog_revision
       or new.exposure_revision is distinct from old.exposure_revision
       or new.state is distinct from old.state
       or new.code_challenge is distinct from old.code_challenge
       or new.code_challenge_method is distinct from old.code_challenge_method
       or new.resource is distinct from old.resource
       or new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at
       or old.consumed_at is not null
       or new.consumed_at is null then
      raise exception 'mcp_oauth_consent_preview_immutable'
        using errcode = '22023';
    end if;
  else
    raise exception 'mcp_oauth_consent_trigger_misconfigured'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_mcp_oauth_consent_immutability()
  from public, anon, authenticated, service_role;

drop trigger if exists mcp_oauth_clients_immutable_ceiling
  on private.mcp_oauth_clients;
create trigger mcp_oauth_clients_immutable_ceiling
before update on private.mcp_oauth_clients
for each row execute function private.enforce_mcp_oauth_consent_immutability();

drop trigger if exists mcp_oauth_codes_immutable_consent
  on private.mcp_oauth_authorization_codes;
create trigger mcp_oauth_codes_immutable_consent
before update on private.mcp_oauth_authorization_codes
for each row execute function private.enforce_mcp_oauth_consent_immutability();

drop trigger if exists mcp_oauth_grants_immutable_consent
  on private.mcp_oauth_grants;
create trigger mcp_oauth_grants_immutable_consent
before update on private.mcp_oauth_grants
for each row execute function private.enforce_mcp_oauth_consent_immutability();

drop trigger if exists mcp_oauth_consent_previews_immutable
  on private.mcp_oauth_consent_previews;
create trigger mcp_oauth_consent_previews_immutable
before update on private.mcp_oauth_consent_previews
for each row execute function private.enforce_mcp_oauth_consent_immutability();

-- ---------------------------------------------------------------------------
-- Dynamic client registration and lookup
-- ---------------------------------------------------------------------------

drop function if exists public.register_mcp_oauth_client_as_system(
  text, text[], text, text, text
);

create or replace function public.register_mcp_oauth_client_as_system(
  p_client_name text,
  p_redirect_uris text[],
  p_scope text,
  p_scope_ceiling text[],
  p_consent_catalog_revision text,
  p_exposure_revision text,
  p_software_id text,
  p_software_version text
) returns table (
  client_id uuid,
  client_name text,
  redirect_uris text[],
  token_endpoint_auth_method text,
  grant_types text[],
  response_types text[],
  scope text,
  scope_ceiling text[],
  consent_catalog_revision text,
  exposure_revision text,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_uri text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_client_name is null or btrim(p_client_name) = ''
     or length(p_client_name) > 256 then
    raise exception 'mcp_oauth_client_name_invalid' using errcode = '22023';
  end if;
  if p_redirect_uris is null
     or cardinality(p_redirect_uris) not between 1 and 8
     or array_position(p_redirect_uris, null) is not null
     or cardinality(array(
       select distinct redirect_uri
       from unnest(p_redirect_uris) as redirect_uri
     )) <> cardinality(p_redirect_uris) then
    raise exception 'mcp_oauth_redirect_uris_invalid' using errcode = '22023';
  end if;
  foreach v_uri in array p_redirect_uris loop
    if v_uri !~ '^https://[^[:space:]]+$' then
      raise exception 'mcp_oauth_redirect_uri_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_scope is null or btrim(p_scope) = '' or length(p_scope) > 1024
     or not private.mcp_oauth_scope_array_is_valid(p_scope_ceiling)
     or p_scope is distinct from array_to_string(p_scope_ceiling, ' ')
     or private.mcp_oauth_labels_for_scopes(
       p_scope_ceiling,
       p_consent_catalog_revision
     ) is null
     or p_exposure_revision !~ '^[0-9a-z][0-9a-z._:-]{0,127}$' then
    raise exception 'mcp_oauth_scope_invalid' using errcode = '22023';
  end if;

  return query
  insert into private.mcp_oauth_clients (
    client_name,
    redirect_uris,
    token_endpoint_auth_method,
    grant_types,
    response_types,
    scope,
    scope_ceiling,
    consent_catalog_revision,
    exposure_revision,
    registration_source,
    software_id,
    software_version
  ) values (
    btrim(p_client_name),
    p_redirect_uris,
    'none',
    array['authorization_code', 'refresh_token'],
    array['code'],
    p_scope,
    p_scope_ceiling,
    p_consent_catalog_revision,
    p_exposure_revision,
    'dynamic',
    nullif(btrim(coalesce(p_software_id, '')), ''),
    nullif(btrim(coalesce(p_software_version, '')), '')
  )
  returning
    mcp_oauth_clients.client_id,
    mcp_oauth_clients.client_name,
    mcp_oauth_clients.redirect_uris,
    mcp_oauth_clients.token_endpoint_auth_method,
    mcp_oauth_clients.grant_types,
    mcp_oauth_clients.response_types,
    mcp_oauth_clients.scope,
    mcp_oauth_clients.scope_ceiling,
    mcp_oauth_clients.consent_catalog_revision,
    mcp_oauth_clients.exposure_revision,
    mcp_oauth_clients.created_at;
end;
$function$;

revoke all on function public.register_mcp_oauth_client_as_system(
  text, text[], text, text[], text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.register_mcp_oauth_client_as_system(
  text, text[], text, text[], text, text, text, text
) to service_role;

revoke all on function public.get_mcp_oauth_client_as_system(uuid)
  from public, anon, authenticated, service_role;
drop function if exists public.get_mcp_oauth_client_as_system(uuid);

create or replace function public.get_mcp_oauth_client_as_system(
  p_client_id uuid
) returns table (
  client_id uuid,
  client_name text,
  redirect_uris text[],
  token_endpoint_auth_method text,
  scope text,
  scope_ceiling text[],
  consent_catalog_revision text,
  exposure_revision text,
  disabled boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  return query
  select
    client.client_id,
    client.client_name,
    client.redirect_uris,
    client.token_endpoint_auth_method,
    client.scope,
    client.scope_ceiling,
    client.consent_catalog_revision,
    client.exposure_revision,
    client.disabled_at is not null
  from private.mcp_oauth_clients client
  where client.client_id = p_client_id;
end;
$function$;

revoke all on function public.get_mcp_oauth_client_as_system(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_mcp_oauth_client_as_system(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Exact visible-consent preview issue and one-time consume
-- ---------------------------------------------------------------------------

create or replace function public.issue_mcp_oauth_consent_preview_as_system(
  p_preview_hash text,
  p_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_redirect_uri text,
  p_response_type text,
  p_scopes text[],
  p_accepted_labels text[],
  p_consent_catalog_revision text,
  p_exposure_revision text,
  p_state text,
  p_code_challenge text,
  p_code_challenge_method text,
  p_resource text,
  p_expires_at timestamptz
) returns table (
  client_name text,
  company_name text,
  expires_at timestamptz,
  rate_limited boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_client private.mcp_oauth_clients%rowtype;
  v_company_name text;
  v_cleanup_batch integer;
  v_cleanup_deleted integer;
  v_binding_live_count integer;
  v_global_live_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$'
     or p_client_id is null
     or p_user_id is null
     or p_company_id is null
     or p_redirect_uri is null
     or length(p_redirect_uri) not between 1 and 2048
     or p_response_type is distinct from 'code'
     or not private.mcp_oauth_scope_array_is_valid(p_scopes)
     or cardinality(p_accepted_labels) <> cardinality(p_scopes)
     or p_accepted_labels is distinct from
       private.mcp_oauth_labels_for_scopes(
         p_scopes,
         p_consent_catalog_revision
       )
     or p_exposure_revision !~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
     or (
       p_state is not null
       and (length(p_state) > 2048 or p_state ~ '[[:cntrl:]]')
     )
     or p_code_challenge is null
     or p_code_challenge !~ '^[A-Za-z0-9._~-]{43,128}$'
     or p_code_challenge_method is distinct from 'S256'
     or p_resource is null
     or length(p_resource) not between 1 and 2048
     or p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'mcp_oauth_consent_preview_invalid'
      using errcode = '22023';
  end if;

  select client.*
  into v_client
  from private.mcp_oauth_clients client
  where client.client_id = p_client_id
    and client.disabled_at is null
    and p_redirect_uri = any (client.redirect_uris)
    and p_scopes <@ client.scope_ceiling
    and client.consent_catalog_revision = p_consent_catalog_revision
    and client.exposure_revision = p_exposure_revision
  for share;
  if not found then
    return;
  end if;
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    return;
  end if;
  select coalesce(nullif(btrim(company.name), ''), '—')
  into v_company_name
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;
  if not found then
    return;
  end if;

  -- The database is the durable authority for both the per-actor/company
  -- issuance ceiling and the global live-row cardinality ceiling. A fixed
  -- lock serializes the global count/insert boundary; the binding lock makes
  -- the narrower policy explicit and stable for future partitioning.
  perform pg_catalog.pg_advisory_xact_lock(638416, 1);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || p_company_id::text,
      638416
    )
  );

  -- Cleanup is bounded per request, but can catch up by deleting eight
  -- ordered index batches. Consumed previews naturally become eligible at
  -- their five-minute expiry and never require an unindexed consumed scan.
  for v_cleanup_batch in 1..8 loop
    delete from private.mcp_oauth_consent_previews preview
    using (
      select expired.preview_hash
      from private.mcp_oauth_consent_previews expired
      where expired.expires_at <= statement_timestamp()
      order by expired.expires_at, expired.preview_hash
      limit 64
      for update skip locked
    ) expired
    where preview.preview_hash = expired.preview_hash;

    get diagnostics v_cleanup_deleted = row_count;
    exit when v_cleanup_deleted < 64;
  end loop;

  select pg_catalog.count(*)::integer
  into v_binding_live_count
  from (
    select 1
    from private.mcp_oauth_consent_previews preview
    where preview.user_id = p_user_id
      and preview.company_id = p_company_id
      and preview.expires_at > statement_timestamp()
    order by preview.expires_at, preview.preview_hash
    limit 31
  ) bounded_binding;

  select pg_catalog.count(*)::integer
  into v_global_live_count
  from (
    select 1
    from private.mcp_oauth_consent_previews preview
    where preview.expires_at > statement_timestamp()
    order by preview.expires_at, preview.preview_hash
    limit 4097
  ) bounded_global;

  if v_binding_live_count >= 30 or v_global_live_count >= 4096 then
    return query
    select v_client.client_name, v_company_name, p_expires_at, true;
    return;
  end if;

  insert into private.mcp_oauth_consent_previews (
    preview_hash,
    client_id,
    user_id,
    company_id,
    client_name,
    company_name,
    redirect_uri,
    response_type,
    scopes,
    accepted_labels,
    consent_catalog_revision,
    exposure_revision,
    state,
    code_challenge,
    code_challenge_method,
    resource,
    expires_at
  ) values (
    p_preview_hash,
    p_client_id,
    p_user_id,
    p_company_id,
    v_client.client_name,
    v_company_name,
    p_redirect_uri,
    p_response_type,
    p_scopes,
    p_accepted_labels,
    p_consent_catalog_revision,
    p_exposure_revision,
    p_state,
    p_code_challenge,
    p_code_challenge_method,
    p_resource,
    p_expires_at
  );

  return query
  select v_client.client_name, v_company_name, p_expires_at, false;
end;
$function$;

revoke all on function public.issue_mcp_oauth_consent_preview_as_system(
  text, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text,
  text, text, timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.issue_mcp_oauth_consent_preview_as_system(
  text, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text,
  text, text, timestamp with time zone
) to service_role;

create or replace function public.consume_mcp_oauth_consent_preview_as_system(
  p_preview_hash text,
  p_user_id uuid,
  p_company_id uuid
) returns table (
  client_id uuid,
  user_id uuid,
  company_id uuid,
  client_name text,
  company_name text,
  redirect_uri text,
  response_type text,
  scopes text[],
  accepted_labels text[],
  consent_catalog_revision text,
  exposure_revision text,
  state text,
  code_challenge text,
  code_challenge_method text,
  resource text,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$'
     or p_user_id is null or p_company_id is null then
    raise exception 'mcp_oauth_consent_preview_invalid'
      using errcode = '22023';
  end if;

  return query
  update private.mcp_oauth_consent_previews preview
  set consumed_at = statement_timestamp()
  where preview.preview_hash = p_preview_hash
    and preview.user_id = p_user_id
    and preview.company_id = p_company_id
    and preview.consumed_at is null
    and preview.expires_at > statement_timestamp()
  returning
    preview.client_id,
    preview.user_id,
    preview.company_id,
    preview.client_name,
    preview.company_name,
    preview.redirect_uri,
    preview.response_type,
    preview.scopes,
    preview.accepted_labels,
    preview.consent_catalog_revision,
    preview.exposure_revision,
    preview.state,
    preview.code_challenge,
    preview.code_challenge_method,
    preview.resource,
    preview.expires_at;
end;
$function$;

revoke all on function public.consume_mcp_oauth_consent_preview_as_system(
  text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.consume_mcp_oauth_consent_preview_as_system(
  text, uuid, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- Authorization code consent snapshot
-- ---------------------------------------------------------------------------

drop function if exists public.create_mcp_oauth_authorization_code_as_system(
  text, uuid, uuid, uuid, text[], text, text, text, timestamptz
);

create or replace function public.create_mcp_oauth_authorization_code_as_system(
  p_code_hash text,
  p_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_scopes text[],
  p_accepted_labels text[],
  p_consent_catalog_revision text,
  p_exposure_revision text,
  p_redirect_uri text,
  p_code_challenge text,
  p_resource text,
  p_expires_at timestamptz
) returns void
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_client private.mcp_oauth_clients%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select client.*
  into v_client
  from private.mcp_oauth_clients client
  where client.client_id = p_client_id
    and client.disabled_at is null
    and p_redirect_uri = any (client.redirect_uris)
    and client.consent_catalog_revision = p_consent_catalog_revision
    and client.exposure_revision = p_exposure_revision
  for share;
  if not found then
    raise exception 'mcp_oauth_client_unavailable' using errcode = '22023';
  end if;
  if not private.mcp_oauth_scope_array_is_valid(p_scopes)
     or not (p_scopes <@ v_client.scope_ceiling)
     or cardinality(p_accepted_labels) <> cardinality(p_scopes)
     or p_accepted_labels is distinct from
       private.mcp_oauth_labels_for_scopes(
         p_scopes,
         p_consent_catalog_revision
       )
     or p_exposure_revision !~ '^[0-9a-z][0-9a-z._:-]{0,127}$' then
    raise exception 'mcp_oauth_scope_invalid' using errcode = '22023';
  end if;
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    raise exception 'mcp_oauth_actor_unavailable' using errcode = '22023';
  end if;
  if p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '10 minutes' then
    raise exception 'mcp_oauth_code_expiry_invalid' using errcode = '22023';
  end if;

  perform private.prune_expired_mcp_oauth_artifacts();

  insert into private.mcp_oauth_authorization_codes (
    code_hash,
    client_id,
    user_id,
    company_id,
    scopes,
    accepted_labels,
    consent_catalog_revision,
    exposure_revision,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    resource,
    expires_at
  ) values (
    p_code_hash,
    p_client_id,
    p_user_id,
    p_company_id,
    p_scopes,
    p_accepted_labels,
    p_consent_catalog_revision,
    p_exposure_revision,
    p_redirect_uri,
    p_code_challenge,
    'S256',
    p_resource,
    p_expires_at
  );
end;
$function$;

revoke all on function public.create_mcp_oauth_authorization_code_as_system(
  text, uuid, uuid, uuid, text[], text[], text, text, text, text, text,
  timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.create_mcp_oauth_authorization_code_as_system(
  text, uuid, uuid, uuid, text[], text[], text, text, text, text, text,
  timestamp with time zone
) to service_role;

revoke all on function public.consume_mcp_oauth_authorization_code_as_system(
  text, uuid, text
) from public, anon, authenticated, service_role;
drop function if exists public.consume_mcp_oauth_authorization_code_as_system(
  text, uuid, text
);

create or replace function public.consume_mcp_oauth_authorization_code_as_system(
  p_code_hash text,
  p_client_id uuid,
  p_redirect_uri text
) returns table (
  user_id uuid,
  company_id uuid,
  scopes text[],
  accepted_labels text[],
  consent_catalog_revision text,
  exposure_revision text,
  code_challenge text,
  resource text
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_replayed_grant_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select code.minted_grant_id
  into v_replayed_grant_id
  from private.mcp_oauth_authorization_codes code
  where code.code_hash = p_code_hash
    and code.consumed_at is not null;
  if found then
    if v_replayed_grant_id is not null then
      update private.mcp_oauth_grants grants
      set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
      where grants.id = v_replayed_grant_id;
      update private.mcp_oauth_tokens tokens
      set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
      where tokens.grant_id = v_replayed_grant_id;
    end if;
    return;
  end if;

  return query
  update private.mcp_oauth_authorization_codes code
  set consumed_at = statement_timestamp()
  where code.code_hash = p_code_hash
    and code.client_id = p_client_id
    and code.redirect_uri = p_redirect_uri
    and code.consumed_at is null
    and code.expires_at > statement_timestamp()
  returning
    code.user_id,
    code.company_id,
    code.scopes,
    code.accepted_labels,
    code.consent_catalog_revision,
    code.exposure_revision,
    code.code_challenge,
    code.resource;
end;
$function$;

revoke all on function public.consume_mcp_oauth_authorization_code_as_system(
  text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.consume_mcp_oauth_authorization_code_as_system(
  text, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Grant mint copies authority only from the consumed code
-- ---------------------------------------------------------------------------

drop function if exists public.mint_mcp_oauth_grant_as_system(
  text, uuid, uuid, uuid, text[], text, text, text, text, timestamptz, timestamptz
);

create or replace function public.mint_mcp_oauth_grant_as_system(
  p_code_hash text,
  p_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_active_exposure_revision text,
  p_active_grantable_scopes text[],
  p_access_hash text,
  p_refresh_hash text,
  p_issuer text,
  p_audience text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
) returns table (
  grant_id uuid,
  revision text
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_code record;
  v_grant_id uuid;
  v_revision text;
  v_family_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select
    code.scopes,
    code.accepted_labels,
    code.consent_catalog_revision,
    code.exposure_revision,
    code.resource
  into v_code
  from private.mcp_oauth_authorization_codes code
  where code.code_hash = p_code_hash
    and code.client_id = p_client_id
    and code.user_id = p_user_id
    and code.company_id = p_company_id
    and code.consumed_at is not null
    and code.minted_grant_id is null
    and code.expires_at > statement_timestamp()
    and code.exposure_revision = p_active_exposure_revision
    and code.scopes <@ p_active_grantable_scopes
  for update;
  if not found then
    raise exception 'mcp_oauth_code_unavailable' using errcode = '22023';
  end if;
  if p_audience is distinct from v_code.resource then
    raise exception 'mcp_oauth_audience_invalid' using errcode = '22023';
  end if;
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    raise exception 'mcp_oauth_actor_unavailable' using errcode = '22023';
  end if;
  if p_access_hash is null or p_access_hash !~ '^[0-9a-f]{64}$'
     or p_refresh_hash is null or p_refresh_hash !~ '^[0-9a-f]{64}$'
     or p_access_hash = p_refresh_hash then
    raise exception 'mcp_oauth_token_hash_invalid' using errcode = '22023';
  end if;

  update private.mcp_oauth_grants grants
  set revoked_at = statement_timestamp()
  where grants.user_id = p_user_id
    and grants.company_id = p_company_id
    and grants.client_id = p_client_id
    and grants.revoked_at is null;
  update private.mcp_oauth_tokens tokens
  set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
  from private.mcp_oauth_grants grants
  where tokens.grant_id = grants.id
    and grants.user_id = p_user_id
    and grants.company_id = p_company_id
    and grants.client_id = p_client_id
    and grants.revoked_at is not null
    and tokens.revoked_at is null;

  v_revision := replace(gen_random_uuid()::text, '-', '');
  v_family_id := gen_random_uuid();
  insert into private.mcp_oauth_grants (
    user_id,
    company_id,
    client_id,
    scopes,
    accepted_labels,
    consent_catalog_revision,
    exposure_revision,
    revision
  ) values (
    p_user_id,
    p_company_id,
    p_client_id,
    v_code.scopes,
    v_code.accepted_labels,
    v_code.consent_catalog_revision,
    v_code.exposure_revision,
    v_revision
  )
  returning id into v_grant_id;

  insert into private.mcp_oauth_tokens (
    token_hash, kind, grant_id, family_id, issuer, audience, expires_at
  ) values
    (p_access_hash, 'access', v_grant_id, v_family_id, p_issuer, p_audience,
     p_access_expires_at),
    (p_refresh_hash, 'refresh', v_grant_id, v_family_id, p_issuer, p_audience,
     p_refresh_expires_at);

  update private.mcp_oauth_authorization_codes code
  set minted_grant_id = v_grant_id
  where code.code_hash = p_code_hash
    and code.minted_grant_id is null;

  return query select v_grant_id, v_revision;
end;
$function$;

revoke all on function public.mint_mcp_oauth_grant_as_system(
  text, uuid, uuid, uuid, text, text[], text, text, text, text,
  timestamp with time zone, timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.mint_mcp_oauth_grant_as_system(
  text, uuid, uuid, uuid, text, text[], text, text, text, text,
  timestamp with time zone, timestamp with time zone
) to service_role;

-- ---------------------------------------------------------------------------
-- Non-widening refresh rotation
-- ---------------------------------------------------------------------------

drop function if exists public.rotate_mcp_oauth_refresh_token_as_system(
  text, text, text, timestamptz, timestamptz
);
drop function if exists public.rotate_mcp_oauth_refresh_token_as_system(
  text, uuid, text[], text, text, timestamptz, timestamptz
);

create or replace function public.rotate_mcp_oauth_refresh_token_as_system(
  p_presented_hash text,
  p_client_id uuid,
  p_active_grantable_scopes text[],
  p_new_access_hash text,
  p_new_refresh_hash text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
) returns table (
  grant_id uuid,
  client_id uuid,
  user_id uuid,
  company_id uuid,
  scopes text[],
  accepted_labels text[],
  consent_catalog_revision text,
  exposure_revision text,
  revision text,
  issuer text,
  audience text,
  reuse_detected boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select
    tokens.token_hash,
    tokens.grant_id,
    tokens.family_id,
    tokens.issuer,
    tokens.audience,
    tokens.expires_at,
    tokens.used_at,
    tokens.revoked_at,
    grants.user_id,
    grants.company_id,
    grants.client_id,
    grants.scopes,
    grants.accepted_labels,
    grants.consent_catalog_revision,
    grants.exposure_revision,
    grants.revision,
    grants.revoked_at as grant_revoked_at,
    clients.disabled_at as client_disabled_at
  into v_token
  from private.mcp_oauth_tokens tokens
  join private.mcp_oauth_grants grants on grants.id = tokens.grant_id
  join private.mcp_oauth_clients clients on clients.client_id = grants.client_id
  where tokens.token_hash = p_presented_hash
    and tokens.kind = 'refresh'
    and clients.client_id = p_client_id
    and grants.scopes <@ clients.scope_ceiling
    and grants.scopes <@ p_active_grantable_scopes
  for update of tokens, grants;

  if not found then
    return;
  end if;
  if v_token.used_at is not null or v_token.revoked_at is not null then
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.family_id = v_token.family_id;
    update private.mcp_oauth_grants grants
    set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
    where grants.id = v_token.grant_id;
    return query select
      v_token.grant_id,
      v_token.client_id,
      v_token.user_id,
      v_token.company_id,
      v_token.scopes,
      v_token.accepted_labels,
      v_token.consent_catalog_revision,
      v_token.exposure_revision,
      v_token.revision,
      v_token.issuer,
      v_token.audience,
      true;
    return;
  end if;
  if v_token.expires_at <= statement_timestamp()
     or v_token.grant_revoked_at is not null
     or v_token.client_disabled_at is not null then
    return;
  end if;
  if p_new_access_hash is null or p_new_access_hash !~ '^[0-9a-f]{64}$'
     or p_new_refresh_hash is null or p_new_refresh_hash !~ '^[0-9a-f]{64}$'
     or p_new_access_hash = p_new_refresh_hash then
    raise exception 'mcp_oauth_token_hash_invalid' using errcode = '22023';
  end if;

  update private.mcp_oauth_tokens tokens
  set used_at = statement_timestamp(),
      rotated_to_hash = p_new_refresh_hash
  where tokens.token_hash = v_token.token_hash;

  insert into private.mcp_oauth_tokens (
    token_hash, kind, grant_id, family_id, issuer, audience, expires_at
  ) values
    (p_new_access_hash, 'access', v_token.grant_id, v_token.family_id,
     v_token.issuer, v_token.audience, p_access_expires_at),
    (p_new_refresh_hash, 'refresh', v_token.grant_id, v_token.family_id,
     v_token.issuer, v_token.audience, p_refresh_expires_at);

  update private.mcp_oauth_grants grants
  set last_used_at = statement_timestamp()
  where grants.id = v_token.grant_id;
  perform private.prune_expired_mcp_oauth_artifacts();

  return query select
    v_token.grant_id,
    v_token.client_id,
    v_token.user_id,
    v_token.company_id,
    v_token.scopes,
    v_token.accepted_labels,
    v_token.consent_catalog_revision,
    v_token.exposure_revision,
    v_token.revision,
    v_token.issuer,
    v_token.audience,
    false;
end;
$function$;

revoke all on function public.rotate_mcp_oauth_refresh_token_as_system(
  text, uuid, text[], text, text, timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.rotate_mcp_oauth_refresh_token_as_system(
  text, uuid, text[], text, text, timestamp with time zone,
  timestamp with time zone
) to service_role;

-- ---------------------------------------------------------------------------
-- Access-token resolution carries the immutable grant consent snapshot
-- ---------------------------------------------------------------------------

revoke all on function public.resolve_mcp_oauth_access_token_as_system(text)
  from public, anon, authenticated, service_role;
drop function if exists public.resolve_mcp_oauth_access_token_as_system(text);

create or replace function public.resolve_mcp_oauth_access_token_as_system(
  p_token_hash text
) returns table (
  grant_id uuid,
  client_id uuid,
  client_name text,
  user_id uuid,
  company_id uuid,
  scopes text[],
  accepted_labels text[],
  consent_catalog_revision text,
  exposure_revision text,
  revision text,
  issuer text,
  audience text,
  expires_at timestamptz,
  token_revoked boolean,
  grant_revoked boolean,
  client_disabled boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  return query
  with resolved as (
    select
      grants.id as grant_id,
      grants.client_id,
      clients.client_name,
      grants.user_id,
      grants.company_id,
      grants.scopes,
      grants.accepted_labels,
      grants.consent_catalog_revision,
      grants.exposure_revision,
      grants.revision,
      tokens.issuer,
      tokens.audience,
      tokens.expires_at,
      tokens.revoked_at is not null as token_revoked,
      grants.revoked_at is not null as grant_revoked,
      clients.disabled_at is not null as client_disabled,
      (tokens.revoked_at is null
        and grants.revoked_at is null
        and clients.disabled_at is null
        and tokens.expires_at > statement_timestamp()) as usable
    from private.mcp_oauth_tokens tokens
    join private.mcp_oauth_grants grants on grants.id = tokens.grant_id
    join private.mcp_oauth_clients clients
      on clients.client_id = grants.client_id
    where tokens.token_hash = p_token_hash
      and tokens.kind = 'access'
      and grants.scopes <@ clients.scope_ceiling
  ),
  touched as (
    update private.mcp_oauth_grants grants
    set last_used_at = statement_timestamp()
    from resolved
    where grants.id = resolved.grant_id
      and resolved.usable
    returning grants.id
  )
  select
    resolved.grant_id,
    resolved.client_id,
    resolved.client_name,
    resolved.user_id,
    resolved.company_id,
    resolved.scopes,
    resolved.accepted_labels,
    resolved.consent_catalog_revision,
    resolved.exposure_revision,
    resolved.revision,
    resolved.issuer,
    resolved.audience,
    resolved.expires_at,
    resolved.token_revoked,
    resolved.grant_revoked,
    resolved.client_disabled
  from resolved;
end;
$function$;

revoke all on function public.resolve_mcp_oauth_access_token_as_system(text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_mcp_oauth_access_token_as_system(text)
  to service_role;

-- Re-assert defence in depth after every DDL statement above. Application
-- roles receive only the reviewed public SECURITY DEFINER RPCs.
revoke all on table private.mcp_oauth_clients,
  private.mcp_oauth_authorization_codes,
  private.mcp_oauth_grants,
  private.mcp_oauth_tokens,
  private.mcp_oauth_consent_previews
from public, anon, authenticated, service_role;

-- Table-level REVOKE does not remove grants stored on pg_attribute.attacl.
-- Clear every application-role column privilege explicitly; the postflight
-- below rejects grants to any other non-owner role.
revoke all privileges (
  client_id,
  client_name,
  redirect_uris,
  token_endpoint_auth_method,
  grant_types,
  response_types,
  scope,
  registration_source,
  software_id,
  software_version,
  created_at,
  disabled_at,
  scope_ceiling,
  consent_catalog_revision,
  exposure_revision
) on table private.mcp_oauth_clients
from public, anon, authenticated, service_role;

revoke all privileges (
  code_hash,
  client_id,
  user_id,
  company_id,
  scopes,
  redirect_uri,
  code_challenge,
  code_challenge_method,
  resource,
  expires_at,
  created_at,
  consumed_at,
  minted_grant_id,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision
) on table private.mcp_oauth_authorization_codes
from public, anon, authenticated, service_role;

revoke all privileges (
  id,
  user_id,
  company_id,
  client_id,
  scopes,
  revision,
  created_at,
  last_used_at,
  revoked_at,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision
) on table private.mcp_oauth_grants
from public, anon, authenticated, service_role;

revoke all privileges (
  token_hash,
  kind,
  grant_id,
  family_id,
  issuer,
  audience,
  expires_at,
  created_at,
  rotated_to_hash,
  used_at,
  revoked_at
) on table private.mcp_oauth_tokens
from public, anon, authenticated, service_role;

revoke all privileges (
  preview_hash,
  client_id,
  user_id,
  company_id,
  client_name,
  company_name,
  redirect_uri,
  response_type,
  scopes,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision,
  state,
  code_challenge,
  code_challenge_method,
  resource,
  expires_at,
  consumed_at,
  created_at
) on table private.mcp_oauth_consent_previews
from public, anon, authenticated, service_role;

-- Fail closed if an IF NOT EXISTS object collided with the reviewed shape,
-- an RPC property drifted, or an application-role ACL survived. This audit is
-- deliberately last: PostgREST is notified only after the complete catalogue
-- is proven coherent.
do $postflight$
declare
  v_item record;
  v_actual_type text;
  v_not_null boolean;
  v_column_count integer;
  v_default_count integer;
  v_default_expression text;
  v_index_valid boolean;
  v_index_ready boolean;
  v_index_unique boolean;
  v_index_key_count smallint;
  v_index_attribute_count smallint;
  v_index_keys text[];
  v_index_method text;
  v_index_definition text;
  v_constraint_type "char";
  v_constraint_validated boolean;
  v_constraint_deferrable boolean;
  v_constraint_keys smallint[];
  v_trigger_type integer;
  v_trigger_enabled "char";
  v_trigger_function oid;
  v_function_oid oid;
  v_function_kind "char";
  v_function_volatility "char";
  v_function_security_definer boolean;
  v_function_config text[];
  v_function_acl aclitem[];
  v_function_owner oid;
  v_table_oid oid;
  v_table_kind "char";
  v_table_acl aclitem[];
  v_table_owner oid;
  v_acl_entries text[];
  v_expected_acl text[];
  v_function_signatures text[];
  v_expected_function_signatures text[];
begin
  for v_item in
    select *
    from (values
      (
        'private.mcp_oauth_clients.scope_ceiling:text[]',
        'mcp_oauth_clients',
        'scope_ceiling',
        'text[]'
      ),
      (
        'private.mcp_oauth_clients.consent_catalog_revision:text',
        'mcp_oauth_clients',
        'consent_catalog_revision',
        'text'
      ),
      (
        'private.mcp_oauth_clients.exposure_revision:text',
        'mcp_oauth_clients',
        'exposure_revision',
        'text'
      ),
      (
        'private.mcp_oauth_authorization_codes.accepted_labels:text[]',
        'mcp_oauth_authorization_codes',
        'accepted_labels',
        'text[]'
      ),
      (
        'private.mcp_oauth_authorization_codes.consent_catalog_revision:text',
        'mcp_oauth_authorization_codes',
        'consent_catalog_revision',
        'text'
      ),
      (
        'private.mcp_oauth_authorization_codes.exposure_revision:text',
        'mcp_oauth_authorization_codes',
        'exposure_revision',
        'text'
      ),
      (
        'private.mcp_oauth_grants.accepted_labels:text[]',
        'mcp_oauth_grants',
        'accepted_labels',
        'text[]'
      ),
      (
        'private.mcp_oauth_grants.consent_catalog_revision:text',
        'mcp_oauth_grants',
        'consent_catalog_revision',
        'text'
      ),
      (
        'private.mcp_oauth_grants.exposure_revision:text',
        'mcp_oauth_grants',
        'exposure_revision',
        'text'
      )
    ) as expected(identity, table_name, column_name, data_type)
  loop
    select
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull
    into v_actual_type, v_not_null
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = v_item.table_name
      and relation.relkind = 'r'
      and attribute.attname = v_item.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if not found
       or v_actual_type is distinct from v_item.data_type
       or v_not_null is distinct from true then
      raise exception 'mcp_oauth_consent_column_postflight_failed:%',
        v_item.identity;
    end if;
  end loop;

  select
    constraint_row.contype,
    constraint_row.convalidated,
    constraint_row.condeferrable,
    constraint_row.conkey
  into
    v_constraint_type,
    v_constraint_validated,
    v_constraint_deferrable,
    v_constraint_keys
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      to_regclass('private.mcp_oauth_consent_previews')
    and constraint_row.conname = 'mcp_oauth_consent_previews_pkey';
  if not found
     or v_constraint_type is distinct from 'p'::"char"
     or v_constraint_validated is distinct from true
     or v_constraint_deferrable is distinct from false
     or v_constraint_keys is distinct from array[
       (
         select attribute.attnum
         from pg_catalog.pg_attribute attribute
         where attribute.attrelid =
             to_regclass('private.mcp_oauth_consent_previews')
           and attribute.attname = 'preview_hash'
           and attribute.attnum > 0
           and not attribute.attisdropped
       )
     ]::smallint[] then
    raise exception 'mcp_oauth_consent_preview_primary_key_postflight_failed';
  end if;

  for v_item in
    select *
    from (values
      ('preview_hash', 'text', true),
      ('client_id', 'uuid', true),
      ('user_id', 'uuid', true),
      ('company_id', 'uuid', true),
      ('client_name', 'text', true),
      ('company_name', 'text', true),
      ('redirect_uri', 'text', true),
      ('response_type', 'text', true),
      ('scopes', 'text[]', true),
      ('accepted_labels', 'text[]', true),
      ('consent_catalog_revision', 'text', true),
      ('exposure_revision', 'text', true),
      ('state', 'text', false),
      ('code_challenge', 'text', true),
      ('code_challenge_method', 'text', true),
      ('resource', 'text', true),
      ('expires_at', 'timestamp with time zone', true),
      ('consumed_at', 'timestamp with time zone', false),
      ('created_at', 'timestamp with time zone', true)
    ) as expected(column_name, data_type, not_null)
  loop
    select
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull
    into v_actual_type, v_not_null
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid =
        to_regclass('private.mcp_oauth_consent_previews')
      and attribute.attname = v_item.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if not found
       or v_actual_type is distinct from v_item.data_type
       or v_not_null is distinct from v_item.not_null then
      raise exception 'mcp_oauth_consent_preview_column_postflight_failed:%',
        v_item.column_name;
    end if;
  end loop;

  select pg_catalog.count(*)::integer
  into v_column_count
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid =
      to_regclass('private.mcp_oauth_consent_previews')
    and attribute.attnum > 0
    and not attribute.attisdropped;
  if v_column_count is distinct from 19 then
    raise exception 'mcp_oauth_consent_preview_column_count_failed';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.max(
      case when attribute.attname = 'created_at' then
        pg_catalog.pg_get_expr(
          default_row.adbin,
          default_row.adrelid,
          false
        )
      end
    )
  into v_default_count, v_default_expression
  from pg_catalog.pg_attrdef default_row
  join pg_catalog.pg_attribute attribute
    on attribute.attrelid = default_row.adrelid
   and attribute.attnum = default_row.adnum
  where default_row.adrelid =
      to_regclass('private.mcp_oauth_consent_previews');
  if v_default_count is distinct from 1
     or v_default_expression is distinct from 'statement_timestamp()' then
    raise exception 'mcp_oauth_consent_preview_default_postflight_failed';
  end if;

  select pg_catalog.count(*)::integer
  into v_column_count
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      to_regclass('private.mcp_oauth_consent_previews');
  if v_column_count is distinct from 2 then
    raise exception 'mcp_oauth_consent_preview_constraint_count_failed';
  end if;

  select
    index_row.indisvalid,
    index_row.indisready,
    index_row.indisunique,
    index_row.indnkeyatts,
    index_row.indnatts,
    access_method.amname,
    pg_catalog.pg_get_indexdef(index_row.indexrelid),
    array(
      select pg_catalog.pg_get_indexdef(
        index_row.indexrelid,
        key_number,
        true
      )
      from pg_catalog.generate_series(
        1,
        index_row.indnkeyatts::integer
      ) key_number
      order by key_number
    )
  into
    v_index_valid,
    v_index_ready,
    v_index_unique,
    v_index_key_count,
    v_index_attribute_count,
    v_index_method,
    v_index_definition,
    v_index_keys
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  where index_row.indexrelid =
      to_regclass('private.mcp_oauth_consent_previews_expiry_idx')
    and index_row.indrelid =
      to_regclass('private.mcp_oauth_consent_previews')
    and index_row.indexprs is null
    and index_row.indpred is null;
  if not found
     or v_index_valid is distinct from true
     or v_index_ready is distinct from true
     or v_index_unique is distinct from false
     or v_index_key_count is distinct from 2
     or v_index_attribute_count is distinct from 2
     or v_index_method is distinct from 'btree'
     or v_index_definition is distinct from
       'CREATE INDEX mcp_oauth_consent_previews_expiry_idx ON private.mcp_oauth_consent_previews USING btree (expires_at, preview_hash)'
     or v_index_keys is distinct from array['expires_at', 'preview_hash'] then
    raise exception 'mcp_oauth_consent_preview_expiry_index_postflight_failed';
  end if;

  for v_item in
    select *
    from (values
      (
        'mcp_oauth_clients',
        'mcp_oauth_clients_scope_ceiling_valid'
      ),
      (
        'mcp_oauth_authorization_codes',
        'mcp_oauth_codes_consent_snapshot_valid'
      ),
      (
        'mcp_oauth_grants',
        'mcp_oauth_grants_consent_snapshot_valid'
      ),
      (
        'mcp_oauth_consent_previews',
        'mcp_oauth_consent_previews_snapshot_valid'
      )
    ) as expected(table_name, constraint_name)
  loop
    select
      constraint_row.contype,
      constraint_row.convalidated,
      constraint_row.condeferrable
    into
      v_constraint_type,
      v_constraint_validated,
      v_constraint_deferrable
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = v_item.table_name
      and constraint_row.conname = v_item.constraint_name;

    if not found
       or v_constraint_type is distinct from 'c'::"char"
       or v_constraint_validated is distinct from true
       or v_constraint_deferrable is distinct from false then
      raise exception 'mcp_oauth_consent_constraint_postflight_failed:%',
        v_item.constraint_name;
    end if;
  end loop;

  v_expected_function_signatures := array[
    'private.mcp_oauth_scope_array(text)',
    'private.mcp_oauth_scope_array_is_valid(text[])',
    'private.mcp_oauth_labels_for_scopes(text[],text)',
    'private.enforce_mcp_oauth_consent_immutability()',
    'public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)',
    'public.get_mcp_oauth_client_as_system(uuid)',
    'public.issue_mcp_oauth_consent_preview_as_system(text,uuid,uuid,uuid,text,text,text[],text[],text,text,text,text,text,text,timestamp with time zone)',
    'public.consume_mcp_oauth_consent_preview_as_system(text,uuid,uuid)',
    'public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text[],text,text,text,text,text,timestamp with time zone)',
    'public.consume_mcp_oauth_authorization_code_as_system(text,uuid,text)',
    'public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)',
    'public.resolve_mcp_oauth_access_token_as_system(text)'
  ]::text[];
  select pg_catalog.array_agg(expected.signature order by expected.signature)
  into v_expected_function_signatures
  from pg_catalog.unnest(v_expected_function_signatures) expected(signature);

  select coalesce(
    pg_catalog.array_agg(
      namespace.nspname || '.' || function_row.proname || '(' ||
      pg_catalog.regexp_replace(
        pg_catalog.oidvectortypes(function_row.proargtypes),
        ',[[:space:]]*',
        ',',
        'g'
      ) || ')'
      order by namespace.nspname, function_row.proname,
        function_row.proargtypes::text
    ),
    array[]::text[]
  )
  into v_function_signatures
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where (
    namespace.nspname = 'private'
    and function_row.proname in (
      'mcp_oauth_scope_array',
      'mcp_oauth_scope_array_is_valid',
      'mcp_oauth_labels_for_scopes',
      'enforce_mcp_oauth_consent_immutability'
    )
  ) or (
    namespace.nspname = 'public'
    and function_row.proname in (
      'register_mcp_oauth_client_as_system',
      'get_mcp_oauth_client_as_system',
      'issue_mcp_oauth_consent_preview_as_system',
      'consume_mcp_oauth_consent_preview_as_system',
      'create_mcp_oauth_authorization_code_as_system',
      'consume_mcp_oauth_authorization_code_as_system',
      'mint_mcp_oauth_grant_as_system',
      'rotate_mcp_oauth_refresh_token_as_system',
      'resolve_mcp_oauth_access_token_as_system'
    )
  );
  if v_function_signatures is distinct from
      v_expected_function_signatures then
    raise exception 'mcp_oauth_consent_function_signature_set_failed';
  end if;

  for v_item in
    select *
    from (values
      (
        'mcp_oauth_clients',
        'mcp_oauth_clients_immutable_ceiling'
      ),
      (
        'mcp_oauth_authorization_codes',
        'mcp_oauth_codes_immutable_consent'
      ),
      (
        'mcp_oauth_grants',
        'mcp_oauth_grants_immutable_consent'
      ),
      (
        'mcp_oauth_consent_previews',
        'mcp_oauth_consent_previews_immutable'
      )
    ) as expected(table_name, trigger_name)
  loop
    select
      trigger_row.tgtype::integer,
      trigger_row.tgenabled,
      trigger_row.tgfoid
    into v_trigger_type, v_trigger_enabled, v_trigger_function
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation
      on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = v_item.table_name
      and trigger_row.tgname = v_item.trigger_name
      and not trigger_row.tgisinternal;

    if not found
       or v_trigger_type is distinct from 19
       or v_trigger_enabled is distinct from 'O'::"char"
       or v_trigger_function is distinct from
         to_regprocedure(
           'private.enforce_mcp_oauth_consent_immutability()'
         )::oid then
      raise exception 'mcp_oauth_consent_trigger_postflight_failed:%',
        v_item.trigger_name;
    end if;
  end loop;

  for v_item in
    select *
    from (values
      (
        'private.mcp_oauth_scope_array(text)',
        'i',
        false,
        'pg_catalog,pg_temp',
        false
      ),
      (
        'private.mcp_oauth_scope_array_is_valid(text[])',
        'i',
        false,
        'pg_catalog,pg_temp',
        false
      ),
      (
        'private.mcp_oauth_labels_for_scopes(text[],text)',
        'i',
        false,
        'pg_catalog,pg_temp',
        false
      ),
      (
        'private.enforce_mcp_oauth_consent_immutability()',
        'v',
        true,
        'pg_catalog,private,pg_temp',
        false
      ),
      (
        'public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)',
        'v',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      ),
      (
        'public.get_mcp_oauth_client_as_system(uuid)',
        's',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      ),
      (
        'public.issue_mcp_oauth_consent_preview_as_system(text,uuid,uuid,uuid,text,text,text[],text[],text,text,text,text,text,text,timestamp with time zone)',
        'v',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      ),
      (
        'public.consume_mcp_oauth_consent_preview_as_system(text,uuid,uuid)',
        'v',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      ),
      (
        'public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text[],text,text,text,text,text,timestamp with time zone)',
        'v',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      ),
      (
        'public.consume_mcp_oauth_authorization_code_as_system(text,uuid,text)',
        'v',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      ),
      (
        'public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)',
        'v',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      ),
      (
        'public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)',
        'v',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      ),
      (
        'public.resolve_mcp_oauth_access_token_as_system(text)',
        'v',
        true,
        'pg_catalog,public,private,pg_temp',
        true
      )
    ) as expected(
      signature,
      volatility,
      security_definer,
      search_path,
      service_execute
    )
  loop
    v_function_oid := to_regprocedure(v_item.signature)::oid;
    if v_function_oid is null then
      raise exception 'mcp_oauth_consent_function_missing:%',
        v_item.signature;
    end if;

    select
      function_row.prokind,
      function_row.provolatile,
      function_row.prosecdef,
      function_row.proconfig,
      function_row.proacl,
      function_row.proowner
    into
      v_function_kind,
      v_function_volatility,
      v_function_security_definer,
      v_function_config,
      v_function_acl,
      v_function_owner
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_function_oid;

    if not found
       or v_function_kind is distinct from 'f'::"char"
       or v_function_volatility is distinct from
         v_item.volatility::"char"
       or v_function_security_definer is distinct from
         v_item.security_definer
       or cardinality(v_function_config) is distinct from 1
       or pg_catalog.regexp_replace(
         v_function_config[1],
         '[[:space:]]+',
         '',
         'g'
       ) is distinct from 'search_path=' || v_item.search_path then
      raise exception 'mcp_oauth_consent_function_shape_failed:%',
        v_item.signature;
    end if;

    select coalesce(
      array_agg(app_acl.entry order by app_acl.entry),
      array[]::text[]
    )
    into v_acl_entries
    from (
      select distinct
        case
          when acl.grantee = 0 then 'PUBLIC'
          else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
        end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as entry
      from pg_catalog.aclexplode(
        coalesce(
          v_function_acl,
          pg_catalog.acldefault('f', v_function_owner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where acl.grantee <> v_function_owner
    ) app_acl;

    v_expected_acl := case
      when v_item.service_execute then
        array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;

    if v_acl_entries is distinct from v_expected_acl
       or has_function_privilege(
         'anon',
         v_function_oid,
         'EXECUTE'
       )
       or has_function_privilege(
         'authenticated',
         v_function_oid,
         'EXECUTE'
       )
       or has_function_privilege(
         'service_role',
         v_function_oid,
         'EXECUTE'
       ) is distinct from v_item.service_execute then
      raise exception 'mcp_oauth_consent_function_acl_failed:%',
        v_item.signature;
    end if;
  end loop;

  for v_item in
    select table_name
    from (values
      ('mcp_oauth_clients'),
      ('mcp_oauth_authorization_codes'),
      ('mcp_oauth_grants'),
      ('mcp_oauth_tokens'),
      ('mcp_oauth_consent_previews')
    ) as expected(table_name)
  loop
    v_table_oid := to_regclass('private.' || v_item.table_name)::oid;
    if v_table_oid is null then
      raise exception 'mcp_oauth_consent_table_missing:%', v_item.table_name;
    end if;

    select relation.relkind, relation.relacl, relation.relowner
    into v_table_kind, v_table_acl, v_table_owner
    from pg_catalog.pg_class relation
    where relation.oid = v_table_oid;

    select coalesce(
      array_agg(app_acl.entry order by app_acl.entry),
      array[]::text[]
    )
    into v_acl_entries
    from (
      select distinct
        case
          when acl.grantee = 0 then 'PUBLIC'
          else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
        end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as entry
      from pg_catalog.aclexplode(
        coalesce(v_table_acl, pg_catalog.acldefault('r', v_table_owner))
      ) acl
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where acl.grantee <> v_table_owner
    ) app_acl;

    if v_table_kind is distinct from 'r'::"char"
       or v_acl_entries is distinct from array[]::text[]
       or has_table_privilege(
         'anon',
         v_table_oid,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
       or has_table_privilege(
         'authenticated',
         v_table_oid,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
       or has_table_privilege(
         'service_role',
         v_table_oid,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       ) then
      raise exception 'mcp_oauth_consent_table_acl_failed:%',
        v_item.table_name;
    end if;
  end loop;

  for v_item in
    select signature
    from (values
      (
        'public.register_mcp_oauth_client_as_system(text,text[],text,text,text)'
      ),
      (
        'public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text,text,text,timestamp with time zone)'
      ),
      (
        'public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)'
      ),
      (
        'public.rotate_mcp_oauth_refresh_token_as_system(text,text,text,timestamp with time zone,timestamp with time zone)'
      )
    ) as obsolete(signature)
  loop
    if to_regprocedure(v_item.signature) is not null then
      raise exception 'mcp_oauth_consent_obsolete_rpc_survived:%',
        v_item.signature;
    end if;
  end loop;
end;
$postflight$;

-- Closed-world replay audit. The targeted migration above rebuilds every
-- mutable definition, then this catalogue proves that no same-name legacy
-- object, extra trigger, overload, rule, column, constraint, or index remains.
do $closed_world$
declare
  v_item record;
  v_oid oid;
  v_actual_text text;
  v_actual_texts text[];
  v_expected_texts text[];
  v_acl_entries text[];
  v_function_acl aclitem[];
  v_function_owner oid;
  v_table_acl aclitem[];
  v_table_owner oid;
  v_index_keys text[];
  v_index_predicate text;
begin
  -- Exact OAuth function vocabulary: no stale overload can survive replay.
  v_expected_texts := array[
    'private.enforce_mcp_oauth_consent_immutability()',
    'private.mcp_oauth_labels_for_scopes(text[],text)',
    'private.mcp_oauth_scope_array(text)',
    'private.mcp_oauth_scope_array_is_valid(text[])',
    'private.prune_expired_mcp_oauth_artifacts()',
    'public.consume_mcp_oauth_authorization_code_as_system(text,uuid,text)',
    'public.consume_mcp_oauth_consent_preview_as_system(text,uuid,uuid)',
    'public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text[],text,text,text,text,text,timestamp with time zone)',
    'public.get_mcp_oauth_client_as_system(uuid)',
    'public.issue_mcp_oauth_consent_preview_as_system(text,uuid,uuid,uuid,text,text,text[],text[],text,text,text,text,text,text,timestamp with time zone)',
    'public.list_mcp_oauth_grants_for_user_as_system(uuid,uuid)',
    'public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)',
    'public.resolve_mcp_oauth_access_token_as_system(text)',
    'public.revoke_mcp_oauth_grant_as_system(uuid,uuid)',
    'public.revoke_mcp_oauth_token_as_system(text)',
    'public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)'
  ]::text[];

  select coalesce(
    pg_catalog.array_agg(
      namespace.nspname || '.' || function_row.proname || '(' ||
      pg_catalog.regexp_replace(
        pg_catalog.oidvectortypes(function_row.proargtypes),
        ',[[:space:]]*',
        ',',
        'g'
      ) || ')'
      order by namespace.nspname, function_row.proname,
        function_row.proargtypes::text
    ),
    array[]::text[]
  )
  into v_actual_texts
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where (
    namespace.nspname = 'private'
    and function_row.proname in (
      'enforce_mcp_oauth_consent_immutability',
      'mcp_oauth_labels_for_scopes',
      'mcp_oauth_scope_array',
      'mcp_oauth_scope_array_is_valid',
      'prune_expired_mcp_oauth_artifacts'
    )
  ) or (
    namespace.nspname = 'public'
    and function_row.proname in (
      'consume_mcp_oauth_authorization_code_as_system',
      'consume_mcp_oauth_consent_preview_as_system',
      'create_mcp_oauth_authorization_code_as_system',
      'get_mcp_oauth_client_as_system',
      'issue_mcp_oauth_consent_preview_as_system',
      'list_mcp_oauth_grants_for_user_as_system',
      'mint_mcp_oauth_grant_as_system',
      'register_mcp_oauth_client_as_system',
      'resolve_mcp_oauth_access_token_as_system',
      'revoke_mcp_oauth_grant_as_system',
      'revoke_mcp_oauth_token_as_system',
      'rotate_mcp_oauth_refresh_token_as_system'
    )
  );
  if v_actual_texts is distinct from v_expected_texts then
    raise exception 'mcp_oauth_consent_function_signature_set_failed';
  end if;

  for v_item in
    select *
    from (values
      ('private.enforce_mcp_oauth_consent_immutability()', 'plpgsql', false, 'u', true, 'v', 'trigger', 'pg_catalog,private,pg_temp', false),
      ('private.mcp_oauth_labels_for_scopes(text[],text)', 'sql', false, 'u', false, 'i', 'text[]', 'pg_catalog,pg_temp', false),
      ('private.mcp_oauth_scope_array(text)', 'sql', true, 'u', false, 'i', 'text[]', 'pg_catalog,pg_temp', false),
      ('private.mcp_oauth_scope_array_is_valid(text[])', 'sql', false, 'u', false, 'i', 'boolean', 'pg_catalog,pg_temp', false),
      ('private.prune_expired_mcp_oauth_artifacts()', 'sql', false, 'u', true, 'v', 'void', 'pg_catalog,private,pg_temp', false),
      ('public.consume_mcp_oauth_authorization_code_as_system(text,uuid,text)', 'plpgsql', false, 'u', true, 'v', 'TABLE(user_id uuid,company_id uuid,scopes text[],accepted_labels text[],consent_catalog_revision text,exposure_revision text,code_challenge text,resource text)', 'pg_catalog,public,private,pg_temp', true),
      ('public.consume_mcp_oauth_consent_preview_as_system(text,uuid,uuid)', 'plpgsql', false, 'u', true, 'v', 'TABLE(client_id uuid,user_id uuid,company_id uuid,client_name text,company_name text,redirect_uri text,response_type text,scopes text[],accepted_labels text[],consent_catalog_revision text,exposure_revision text,state text,code_challenge text,code_challenge_method text,resource text,expires_at timestamp with time zone)', 'pg_catalog,public,private,pg_temp', true),
      ('public.create_mcp_oauth_authorization_code_as_system(text,uuid,uuid,uuid,text[],text[],text,text,text,text,text,timestamp with time zone)', 'plpgsql', false, 'u', true, 'v', 'void', 'pg_catalog,public,private,pg_temp', true),
      ('public.get_mcp_oauth_client_as_system(uuid)', 'plpgsql', false, 'u', true, 's', 'TABLE(client_id uuid,client_name text,redirect_uris text[],token_endpoint_auth_method text,scope text,scope_ceiling text[],consent_catalog_revision text,exposure_revision text,disabled boolean)', 'pg_catalog,public,private,pg_temp', true),
      ('public.issue_mcp_oauth_consent_preview_as_system(text,uuid,uuid,uuid,text,text,text[],text[],text,text,text,text,text,text,timestamp with time zone)', 'plpgsql', false, 'u', true, 'v', 'TABLE(client_name text,company_name text,expires_at timestamp with time zone,rate_limited boolean)', 'pg_catalog,public,private,pg_temp', true),
      ('public.list_mcp_oauth_grants_for_user_as_system(uuid,uuid)', 'plpgsql', false, 'u', true, 's', 'TABLE(grant_id uuid,client_name text,scopes text[],created_at timestamp with time zone,last_used_at timestamp with time zone)', 'pg_catalog,public,private,pg_temp', true),
      ('public.mint_mcp_oauth_grant_as_system(text,uuid,uuid,uuid,text,text[],text,text,text,text,timestamp with time zone,timestamp with time zone)', 'plpgsql', false, 'u', true, 'v', 'TABLE(grant_id uuid,revision text)', 'pg_catalog,public,private,pg_temp', true),
      ('public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)', 'plpgsql', false, 'u', true, 'v', 'TABLE(client_id uuid,client_name text,redirect_uris text[],token_endpoint_auth_method text,grant_types text[],response_types text[],scope text,scope_ceiling text[],consent_catalog_revision text,exposure_revision text,created_at timestamp with time zone)', 'pg_catalog,public,private,pg_temp', true),
      ('public.resolve_mcp_oauth_access_token_as_system(text)', 'plpgsql', false, 'u', true, 'v', 'TABLE(grant_id uuid,client_id uuid,client_name text,user_id uuid,company_id uuid,scopes text[],accepted_labels text[],consent_catalog_revision text,exposure_revision text,revision text,issuer text,audience text,expires_at timestamp with time zone,token_revoked boolean,grant_revoked boolean,client_disabled boolean)', 'pg_catalog,public,private,pg_temp', true),
      ('public.revoke_mcp_oauth_grant_as_system(uuid,uuid)', 'plpgsql', false, 'u', true, 'v', 'boolean', 'pg_catalog,public,private,pg_temp', true),
      ('public.revoke_mcp_oauth_token_as_system(text)', 'plpgsql', false, 'u', true, 'v', 'boolean', 'pg_catalog,public,private,pg_temp', true),
      ('public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)', 'plpgsql', false, 'u', true, 'v', 'TABLE(grant_id uuid,client_id uuid,user_id uuid,company_id uuid,scopes text[],accepted_labels text[],consent_catalog_revision text,exposure_revision text,revision text,issuer text,audience text,reuse_detected boolean)', 'pg_catalog,public,private,pg_temp', true)
    ) as expected(
      signature,
      language_name,
      is_strict,
      parallel_safety,
      security_definer,
      volatility,
      result_type,
      search_path,
      service_execute
    )
  loop
    v_oid := to_regprocedure(v_item.signature)::oid;
    select
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_function_result(function_row.oid),
          '[[:space:]]+',
          ' ',
          'g'
        ),
        ',[[:space:]]*',
        ',',
        'g'
      ),
      function_row.proacl,
      function_row.proowner
    into v_actual_text, v_function_acl, v_function_owner
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid = v_oid
      and function_row.proowner = current_user::regrole
      and language_row.lanname = v_item.language_name
      and function_row.prokind = 'f'::"char"
      and function_row.proisstrict = v_item.is_strict
      and function_row.proparallel = v_item.parallel_safety::"char"
      and function_row.prosecdef = v_item.security_definer
      and function_row.provolatile = v_item.volatility::"char"
      and cardinality(function_row.proconfig) = 1
      and pg_catalog.regexp_replace(
        function_row.proconfig[1],
        '[[:space:]]+',
        '',
        'g'
      ) = 'search_path=' || v_item.search_path;

    if not found or v_actual_text is distinct from v_item.result_type then
      raise exception 'mcp_oauth_consent_function_shape_failed:%',
        v_item.signature;
    end if;

    select coalesce(
      pg_catalog.array_agg(app_acl.entry order by app_acl.entry),
      array[]::text[]
    )
    into v_acl_entries
    from (
      select distinct
        case
          when acl.grantee = 0 then 'PUBLIC'
          else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
        end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as entry
      from pg_catalog.aclexplode(
        coalesce(
          v_function_acl,
          pg_catalog.acldefault('f', v_function_owner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where acl.grantee <> v_function_owner
    ) app_acl;
    v_expected_texts := case
      when v_item.service_execute then
        array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected_texts then
      raise exception 'mcp_oauth_consent_function_acl_failed:%',
        v_item.signature;
    end if;
  end loop;

  -- Exact permanent ordinary-table shape and ownership.
  for v_item in
    select *
    from (values
      ('mcp_oauth_clients', array[
        '1:client_id:uuid:true:::gen_random_uuid()',
        '2:client_name:text:true:::<none>',
        '3:redirect_uris:text[]:true:::<none>',
        '4:token_endpoint_auth_method:text:true:::<none>',
        '5:grant_types:text[]:true:::<none>',
        '6:response_types:text[]:true:::<none>',
        '7:scope:text:true:::<none>',
        '8:registration_source:text:true:::<none>',
        '9:software_id:text:false:::<none>',
        '10:software_version:text:false:::<none>',
        '11:created_at:timestamp with time zone:true:::statement_timestamp()',
        '12:disabled_at:timestamp with time zone:false:::<none>',
        '13:scope_ceiling:text[]:true:::<none>',
        '14:consent_catalog_revision:text:true:::<none>',
        '15:exposure_revision:text:true:::<none>'
      ]::text[], array[
        'mcp_oauth_clients_name_bounded:c:false',
        'mcp_oauth_clients_pkey:p:true',
        'mcp_oauth_clients_public_only:c:false',
        'mcp_oauth_clients_redirect_uris_present:c:false',
        'mcp_oauth_clients_registration_source:c:false',
        'mcp_oauth_clients_scope_ceiling_valid:c:false'
      ]::text[], array['mcp_oauth_clients_pkey']::text[],
        array['mcp_oauth_clients_immutable_ceiling']::text[]),
      ('mcp_oauth_authorization_codes', array[
        '1:code_hash:text:true:::<none>',
        '2:client_id:uuid:true:::<none>',
        '3:user_id:uuid:true:::<none>',
        '4:company_id:uuid:true:::<none>',
        '5:scopes:text[]:true:::<none>',
        '6:redirect_uri:text:true:::<none>',
        '7:code_challenge:text:true:::<none>',
        '8:code_challenge_method:text:true:::<none>',
        '9:resource:text:true:::<none>',
        '10:expires_at:timestamp with time zone:true:::<none>',
        '11:created_at:timestamp with time zone:true:::statement_timestamp()',
        '12:consumed_at:timestamp with time zone:false:::<none>',
        '13:minted_grant_id:uuid:false:::<none>',
        '14:accepted_labels:text[]:true:::<none>',
        '15:consent_catalog_revision:text:true:::<none>',
        '16:exposure_revision:text:true:::<none>'
      ]::text[], array[
        'mcp_oauth_authorization_codes_client_id_fkey:f:true',
        'mcp_oauth_authorization_codes_pkey:p:true',
        'mcp_oauth_codes_challenge_method:c:false',
        'mcp_oauth_codes_challenge_shape:c:false',
        'mcp_oauth_codes_consent_snapshot_valid:c:false',
        'mcp_oauth_codes_hash_shape:c:false',
        'mcp_oauth_codes_scopes_present:c:false'
      ]::text[], array['mcp_oauth_authorization_codes_pkey']::text[],
        array['mcp_oauth_codes_immutable_consent']::text[]),
      ('mcp_oauth_grants', array[
        '1:id:uuid:true:::gen_random_uuid()',
        '2:user_id:uuid:true:::<none>',
        '3:company_id:uuid:true:::<none>',
        '4:client_id:uuid:true:::<none>',
        '5:scopes:text[]:true:::<none>',
        '6:revision:text:true:::<none>',
        '7:created_at:timestamp with time zone:true:::statement_timestamp()',
        '8:last_used_at:timestamp with time zone:false:::<none>',
        '9:revoked_at:timestamp with time zone:false:::<none>',
        '10:accepted_labels:text[]:true:::<none>',
        '11:consent_catalog_revision:text:true:::<none>',
        '12:exposure_revision:text:true:::<none>'
      ]::text[], array[
        'mcp_oauth_grants_client_id_fkey:f:true',
        'mcp_oauth_grants_consent_snapshot_valid:c:false',
        'mcp_oauth_grants_pkey:p:true',
        'mcp_oauth_grants_revision_shape:c:false',
        'mcp_oauth_grants_scopes_present:c:false'
      ]::text[], array[
        'mcp_oauth_grants_one_live_per_binding',
        'mcp_oauth_grants_pkey'
      ]::text[], array['mcp_oauth_grants_immutable_consent']::text[]),
      ('mcp_oauth_tokens', array[
        '1:token_hash:text:true:::<none>',
        '2:kind:text:true:::<none>',
        '3:grant_id:uuid:true:::<none>',
        '4:family_id:uuid:true:::<none>',
        '5:issuer:text:true:::<none>',
        '6:audience:text:true:::<none>',
        '7:expires_at:timestamp with time zone:true:::<none>',
        '8:created_at:timestamp with time zone:true:::statement_timestamp()',
        '9:rotated_to_hash:text:false:::<none>',
        '10:used_at:timestamp with time zone:false:::<none>',
        '11:revoked_at:timestamp with time zone:false:::<none>'
      ]::text[], array[
        'mcp_oauth_tokens_grant_id_fkey:f:true',
        'mcp_oauth_tokens_hash_shape:c:false',
        'mcp_oauth_tokens_kind:c:false',
        'mcp_oauth_tokens_pkey:p:true'
      ]::text[], array[
        'mcp_oauth_tokens_by_family',
        'mcp_oauth_tokens_by_grant',
        'mcp_oauth_tokens_pkey'
      ]::text[], array[]::text[]),
      ('mcp_oauth_consent_previews', array[
        '1:preview_hash:text:true:::<none>',
        '2:client_id:uuid:true:::<none>',
        '3:user_id:uuid:true:::<none>',
        '4:company_id:uuid:true:::<none>',
        '5:client_name:text:true:::<none>',
        '6:company_name:text:true:::<none>',
        '7:redirect_uri:text:true:::<none>',
        '8:response_type:text:true:::<none>',
        '9:scopes:text[]:true:::<none>',
        '10:accepted_labels:text[]:true:::<none>',
        '11:consent_catalog_revision:text:true:::<none>',
        '12:exposure_revision:text:true:::<none>',
        '13:state:text:false:::<none>',
        '14:code_challenge:text:true:::<none>',
        '15:code_challenge_method:text:true:::<none>',
        '16:resource:text:true:::<none>',
        '17:expires_at:timestamp with time zone:true:::<none>',
        '18:consumed_at:timestamp with time zone:false:::<none>',
        '19:created_at:timestamp with time zone:true:::statement_timestamp()'
      ]::text[], array[
        'mcp_oauth_consent_previews_pkey:p:true',
        'mcp_oauth_consent_previews_snapshot_valid:c:false'
      ]::text[], array[
        'mcp_oauth_consent_previews_binding_expiry_idx',
        'mcp_oauth_consent_previews_expiry_idx',
        'mcp_oauth_consent_previews_pkey'
      ]::text[], array['mcp_oauth_consent_previews_immutable']::text[])
    ) as expected(
      table_name,
      columns,
      constraints,
      indexes,
      triggers
    )
  loop
    v_oid := to_regclass('private.' || v_item.table_name)::oid;
    select relation.relacl, relation.relowner
    into v_table_acl, v_table_owner
    from pg_catalog.pg_class relation
    join pg_catalog.pg_am access_method
      on access_method.oid = relation.relam
    where relation.oid = v_oid
      and relation.relowner = current_user::regrole
      and relation.relkind = 'r'::"char"
      and relation.relpersistence = 'p'::"char"
      and relation.relispartition is false
      and relation.relrowsecurity is false
      and relation.relforcerowsecurity is false
      and access_method.amname = 'heap';
    if not found then
      raise exception 'mcp_oauth_consent_table_shape_failed:%',
        v_item.table_name;
    end if;

    select coalesce(
      pg_catalog.array_agg(
        attribute.attnum::text || ':' || attribute.attname || ':' ||
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) ||
        ':' || attribute.attnotnull::text || ':' ||
        attribute.attidentity::text || ':' ||
        attribute.attgenerated::text || ':' ||
        coalesce(
          pg_catalog.pg_get_expr(
            default_row.adbin,
            default_row.adrelid,
            false
          ),
          '<none>'
        )
        order by attribute.attnum
      ),
      array[]::text[]
    )
    into v_actual_texts
    from pg_catalog.pg_attribute attribute
    left join pg_catalog.pg_attrdef default_row
      on default_row.adrelid = attribute.attrelid
     and default_row.adnum = attribute.attnum
    where attribute.attrelid = v_oid
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attinhcount = 0
      and attribute.attislocal;
    if v_actual_texts is distinct from v_item.columns then
      raise exception 'mcp_oauth_consent_column_set_failed:%',
        v_item.table_name;
    end if;

    select coalesce(
      pg_catalog.array_agg(
        constraint_row.conname || ':' || constraint_row.contype::text || ':' ||
        constraint_row.connoinherit::text
        order by constraint_row.conname
      ),
      array[]::text[]
    )
    into v_actual_texts
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_oid;
    if v_actual_texts is distinct from v_item.constraints then
      raise exception 'mcp_oauth_consent_constraint_set_failed:%',
        v_item.table_name;
    end if;
    if exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_oid
        and (
          not constraint_row.convalidated
          or constraint_row.condeferrable
          or constraint_row.condeferred
          or not constraint_row.conislocal
          or constraint_row.coninhcount <> 0
          or constraint_row.conparentid <> 0
        )
    ) then
      raise exception 'mcp_oauth_consent_constraint_flags_failed:%',
        v_item.table_name;
    end if;

    select coalesce(
      pg_catalog.array_agg(index_relation.relname order by index_relation.relname),
      array[]::text[]
    )
    into v_actual_texts
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = v_oid;
    if v_actual_texts is distinct from v_item.indexes then
      raise exception 'mcp_oauth_consent_index_set_failed:%',
        v_item.table_name;
    end if;

    select coalesce(
      pg_catalog.array_agg(trigger_row.tgname order by trigger_row.tgname),
      array[]::text[]
    )
    into v_actual_texts
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = v_oid
      and not trigger_row.tgisinternal;
    if v_actual_texts is distinct from v_item.triggers then
      raise exception 'mcp_oauth_consent_trigger_set_failed:%',
        v_item.table_name;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_rewrite rule_row
      where rule_row.ev_class = v_oid
    ) then
      raise exception 'mcp_oauth_consent_rule_set_failed:%',
        v_item.table_name;
    end if;

    select coalesce(
      pg_catalog.array_agg(app_acl.entry order by app_acl.entry),
      array[]::text[]
    )
    into v_acl_entries
    from (
      select distinct
        case
          when acl.grantee = 0 then 'PUBLIC'
          else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
        end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as entry
      from pg_catalog.aclexplode(
        coalesce(v_table_acl, pg_catalog.acldefault('r', v_table_owner))
      ) acl
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where acl.grantee <> v_table_owner
    ) app_acl;
    if v_acl_entries is distinct from array[]::text[] then
      raise exception 'mcp_oauth_consent_table_acl_failed:%',
        v_item.table_name;
    end if;

    select coalesce(
      pg_catalog.array_agg(
        attribute.attname || ':' ||
        case
          when acl.grantee = 0 then 'PUBLIC'
          else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
        end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text
        order by attribute.attnum, acl.grantee, acl.privilege_type
      ),
      array[]::text[]
    )
    into v_acl_entries
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation
      on relation.oid = attribute.attrelid
    cross join lateral pg_catalog.aclexplode(
      coalesce(attribute.attacl, array[]::aclitem[])
    ) acl
    left join pg_catalog.pg_roles role_row
      on role_row.oid = acl.grantee
    where attribute.attrelid = v_oid
      and attribute.attnum > 0
      and not attribute.attisdropped
      and acl.grantee <> relation.relowner;
    if v_acl_entries is distinct from array[]::text[] then
      raise exception 'mcp_oauth_consent_column_acl_failed:%',
        v_item.table_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_inherits inheritance_row
    where inheritance_row.inhrelid = any (array[
      'private.mcp_oauth_clients'::regclass,
      'private.mcp_oauth_authorization_codes'::regclass,
      'private.mcp_oauth_grants'::regclass,
      'private.mcp_oauth_tokens'::regclass,
      'private.mcp_oauth_consent_previews'::regclass
    ]::oid[])
      or inheritance_row.inhparent = any (array[
        'private.mcp_oauth_clients'::regclass,
        'private.mcp_oauth_authorization_codes'::regclass,
        'private.mcp_oauth_grants'::regclass,
        'private.mcp_oauth_tokens'::regclass,
        'private.mcp_oauth_consent_previews'::regclass
      ]::oid[])
  ) then
    raise exception 'mcp_oauth_consent_inheritance_failed';
  end if;

  -- Build reviewed CHECK/PK definitions in pg_temp and compare PostgreSQL's
  -- own deparser output. FK definitions are proven below from exact source and
  -- target keys/actions. No whitespace-sensitive hand-written deparse is used.
  create temporary table mcp_oauth_expected_clients (
    client_id uuid,
    client_name text,
    redirect_uris text[],
    token_endpoint_auth_method text,
    grant_types text[],
    response_types text[],
    scope text,
    registration_source text,
    software_id text,
    software_version text,
    created_at timestamptz,
    disabled_at timestamptz,
    scope_ceiling text[],
    consent_catalog_revision text,
    exposure_revision text,
    constraint mcp_oauth_clients_pkey primary key (client_id),
    constraint mcp_oauth_clients_name_bounded check (
      length(client_name) between 1 and 256
    ),
    constraint mcp_oauth_clients_redirect_uris_present check (
      cardinality(redirect_uris) between 1 and 8
    ),
    constraint mcp_oauth_clients_public_only check (
      token_endpoint_auth_method = 'none'
    ),
    constraint mcp_oauth_clients_registration_source check (
      registration_source in ('dynamic', 'manual')
    ),
    constraint mcp_oauth_clients_scope_ceiling_valid check (
      private.mcp_oauth_scope_array_is_valid(scope_ceiling)
      and scope = array_to_string(scope_ceiling, ' ')
      and private.mcp_oauth_labels_for_scopes(
        scope_ceiling,
        consent_catalog_revision
      ) is not null
      and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
      and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    )
  ) on commit drop;

  create temporary table mcp_oauth_expected_codes (
    code_hash text,
    client_id uuid,
    user_id uuid,
    company_id uuid,
    scopes text[],
    redirect_uri text,
    code_challenge text,
    code_challenge_method text,
    resource text,
    expires_at timestamptz,
    created_at timestamptz,
    consumed_at timestamptz,
    minted_grant_id uuid,
    accepted_labels text[],
    consent_catalog_revision text,
    exposure_revision text,
    constraint mcp_oauth_authorization_codes_pkey primary key (code_hash),
    constraint mcp_oauth_codes_hash_shape check (
      code_hash ~ '^[0-9a-f]{64}$'
    ),
    constraint mcp_oauth_codes_scopes_present check (
      cardinality(scopes) between 1 and 32
    ),
    constraint mcp_oauth_codes_challenge_shape check (
      code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'
    ),
    constraint mcp_oauth_codes_challenge_method check (
      code_challenge_method = 'S256'
    ),
    constraint mcp_oauth_codes_consent_snapshot_valid check (
      private.mcp_oauth_scope_array_is_valid(scopes)
      and cardinality(accepted_labels) = cardinality(scopes)
      and accepted_labels = private.mcp_oauth_labels_for_scopes(
        scopes,
        consent_catalog_revision
      )
      and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
      and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    )
  ) on commit drop;

  create temporary table mcp_oauth_expected_grants (
    id uuid,
    user_id uuid,
    company_id uuid,
    client_id uuid,
    scopes text[],
    revision text,
    created_at timestamptz,
    last_used_at timestamptz,
    revoked_at timestamptz,
    accepted_labels text[],
    consent_catalog_revision text,
    exposure_revision text,
    constraint mcp_oauth_grants_pkey primary key (id),
    constraint mcp_oauth_grants_scopes_present check (
      cardinality(scopes) between 1 and 32
    ),
    constraint mcp_oauth_grants_revision_shape check (
      revision ~ '^[0-9a-f]{32}$'
    ),
    constraint mcp_oauth_grants_consent_snapshot_valid check (
      private.mcp_oauth_scope_array_is_valid(scopes)
      and cardinality(accepted_labels) = cardinality(scopes)
      and accepted_labels = private.mcp_oauth_labels_for_scopes(
        scopes,
        consent_catalog_revision
      )
      and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
      and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
    )
  ) on commit drop;

  create temporary table mcp_oauth_expected_tokens (
    token_hash text,
    kind text,
    grant_id uuid,
    family_id uuid,
    issuer text,
    audience text,
    expires_at timestamptz,
    created_at timestamptz,
    rotated_to_hash text,
    used_at timestamptz,
    revoked_at timestamptz,
    constraint mcp_oauth_tokens_pkey primary key (token_hash),
    constraint mcp_oauth_tokens_hash_shape check (
      token_hash ~ '^[0-9a-f]{64}$'
    ),
    constraint mcp_oauth_tokens_kind check (
      kind in ('access', 'refresh')
    )
  ) on commit drop;

  create temporary table mcp_oauth_expected_previews (
    preview_hash text,
    client_id uuid,
    user_id uuid,
    company_id uuid,
    client_name text,
    company_name text,
    redirect_uri text,
    response_type text,
    scopes text[],
    accepted_labels text[],
    consent_catalog_revision text,
    exposure_revision text,
    state text,
    code_challenge text,
    code_challenge_method text,
    resource text,
    expires_at timestamptz,
    consumed_at timestamptz,
    created_at timestamptz,
    constraint mcp_oauth_consent_previews_pkey primary key (preview_hash),
    constraint mcp_oauth_consent_previews_snapshot_valid check (
      preview_hash ~ '^[0-9a-f]{64}$'
      and length(client_name) between 1 and 256
      and length(company_name) between 1 and 512
      and length(redirect_uri) between 1 and 2048
      and response_type = 'code'
      and private.mcp_oauth_scope_array_is_valid(scopes)
      and cardinality(accepted_labels) = cardinality(scopes)
      and accepted_labels = private.mcp_oauth_labels_for_scopes(
        scopes,
        consent_catalog_revision
      )
      and consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
      and exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
      and (
        state is null
        or (length(state) <= 2048 and state !~ '[[:cntrl:]]')
      )
      and code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'
      and code_challenge_method = 'S256'
      and length(resource) between 1 and 2048
      and expires_at > created_at
      and expires_at <= created_at + interval '5 minutes'
      and (
        consumed_at is null
        or (consumed_at >= created_at and consumed_at < expires_at)
      )
    )
  ) on commit drop;

  for v_item in
    select *
    from (values
      (
        'private.mcp_oauth_clients'::regclass,
        'pg_temp.mcp_oauth_expected_clients'::regclass
      ),
      (
        'private.mcp_oauth_authorization_codes'::regclass,
        'pg_temp.mcp_oauth_expected_codes'::regclass
      ),
      (
        'private.mcp_oauth_grants'::regclass,
        'pg_temp.mcp_oauth_expected_grants'::regclass
      ),
      (
        'private.mcp_oauth_tokens'::regclass,
        'pg_temp.mcp_oauth_expected_tokens'::regclass
      ),
      (
        'private.mcp_oauth_consent_previews'::regclass,
        'pg_temp.mcp_oauth_expected_previews'::regclass
      )
    ) as expected(actual_table_oid, expected_table_oid)
  loop
    select pg_catalog.array_agg(
      constraint_row.conname || ':' ||
      pg_catalog.pg_get_constraintdef(constraint_row.oid, false)
      order by constraint_row.conname
    )
    into v_actual_texts
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_item.actual_table_oid
      and constraint_row.contype <> 'f'::"char";

    select pg_catalog.array_agg(
      constraint_row.conname || ':' ||
      pg_catalog.pg_get_constraintdef(constraint_row.oid, false)
      order by constraint_row.conname
    )
    into v_expected_texts
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_item.expected_table_oid
      and constraint_row.contype <> 'f'::"char";

    if v_actual_texts is distinct from v_expected_texts then
      raise exception 'mcp_oauth_consent_constraint_definition_failed:%',
        v_item.actual_table_oid::regclass;
    end if;
  end loop;

  drop table pg_temp.mcp_oauth_expected_previews;
  drop table pg_temp.mcp_oauth_expected_tokens;
  drop table pg_temp.mcp_oauth_expected_grants;
  drop table pg_temp.mcp_oauth_expected_codes;
  drop table pg_temp.mcp_oauth_expected_clients;

  -- Incoming references are authority-bearing objects too: an external FK
  -- silently installs internal triggers on the referenced OAuth table. Pin
  -- both the exact FK vocabulary and the exact generated RI trigger posture.
  v_expected_texts := array[
    'private.mcp_oauth_authorization_codes:mcp_oauth_authorization_codes_client_id_fkey:private.mcp_oauth_clients:client_id->client_id:saa:true:false:false:true:0:true:0',
    'private.mcp_oauth_grants:mcp_oauth_grants_client_id_fkey:private.mcp_oauth_clients:client_id->client_id:saa:true:false:false:true:0:true:0',
    'private.mcp_oauth_tokens:mcp_oauth_tokens_grant_id_fkey:private.mcp_oauth_grants:grant_id->id:saa:true:false:false:true:0:true:0'
  ]::text[];
  select coalesce(
    pg_catalog.array_agg(
      source_namespace.nspname || '.' || source_relation.relname || ':' ||
      constraint_row.conname || ':' || target_namespace.nspname || '.' ||
      target_relation.relname || ':' ||
      pg_catalog.array_to_string(array(
        select attribute.attname
        from pg_catalog.unnest(constraint_row.conkey)
          with ordinality as source_key(attnum, ordinal)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = source_key.attnum
        order by source_key.ordinal
      ), ',') || '->' || pg_catalog.array_to_string(array(
        select attribute.attname
        from pg_catalog.unnest(constraint_row.confkey)
          with ordinality as target_key(attnum, ordinal)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.confrelid
         and attribute.attnum = target_key.attnum
        order by target_key.ordinal
      ), ',') || ':' || constraint_row.confmatchtype::text ||
      constraint_row.confupdtype::text || constraint_row.confdeltype::text ||
      ':' || constraint_row.convalidated::text || ':' ||
      constraint_row.condeferrable::text || ':' ||
      constraint_row.condeferred::text || ':' ||
      constraint_row.conislocal::text || ':' ||
      constraint_row.coninhcount::text || ':' ||
      constraint_row.connoinherit::text || ':' ||
      constraint_row.conparentid::text
      order by source_namespace.nspname, source_relation.relname,
        constraint_row.conname
    ),
    array[]::text[]
  )
  into v_actual_texts
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class source_relation
    on source_relation.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace source_namespace
    on source_namespace.oid = source_relation.relnamespace
  join pg_catalog.pg_class target_relation
    on target_relation.oid = constraint_row.confrelid
  join pg_catalog.pg_namespace target_namespace
    on target_namespace.oid = target_relation.relnamespace
  where constraint_row.contype = 'f'::"char"
    and constraint_row.confrelid = any (array[
      'private.mcp_oauth_clients'::regclass,
      'private.mcp_oauth_authorization_codes'::regclass,
      'private.mcp_oauth_grants'::regclass,
      'private.mcp_oauth_tokens'::regclass,
      'private.mcp_oauth_consent_previews'::regclass
    ]::oid[]);
  if v_actual_texts is distinct from v_expected_texts then
    raise exception 'mcp_oauth_consent_incoming_foreign_key_set_failed';
  end if;

  v_expected_texts := array[
    'mcp_oauth_authorization_codes:mcp_oauth_authorization_codes_client_id_fkey:RI_FKey_check_ins:5:O:false:false:0',
    'mcp_oauth_authorization_codes:mcp_oauth_authorization_codes_client_id_fkey:RI_FKey_check_upd:17:O:false:false:0',
    'mcp_oauth_clients:mcp_oauth_authorization_codes_client_id_fkey:RI_FKey_noaction_del:9:O:false:false:0',
    'mcp_oauth_clients:mcp_oauth_authorization_codes_client_id_fkey:RI_FKey_noaction_upd:17:O:false:false:0',
    'mcp_oauth_clients:mcp_oauth_grants_client_id_fkey:RI_FKey_noaction_del:9:O:false:false:0',
    'mcp_oauth_clients:mcp_oauth_grants_client_id_fkey:RI_FKey_noaction_upd:17:O:false:false:0',
    'mcp_oauth_grants:mcp_oauth_grants_client_id_fkey:RI_FKey_check_ins:5:O:false:false:0',
    'mcp_oauth_grants:mcp_oauth_grants_client_id_fkey:RI_FKey_check_upd:17:O:false:false:0',
    'mcp_oauth_grants:mcp_oauth_tokens_grant_id_fkey:RI_FKey_noaction_del:9:O:false:false:0',
    'mcp_oauth_grants:mcp_oauth_tokens_grant_id_fkey:RI_FKey_noaction_upd:17:O:false:false:0',
    'mcp_oauth_tokens:mcp_oauth_tokens_grant_id_fkey:RI_FKey_check_ins:5:O:false:false:0',
    'mcp_oauth_tokens:mcp_oauth_tokens_grant_id_fkey:RI_FKey_check_upd:17:O:false:false:0'
  ]::text[];
  select coalesce(
    pg_catalog.array_agg(
      relation.relname || ':' ||
      coalesce(constraint_row.conname, '<none>') || ':' ||
      function_row.proname || ':' || trigger_row.tgtype::text || ':' ||
      trigger_row.tgenabled::text || ':' ||
      trigger_row.tgdeferrable::text || ':' ||
      trigger_row.tginitdeferred::text || ':' ||
      trigger_row.tgparentid::text
      order by relation.relname, constraint_row.conname,
        function_row.proname
    ),
    array[]::text[]
  )
  into v_actual_texts
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation
    on relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_proc function_row
    on function_row.oid = trigger_row.tgfoid
  left join pg_catalog.pg_constraint constraint_row
    on constraint_row.oid = trigger_row.tgconstraint
  where namespace.nspname = 'private'
    and relation.relname in (
      'mcp_oauth_clients',
      'mcp_oauth_authorization_codes',
      'mcp_oauth_grants',
      'mcp_oauth_tokens',
      'mcp_oauth_consent_previews'
    )
    and trigger_row.tgisinternal;
  if v_actual_texts is distinct from v_expected_texts then
    raise exception 'mcp_oauth_consent_internal_trigger_set_failed';
  end if;

  -- Exact index definitions, including key order and the sole partial index.
  for v_item in
    select *
    from (values
      ('mcp_oauth_clients_pkey', 'mcp_oauth_clients', true, true, array['client_id']::text[], null::text),
      ('mcp_oauth_authorization_codes_pkey', 'mcp_oauth_authorization_codes', true, true, array['code_hash']::text[], null::text),
      ('mcp_oauth_grants_one_live_per_binding', 'mcp_oauth_grants', true, false, array['user_id','company_id','client_id']::text[], 'revoked_atisnull'),
      ('mcp_oauth_grants_pkey', 'mcp_oauth_grants', true, true, array['id']::text[], null::text),
      ('mcp_oauth_tokens_by_family', 'mcp_oauth_tokens', false, false, array['family_id']::text[], null::text),
      ('mcp_oauth_tokens_by_grant', 'mcp_oauth_tokens', false, false, array['grant_id','kind']::text[], null::text),
      ('mcp_oauth_tokens_pkey', 'mcp_oauth_tokens', true, true, array['token_hash']::text[], null::text),
      ('mcp_oauth_consent_previews_binding_expiry_idx', 'mcp_oauth_consent_previews', false, false, array['user_id','company_id','expires_at','preview_hash']::text[], null::text),
      ('mcp_oauth_consent_previews_expiry_idx', 'mcp_oauth_consent_previews', false, false, array['expires_at','preview_hash']::text[], null::text),
      ('mcp_oauth_consent_previews_pkey', 'mcp_oauth_consent_previews', true, true, array['preview_hash']::text[], null::text)
    ) as expected(
      index_name,
      table_name,
      is_unique,
      is_primary,
      keys,
      predicate
    )
  loop
    select
      array(
        select pg_catalog.pg_get_indexdef(
          index_row.indexrelid,
          key_number,
          true
        )
        from pg_catalog.generate_series(
          1,
          index_row.indnkeyatts::integer
        ) key_number
        order by key_number
      ),
      case
        when index_row.indpred is null then null
        else lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(
            index_row.indpred,
            index_row.indrelid,
            true
          ),
          '[()[:space:]]+',
          '',
          'g'
        ))
      end
    into v_index_keys, v_index_predicate
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = table_relation.relnamespace
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where namespace.nspname = 'private'
      and table_relation.relname = v_item.table_name
      and index_relation.relname = v_item.index_name
      and index_relation.relowner = current_user::regrole
      and index_relation.relkind = 'i'::"char"
      and index_relation.relpersistence = 'p'::"char"
      and access_method.amname = 'btree'
      and index_row.indisunique = v_item.is_unique
      and index_row.indisprimary = v_item.is_primary
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indislive
      and index_row.indimmediate
      and not index_row.indisexclusion
      and not index_row.indisclustered
      and not index_row.indisreplident
      and not index_row.indcheckxmin
      and not index_row.indnullsnotdistinct
      and index_row.indnkeyatts = index_row.indnatts
      and index_row.indnkeyatts = cardinality(v_item.keys)
      and index_row.indexprs is null;
    if not found
       or v_index_keys is distinct from v_item.keys
       or v_index_predicate is distinct from v_item.predicate then
      raise exception 'mcp_oauth_consent_index_set_failed:%',
        v_item.index_name;
    end if;
  end loop;

  -- Primary/FK key columns and FK actions are part of the closed shape.
  for v_item in
    select *
    from (values
      ('private.mcp_oauth_clients'::regclass, 'mcp_oauth_clients_pkey', array['client_id']::text[], null::regclass, null::text[]),
      ('private.mcp_oauth_authorization_codes'::regclass, 'mcp_oauth_authorization_codes_pkey', array['code_hash']::text[], null::regclass, null::text[]),
      ('private.mcp_oauth_authorization_codes'::regclass, 'mcp_oauth_authorization_codes_client_id_fkey', array['client_id']::text[], 'private.mcp_oauth_clients'::regclass, array['client_id']::text[]),
      ('private.mcp_oauth_grants'::regclass, 'mcp_oauth_grants_pkey', array['id']::text[], null::regclass, null::text[]),
      ('private.mcp_oauth_grants'::regclass, 'mcp_oauth_grants_client_id_fkey', array['client_id']::text[], 'private.mcp_oauth_clients'::regclass, array['client_id']::text[]),
      ('private.mcp_oauth_tokens'::regclass, 'mcp_oauth_tokens_pkey', array['token_hash']::text[], null::regclass, null::text[]),
      ('private.mcp_oauth_tokens'::regclass, 'mcp_oauth_tokens_grant_id_fkey', array['grant_id']::text[], 'private.mcp_oauth_grants'::regclass, array['id']::text[]),
      ('private.mcp_oauth_consent_previews'::regclass, 'mcp_oauth_consent_previews_pkey', array['preview_hash']::text[], null::regclass, null::text[])
    ) as expected(
      table_oid,
      constraint_name,
      keys,
      foreign_table_oid,
      foreign_keys
    )
  loop
    select array(
      select attribute.attname
      from pg_catalog.unnest(constraint_row.conkey)
        with ordinality as key_column(attnum, ordinal)
      join pg_catalog.pg_attribute attribute
        on attribute.attrelid = constraint_row.conrelid
       and attribute.attnum = key_column.attnum
      order by key_column.ordinal
    )
    into v_actual_texts
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_item.table_oid
      and constraint_row.conname = v_item.constraint_name
      and (
        v_item.foreign_table_oid is null
        or (
          constraint_row.confrelid = v_item.foreign_table_oid
          and constraint_row.confupdtype = 'a'::"char"
          and constraint_row.confdeltype = 'a'::"char"
          and constraint_row.confmatchtype = 's'::"char"
        )
      );
    if not found or v_actual_texts is distinct from v_item.keys then
      raise exception 'mcp_oauth_consent_constraint_set_failed:%',
        v_item.constraint_name;
    end if;

    if v_item.foreign_table_oid is not null then
      select array(
        select attribute.attname
        from pg_catalog.pg_constraint constraint_row
        cross join lateral pg_catalog.unnest(constraint_row.confkey)
          with ordinality as foreign_column(attnum, ordinal)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.confrelid
         and attribute.attnum = foreign_column.attnum
        where constraint_row.conrelid = v_item.table_oid
          and constraint_row.conname = v_item.constraint_name
        order by foreign_column.ordinal
      )
      into v_actual_texts;
      if v_actual_texts is distinct from v_item.foreign_keys then
        raise exception 'mcp_oauth_consent_constraint_set_failed:%',
          v_item.constraint_name;
      end if;
    end if;
  end loop;
end;
$closed_world$;

notify pgrst, 'reload schema';
