\set ON_ERROR_STOP on

\if :{?agent_mcp_evidence_bootstrap}
-- Disposable PostgreSQL 17 bootstrap. This intentionally defines only the
-- production-shaped prerequisites needed to compile Tasks 10 and 11; all
-- behavioral fixture rows remain inside the rollback transaction below.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;

create function auth.role() returns text
language sql stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
$$;

create table public.companies (
  id uuid primary key,
  name text not null default 'Company',
  deleted_at timestamptz
);
create table public.opportunities (
  id uuid primary key,
  company_id uuid not null,
  client_ref uuid,
  title text not null default 'Opportunity',
  deleted_at timestamptz,
  merged_into_opportunity_id uuid
);
create table public.projects (
  id uuid primary key,
  company_id uuid not null,
  client_id uuid,
  title text not null default 'Project',
  status text not null default 'in_progress',
  deleted_at timestamptz,
  opportunity_id text,
  opportunity_ref uuid
);
create table public.clients (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  deleted_at timestamptz
);
create table public.users (
  id uuid primary key,
  company_id uuid not null,
  first_name text not null,
  last_name text not null,
  is_active boolean not null default true,
  is_company_admin boolean not null default false
);
create table public.user_permission_overrides (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  permission text not null,
  scope text not null,
  granted boolean not null
);
create table public.project_photos (
  id uuid primary key,
  company_id text not null,
  project_id text not null,
  source text,
  caption text,
  taken_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  is_client_visible boolean not null default false,
  rendered_url text,
  url text,
  site_visit_id uuid
);
create table public.project_photo_annotations (
  id uuid primary key,
  company_id text not null,
  project_id text not null,
  photo_url text,
  annotation_url text,
  rendered_photo_url text,
  note text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);
create table public.project_notes (
  id uuid primary key,
  company_id text not null,
  project_id text not null,
  author_id text not null,
  content text,
  event_kind text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);
create table public.site_visits (
  id uuid primary key,
  company_id text not null,
  opportunity_id uuid,
  client_id text,
  client_ref uuid,
  project_id text,
  project_ref uuid,
  created_by text,
  assignee_ids text[],
  scheduled_at timestamptz not null default now(),
  status text not null default 'scheduled',
  deleted_at timestamptz
);
create table public.site_visit_artifacts (
  id uuid primary key,
  company_id text not null,
  site_visit_id uuid not null,
  opportunity_id uuid,
  deck_design_id uuid,
  kind text,
  source text not null default 'manual',
  created_by text not null,
  title text,
  body text,
  asset_url text,
  rendered_asset_url text,
  captured_at timestamptz,
  created_at timestamptz,
  included_in_project_review boolean not null default false,
  deleted_at timestamptz
);
create table public.deck_designs (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  project_id uuid,
  title text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);
create table public.email_connections (
  id uuid primary key,
  company_id text not null,
  type text,
  user_id text
);
create table public.email_attachments (
  id uuid primary key,
  company_id uuid not null,
  connection_id uuid,
  opportunity_id uuid,
  attribution_status text,
  ingest_status text,
  occurred_at timestamptz,
  stored_at timestamptz,
  created_at timestamptz,
  filename text,
  detected_mime_type text,
  verified_size_bytes bigint,
  storage_path text
);
create table public.email_attachment_inspection_jobs (
  id uuid primary key,
  company_id uuid not null,
  email_attachment_id uuid,
  status text
);
create table public.attachment_inspections (
  id uuid primary key,
  company_id uuid not null,
  connection_id uuid,
  email_attachment_id uuid
);
create table public.estimates (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  project_id text,
  project_ref uuid,
  title text,
  estimate_number text,
  pdf_storage_path text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);
create table public.invoices (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  project_id uuid,
  project_ref uuid,
  subject text,
  invoice_number text,
  pdf_storage_path text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);
create table public.expenses (
  id uuid primary key,
  company_id uuid not null,
  submitted_by uuid,
  receipt_image_url text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);
create table public.expense_project_allocations (
  id uuid primary key,
  expense_id uuid not null,
  project_id text not null
);
create table public.project_tasks (
  id uuid primary key,
  company_id uuid not null
);

create table private.agent_read_domains (
  domain text primary key
);
insert into private.agent_read_domains(domain) values ('artifacts');
create table private.agent_read_domain_revisions (
  company_id uuid not null,
  domain text not null,
  source_revision bigint not null default 0,
  primary key(company_id, domain)
);
create table private.agent_operational_read_revisions (
  company_id uuid primary key,
  source_revision bigint not null default 0
);
create table private.mcp_oauth_grants (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  client_id uuid not null,
  revision text not null,
  revoked_at timestamptz,
  scopes text[] not null,
  accepted_labels text[] not null default array[]::text[],
  consent_catalog_revision text not null default '2026-08-22.mcp-consent-catalog.v1',
  exposure_revision text not null default '2026-08-22.mcp-exposure.v1',
  constraint mcp_oauth_grants_consent_snapshot_valid check (true)
);
create table private.mcp_oauth_clients (
  client_id uuid primary key,
  client_name text not null,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null,
  grant_types text[] not null,
  response_types text[] not null,
  scope text not null,
  registration_source text not null,
  scope_ceiling text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null,
  disabled_at timestamptz,
  constraint mcp_oauth_clients_scope_ceiling_valid check (true)
);
create table private.test_entity_access (
  actor_user_id uuid not null,
  company_id uuid not null,
  entity_kind text not null,
  entity_id uuid not null,
  can_view boolean not null,
  primary key(actor_user_id, company_id, entity_kind, entity_id)
);

create function private.advance_agent_read_domain_revisions(
  p_company_ids uuid[], p_domain text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.agent_read_domain_revisions(company_id, domain, source_revision)
  select distinct company_id, p_domain, 1
  from pg_catalog.unnest(coalesce(p_company_ids, array[]::uuid[])) company_id
  where company_id is not null
  on conflict(company_id, domain) do update
    set source_revision = private.agent_read_domain_revisions.source_revision + 1;
end;
$$;

create function private.bump_agent_read_domain_revision()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old_company uuid;
  v_new_company uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_company := nullif(pg_catalog.to_jsonb(old) ->> tg_argv[1], '')::uuid;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_company := nullif(pg_catalog.to_jsonb(new) ->> tg_argv[1], '')::uuid;
  end if;
  perform private.advance_agent_read_domain_revisions(
    array[v_old_company, v_new_company], tg_argv[0]
  );
  return null;
end;
$$;

create function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_registered_permission_keys text[]
) returns table(
  permission_snapshot_revision text,
  effective_permissions jsonb
)
language sql stable security invoker set search_path = ''
as $$
  select 'sha256:' || pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               p_actor_user_id::text || ':' || p_company_id::text || ':' ||
               coalesce(pg_catalog.array_to_string(
                 p_registered_permission_keys, ','
               ), ''),
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         ),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'permission', permission.permission,
             'scope', permission.scope
           ) order by permission.permission
         ), '[]'::jsonb)
  from public.users actor
  left join public.user_permission_overrides permission
    on permission.user_id = actor.id
   and permission.company_id = actor.company_id
   and permission.granted
   and permission.permission = any(p_registered_permission_keys)
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.is_active
  group by actor.id, actor.company_id;
$$;

create function private.mcp_oauth_labels_for_scopes(text[], text)
returns text[] language sql immutable set search_path = ''
as $$ select coalesce($1, array[]::text[]) $$;

create function private.agent_user_can_access_entity(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_action text
) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.user_permission_overrides permission
    where permission.user_id = p_actor_user_id
      and permission.company_id = p_company_id
      and permission.granted
      and permission.scope = 'all'
      and permission.permission = case p_entity_kind
        when 'opportunity' then 'pipeline.view'
        when 'project' then 'projects.view'
        when 'client' then 'clients.view'
      end
  );
$$;

create function private.user_can_view_inbox_connection(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_opportunity_id uuid
) returns boolean
language sql stable security invoker set search_path = ''
as $$ select p_connection_id is not null and p_opportunity_id is not null $$;

create function private.agent_p2_optional_canonical_text(
  p_value text,
  p_max_scalars integer,
  p_max_bytes integer,
  p_allow_whitespace boolean
) returns text
language sql immutable security invoker set search_path = ''
as $$
  select case
    when p_value is null then null
    when pg_catalog.octet_length(p_value) > p_max_bytes then null
    when pg_catalog.char_length(p_value) > p_max_scalars then null
    when not p_allow_whitespace and p_value <> pg_catalog.btrim(p_value) then null
    when p_value = '' then null
    else p_value
  end;
$$;

create function private.agent_rfc3339_utc(p_value timestamptz)
returns text
language sql immutable strict security invoker set search_path = ''
as $$
  select pg_catalog.to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

create function private.canonical_agent_projection_json(p_value jsonb)
returns text
language sql immutable strict security invoker set search_path = ''
as $$ select p_value::text $$;

create table private.mcp_oauth_tokens (
  token_hash text primary key,
  kind text not null,
  grant_id uuid not null,
  family_id uuid not null,
  issuer text not null,
  audience text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  rotated_to_hash text,
  used_at timestamptz,
  revoked_at timestamptz
);
create table private.mcp_request_audit (
  id bigint generated always as identity primary key,
  request_id text not null,
  occurred_at timestamptz not null default pg_catalog.statement_timestamp(),
  grant_id uuid,
  client_id uuid,
  actor_user_id uuid,
  company_id uuid,
  tool text,
  protocol_era text,
  outcome text not null,
  error_code text,
  input_sha256 text,
  result_bytes integer,
  latency_ms integer
);

\ir ../../supabase/migrations/20260827233630_agent_artifact_sources.sql
\ir ../../supabase/migrations/20260827233640_agent_artifact_reads.sql
\ir ../../supabase/migrations/20260823072849_agent_mcp_evidence_nonce_ledger.sql
\ir ../../supabase/migrations/20260829013804_agent_mcp_evidence_redemption_rpc.sql
\endif

begin;

do $catalog_contract$
declare
  v_signature constant text :=
    'public.redeem_agent_mcp_evidence_as_system(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone)';
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_mcp_evidence_runtime_requires_postgresql_17';
  end if;
  if pg_catalog.to_regprocedure(v_signature) is null then
    raise exception 'agent_mcp_evidence_redemption_rpc_missing';
  end if;
  if pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated', v_signature, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_signature, 'EXECUTE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'private.agent_mcp_evidence_redemptions',
       'SELECT'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.prune_agent_mcp_evidence_redemptions(integer)',
       'EXECUTE'
     ) then
    raise exception 'agent_mcp_evidence_acl_failed';
  end if;
end;
$catalog_contract$;

do $direct_role_guard_contract$
declare
  v_claim text;
begin
  foreach v_claim in array array['', 'authenticated']::text[] loop
    perform pg_catalog.set_config('request.jwt.claim.role', v_claim, true);
    begin
      perform public.redeem_agent_mcp_evidence_as_system(
        'task11-runtime-direct-role-guard', 'modern', pg_catalog.repeat('a',64),
        'https://app.opsapp.co', 'https://app.opsapp.co/api/mcp',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555', pg_catalog.repeat('d',32),
        array['ops.correspondence.read','ops.files.read']::text[],
        'sha256:' || pg_catalog.repeat('c',64),
        array['email.view','inbox.view','pipeline.view']::text[],
        array['ops.correspondence.read','ops.files.read']::text[],
        '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb,
        'opportunity', '33333333-3333-4333-8333-333333333333',
        'email_attachment',
        'ops_evidence:v1:' || pg_catalog.repeat('b',64),
        1, 1, pg_catalog.repeat('1',64), pg_catalog.repeat('2',64),
        pg_catalog.repeat('3',64),
        pg_catalog.date_trunc('second', pg_catalog.statement_timestamp()),
        pg_catalog.date_trunc('second', pg_catalog.statement_timestamp()) +
          interval '5 minutes'
      );
      raise exception 'agent_mcp_evidence_direct_role_guard_accepted:%',
        coalesce(nullif(v_claim, ''), '<unset>');
    exception
      when sqlstate '42501' then
        if sqlerrm <> 'access_denied' then
          raise;
        end if;
    end;
  end loop;
  perform pg_catalog.set_config(
    'request.jwt.claim.role', 'service_role', true
  );
end;
$direct_role_guard_contract$;

insert into public.companies (id, name) values (
  '22222222-2222-4222-8222-222222222222',
  'Task 11 evidence runtime company'
);
insert into public.users (
  id, company_id, first_name, last_name, is_active, is_company_admin
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Evidence', 'Reader', true, false
);
insert into public.user_permission_overrides (
  id, user_id, company_id, permission, scope, granted
) values
  (
    'd1000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'email.view', 'all', true
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'inbox.view', 'all', true
  ),
  (
    'd1000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'photos.view', 'all', true
  ),
  (
    'd1000000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'pipeline.view', 'all', true
  ),
  (
    'd1000000-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'projects.view', 'all', true
  );

insert into public.opportunities (id, company_id, title) values (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  'Task 11 evidence opportunity'
);
insert into public.projects (id, company_id, title, status) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '22222222-2222-4222-8222-222222222222',
  'Task 11 evidence project', 'in_progress'
);
insert into public.email_connections (
  id, company_id, type, user_id, email
) values (
  '66666666-6666-4666-8666-666666666666',
  '22222222-2222-4222-8222-222222222222',
  'company', '11111111-1111-4111-8111-111111111111',
  'task11-evidence@ops.test'
);
insert into public.email_attachments (
  id, company_id, connection_id, opportunity_id, attribution_status,
  ingest_status, occurred_at, stored_at, created_at, filename,
  detected_mime_type, verified_size_bytes, storage_path
) values (
  '77777777-7777-4777-8777-777777777777',
  '22222222-2222-4222-8222-222222222222',
  '66666666-6666-4666-8666-666666666666',
  '33333333-3333-4333-8333-333333333333',
  'attributed', 'stored',
  pg_catalog.statement_timestamp(), pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp(), 'runtime.pdf', 'application/pdf', 4,
  'company/object.pdf'
);
insert into public.email_attachment_inspection_jobs (
  id, company_id, email_attachment_id, status
) values (
  '88888888-8888-4888-8888-888888888888',
  '22222222-2222-4222-8222-222222222222',
  '77777777-7777-4777-8777-777777777777', 'complete'
);
insert into public.attachment_inspections (
  id, company_id, connection_id, email_attachment_id
) values (
  '99999999-9999-4999-8999-999999999999',
  '22222222-2222-4222-8222-222222222222',
  '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777'
);
insert into public.project_photos (
  id, company_id, project_id, source, caption, taken_at, created_at,
  updated_at, is_client_visible, url
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'other', 'Non-deliverable runtime photo',
  pg_catalog.statement_timestamp(), pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp(), false,
  'https://fixture.invalid/non-deliverable.jpg'
);

insert into private.agent_operational_read_revisions (
  company_id, source_revision
) values ('22222222-2222-4222-8222-222222222222', 29)
on conflict (company_id) do update set source_revision = excluded.source_revision;

insert into private.mcp_oauth_clients (
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source, scope_ceiling,
  consent_catalog_revision, exposure_revision
) values (
  '55555555-5555-4555-8555-555555555555',
  'Task 11 evidence runtime client',
  array['https://runtime.invalid/callback']::text[], 'none',
  array['authorization_code','refresh_token']::text[],
  array['code']::text[],
  'ops.correspondence.read ops.files.read', 'manual',
  array['ops.correspondence.read','ops.files.read']::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_grants (
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555555',
  array['ops.correspondence.read','ops.files.read']::text[],
  pg_catalog.repeat('d', 32),
  private.mcp_oauth_labels_for_scopes(
    array['ops.correspondence.read','ops.files.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_tokens (
  token_hash, kind, grant_id, family_id, issuer, audience, expires_at
) values (
  pg_catalog.repeat('a', 64), 'access',
  '44444444-4444-4444-8444-444444444444',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'https://app.opsapp.co', 'https://app.opsapp.co/api/mcp',
  pg_catalog.statement_timestamp() + interval '1 hour'
);

-- Seed more than one cleanup batch plus one recent sentinel. The first valid
-- redemption must remove exactly 64 expired rows and preserve the sentinel.
insert into private.agent_mcp_evidence_redemptions (
  nonce_digest, authority_binding_digest, source_revision_digest,
  issued_at, expires_at, redeemed_at, outcome_code
)
select extensions.digest(
         pg_catalog.convert_to('task11-stale-nonce:' || series.value, 'UTF8'),
         'sha256'
       ),
       extensions.digest(
         pg_catalog.convert_to('task11-stale-binding', 'UTF8'), 'sha256'
       ),
       extensions.digest(
         pg_catalog.convert_to('task11-stale-revision', 'UTF8'), 'sha256'
       ),
       pg_catalog.statement_timestamp() - interval '3 days',
       pg_catalog.statement_timestamp() - interval '3 days' +
         interval '5 minutes',
       pg_catalog.statement_timestamp() - interval '3 days',
       'denied'
from pg_catalog.generate_series(1, 70) series(value);
insert into private.agent_mcp_evidence_redemptions (
  nonce_digest, authority_binding_digest, source_revision_digest,
  issued_at, expires_at, redeemed_at, outcome_code
) values (
  extensions.digest(
    pg_catalog.convert_to('task11-recent-nonce', 'UTF8'), 'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to('task11-recent-binding', 'UTF8'), 'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to('task11-recent-revision', 'UTF8'), 'sha256'
  ),
  pg_catalog.date_trunc('second', pg_catalog.statement_timestamp()),
  pg_catalog.date_trunc('second', pg_catalog.statement_timestamp()) +
    interval '5 minutes',
  pg_catalog.date_trunc('second', pg_catalog.statement_timestamp()),
  'denied'
);

create function pg_temp.agent_mcp_evidence_source_digest(
  p_artifact_revision bigint,
  p_operational_revision bigint
) returns text
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'artifacts:' || p_artifact_revision::text || pg_catalog.chr(10) ||
        'legacy_operational:' || p_operational_revision::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

create function pg_temp.agent_mcp_evidence_binding_digest(
  p_client_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_source_kind text,
  p_evidence_ref text,
  p_artifact_revision bigint,
  p_operational_revision bigint,
  p_nonce_digest text,
  p_issued_at timestamptz,
  p_expires_at timestamptz
) returns text
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'ops-mcp-evidence-binding:v1' || pg_catalog.chr(10) ||
        'https://app.opsapp.co/api/mcp' || pg_catalog.chr(10) ||
        p_client_id::text || pg_catalog.chr(10) ||
        '44444444-4444-4444-8444-444444444444' || pg_catalog.chr(10) ||
        '11111111-1111-4111-8111-111111111111' || pg_catalog.chr(10) ||
        '22222222-2222-4222-8222-222222222222' || pg_catalog.chr(10) ||
        p_job_kind || pg_catalog.chr(10) || p_job_id::text ||
        pg_catalog.chr(10) || p_source_kind || pg_catalog.chr(10) ||
        p_evidence_ref || pg_catalog.chr(10) ||
        p_artifact_revision::text || pg_catalog.chr(10) ||
        p_operational_revision::text || pg_catalog.chr(10) ||
        p_nonce_digest || pg_catalog.chr(10) ||
        extract(epoch from p_issued_at)::bigint::text ||
        pg_catalog.chr(10) ||
        extract(epoch from p_expires_at)::bigint::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

create function pg_temp.redeem_agent_mcp_evidence_case(
  p_request_id text,
  p_access_token_hash text,
  p_client_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_source_kind text,
  p_evidence_ref text,
  p_artifact_revision bigint,
  p_operational_revision bigint,
  p_nonce_digest text,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_registered_permission_keys text[],
  p_required_oauth_scopes text[],
  p_resolved_permission_scopes jsonb,
  p_binding_override text default null
) returns table (
  outcome text,
  locator_kind text,
  locator text,
  mime_type text,
  byte_size bigint
)
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_permission_snapshot_revision text;
begin
  select authority.permission_snapshot_revision
    into strict v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    p_registered_permission_keys
  ) authority;

  return query
  select redemption.*
  from public.redeem_agent_mcp_evidence_as_system(
    p_request_id => p_request_id,
    p_protocol_era => 'modern',
    p_access_token_hash => p_access_token_hash,
    p_issuer => 'https://app.opsapp.co',
    p_audience => 'https://app.opsapp.co/api/mcp',
    p_actor_user_id => '11111111-1111-4111-8111-111111111111',
    p_company_id => '22222222-2222-4222-8222-222222222222',
    p_oauth_grant_id => '44444444-4444-4444-8444-444444444444',
    p_oauth_client_id => p_client_id,
    p_grant_revision => pg_catalog.repeat('d', 32),
    p_granted_scope_ceiling =>
      array['ops.correspondence.read','ops.files.read']::text[],
    p_permission_snapshot_revision => v_permission_snapshot_revision,
    p_registered_permission_keys => p_registered_permission_keys,
    p_required_oauth_scopes => p_required_oauth_scopes,
    p_resolved_permission_scopes => p_resolved_permission_scopes,
    p_job_kind => p_job_kind,
    p_job_id => p_job_id,
    p_source_kind => p_source_kind,
    p_evidence_ref => p_evidence_ref,
    p_artifact_source_revision => p_artifact_revision,
    p_operational_source_revision => p_operational_revision,
    p_nonce_digest => p_nonce_digest,
    p_source_revision_digest =>
      pg_temp.agent_mcp_evidence_source_digest(
        p_artifact_revision, p_operational_revision
      ),
    p_binding_digest => coalesce(
      p_binding_override,
      pg_temp.agent_mcp_evidence_binding_digest(
        p_client_id, p_job_kind, p_job_id, p_source_kind, p_evidence_ref,
        p_artifact_revision, p_operational_revision, p_nonce_digest,
        p_issued_at, p_expires_at
      )
    ),
    p_issued_at => p_issued_at,
    p_expires_at => p_expires_at
  ) redemption;
end;
$function$;

create function pg_temp.assert_agent_mcp_evidence_denial(
  p_case text,
  p_expected_outcome text,
  p_outcome text,
  p_locator_kind text,
  p_locator text,
  p_mime_type text,
  p_byte_size bigint
) returns void
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if p_outcome is distinct from p_expected_outcome
     or p_locator_kind is not null
     or p_locator is not null
     or p_mime_type is not null
     or p_byte_size is not null then
    raise exception 'agent_mcp_evidence_denial_failed:%', p_case;
  end if;
end;
$function$;

-- This exact vector is shared with evidence-token.test.ts. It pins the byte
-- order, newline separators, epoch rendering, nonce digest and SHA-256 result
-- independently in TypeScript and PostgreSQL.
do $typescript_sql_digest_mirror$
declare
  v_digest text;
begin
  v_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'ops-mcp-evidence-binding:v1' || pg_catalog.chr(10) ||
        'https://app.opsapp.co/api/mcp' || pg_catalog.chr(10) ||
        '11111111-1111-4111-8111-111111111111' || pg_catalog.chr(10) ||
        '22222222-2222-4222-8222-222222222222' || pg_catalog.chr(10) ||
        '33333333-3333-4333-8333-333333333333' || pg_catalog.chr(10) ||
        '44444444-4444-4444-8444-444444444444' || pg_catalog.chr(10) ||
        'project' || pg_catalog.chr(10) ||
        '55555555-5555-4555-8555-555555555555' || pg_catalog.chr(10) ||
        'email_attachment' || pg_catalog.chr(10) ||
        'ops_evidence:v1:' || pg_catalog.repeat('a', 64) ||
        pg_catalog.chr(10) || '17' || pg_catalog.chr(10) || '29' ||
        pg_catalog.chr(10) ||
        'aeee96edde1edbe4cf81859d05e88936b4310f4048ddf0a0b9003dc40e6a4b9c' ||
        pg_catalog.chr(10) || '1787899200' || pg_catalog.chr(10) ||
        '1787899500',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if v_digest is distinct from
       '4da93bc2ecf54a8592891fc0623592a79260cc2de62f5ce1c99dd7e381c57d95'
  then
    raise exception 'agent_mcp_evidence_typescript_sql_digest_mismatch';
  end if;
end;
$typescript_sql_digest_mirror$;

do $single_use_runtime$
declare
  v_issued_at timestamptz := pg_catalog.date_trunc(
    'second', pg_catalog.statement_timestamp()
  );
  v_expires_at timestamptz := v_issued_at + interval '5 minutes';
  v_artifact_revision bigint;
  v_stale_artifact_revision bigint;
  v_operational_revision bigint;
  v_email_evidence_ref text;
  v_photo_evidence_ref text;
  v_result record;
begin
  select revision.source_revision
    into strict v_artifact_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = '22222222-2222-4222-8222-222222222222'
    and revision.domain = 'artifacts';
  select revision.source_revision
    into strict v_operational_revision
  from private.agent_operational_read_revisions revision
  where revision.company_id = '22222222-2222-4222-8222-222222222222';

  select source.evidence_ref
    into strict v_email_evidence_ref
  from private.agent_p2_artifact_private_evidence_v1(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    (
      select authority.permission_snapshot_revision
      from private.resolve_agent_actor_authority(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        array['email.view','inbox.view','pipeline.view']::text[]
      ) authority
    ),
    array['email.view','inbox.view','pipeline.view']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb,
    'opportunity', '33333333-3333-4333-8333-333333333333',
    array['email_attachment']::text[], 501
  ) source;
  select source.evidence_ref
    into strict v_photo_evidence_ref
  from private.agent_p2_artifact_private_evidence_v1(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    (
      select authority.permission_snapshot_revision
      from private.resolve_agent_actor_authority(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        array['photos.view','projects.view']::text[]
      ) authority
    ),
    array['photos.view','projects.view']::text[],
    '{"photos.view":"all","projects.view":"all"}'::jsonb,
    'project', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['project_photo']::text[], 501
  ) source;

  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-delivered', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('1', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  if v_result.outcome is distinct from 'delivered'
     or v_result.locator_kind is distinct from 'storage_path'
     or v_result.locator is distinct from 'company/object.pdf'
     or v_result.mime_type is distinct from 'application/pdf'
     or v_result.byte_size is distinct from 4::bigint then
    raise exception 'agent_mcp_evidence_delivery_failed';
  end if;
  if (select pg_catalog.count(*)
      from private.agent_mcp_evidence_redemptions ledger
      where ledger.authority_binding_digest = extensions.digest(
        pg_catalog.convert_to('task11-stale-binding', 'UTF8'), 'sha256'
      )) is distinct from 6::bigint
     or not exists (
       select 1
       from private.agent_mcp_evidence_redemptions ledger
       where ledger.nonce_digest = extensions.digest(
         pg_catalog.convert_to('task11-recent-nonce', 'UTF8'), 'sha256'
       )
     ) then
    raise exception 'agent_mcp_evidence_bounded_prune_failed';
  end if;

  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-replay', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('1', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'replay', 'replay', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );

  v_stale_artifact_revision := v_artifact_revision;
  update public.email_attachments
     set storage_path = 'company/stale-mutated.pdf'
   where id = '77777777-7777-4777-8777-777777777777';
  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-stale-source', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_stale_artifact_revision, v_operational_revision,
    pg_catalog.repeat('2', 64), v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'stale_source', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );
  update public.email_attachments
     set storage_path = 'company/object.pdf'
   where id = '77777777-7777-4777-8777-777777777777';

  update public.email_attachment_inspection_jobs set status = 'pending'
   where id = '88888888-8888-4888-8888-888888888888';
  select source_revision into strict v_artifact_revision
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-4222-8222-222222222222'
    and domain = 'artifacts';
  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-pending-scan', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('3', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'pending_scan', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );

  update public.email_attachment_inspection_jobs set status = 'failed'
   where id = '88888888-8888-4888-8888-888888888888';
  select source_revision into strict v_artifact_revision
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-4222-8222-222222222222'
    and domain = 'artifacts';
  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-unsafe-scan', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('4', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'unsafe_scan', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );
  update public.email_attachment_inspection_jobs set status = 'complete'
   where id = '88888888-8888-4888-8888-888888888888';

  select source_revision into strict v_artifact_revision
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-4222-8222-222222222222'
    and domain = 'artifacts';
  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-wrong-bearer', pg_catalog.repeat('f', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('5', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'wrong_bearer', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );

  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-wrong-client', pg_catalog.repeat('a', 64),
    '56565656-5656-4656-8656-565656565656',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('6', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'wrong_client', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );

  update private.mcp_oauth_tokens
     set revoked_at = pg_catalog.statement_timestamp()
   where token_hash = pg_catalog.repeat('a', 64);
  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-revoked-token', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('7', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'revoked_token', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );
  update private.mcp_oauth_tokens set revoked_at = null
   where token_hash = pg_catalog.repeat('a', 64);

  update private.mcp_oauth_grants
     set revoked_at = pg_catalog.statement_timestamp()
   where id = '44444444-4444-4444-8444-444444444444';
  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-revoked-grant', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('8', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'revoked_grant', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );
  update private.mcp_oauth_grants set revoked_at = null
   where id = '44444444-4444-4444-8444-444444444444';

  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-expired', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('9', 64),
    v_issued_at - interval '6 minutes',
    v_issued_at - interval '1 minute',
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'expired', 'expired', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );

  begin
    perform 1
    from pg_temp.redeem_agent_mcp_evidence_case(
      'task11-runtime-binding-tamper', pg_catalog.repeat('a', 64),
      '55555555-5555-4555-8555-555555555555',
      'opportunity', '33333333-3333-4333-8333-333333333333',
      'email_attachment', v_email_evidence_ref,
      v_artifact_revision, v_operational_revision, pg_catalog.repeat('a', 64),
      v_issued_at, v_expires_at,
      array['email.view','inbox.view','pipeline.view']::text[],
      array['ops.correspondence.read','ops.files.read']::text[],
      '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb,
      pg_catalog.repeat('f', 64)
    );
    raise exception 'agent_mcp_evidence_binding_tamper_accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'agent_mcp_evidence_redemption_binding_invalid' then
        raise;
      end if;
  end;

  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-non-deliverable-source', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'project', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'project_photo', v_photo_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('b', 64),
    v_issued_at, v_expires_at,
    array['photos.view','projects.view']::text[],
    array['ops.files.read']::text[],
    '{"photos.view":"all","projects.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'non_deliverable_source', 'unavailable', v_result.outcome,
    v_result.locator_kind, v_result.locator, v_result.mime_type,
    v_result.byte_size
  );

  update public.email_attachments set detected_mime_type = 'text/html'
   where id = '77777777-7777-4777-8777-777777777777';
  select source_revision into strict v_artifact_revision
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-4222-8222-222222222222'
    and domain = 'artifacts';
  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-unsafe-mime', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('c', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'unsafe_mime', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );
  update public.email_attachments set detected_mime_type = 'application/pdf'
   where id = '77777777-7777-4777-8777-777777777777';

  update public.email_attachments set verified_size_bytes = 52428801
   where id = '77777777-7777-4777-8777-777777777777';
  select source_revision into strict v_artifact_revision
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-4222-8222-222222222222'
    and domain = 'artifacts';
  select * into strict v_result
  from pg_temp.redeem_agent_mcp_evidence_case(
    'task11-runtime-oversized', pg_catalog.repeat('a', 64),
    '55555555-5555-4555-8555-555555555555',
    'opportunity', '33333333-3333-4333-8333-333333333333',
    'email_attachment', v_email_evidence_ref,
    v_artifact_revision, v_operational_revision, pg_catalog.repeat('d', 64),
    v_issued_at, v_expires_at,
    array['email.view','inbox.view','pipeline.view']::text[],
    array['ops.correspondence.read','ops.files.read']::text[],
    '{"email.view":"all","inbox.view":"all","pipeline.view":"all"}'::jsonb
  );
  perform pg_temp.assert_agent_mcp_evidence_denial(
    'oversized', 'unavailable', v_result.outcome, v_result.locator_kind,
    v_result.locator, v_result.mime_type, v_result.byte_size
  );

  if (select pg_catalog.count(*)
      from private.agent_mcp_evidence_redemptions ledger
      where pg_catalog.encode(ledger.nonce_digest, 'hex') = any(array[
        pg_catalog.repeat('1',64), pg_catalog.repeat('2',64),
        pg_catalog.repeat('3',64), pg_catalog.repeat('4',64),
        pg_catalog.repeat('5',64), pg_catalog.repeat('6',64),
        pg_catalog.repeat('7',64), pg_catalog.repeat('8',64),
        pg_catalog.repeat('9',64), pg_catalog.repeat('b',64),
        pg_catalog.repeat('c',64), pg_catalog.repeat('d',64)
      ]::text[])) is distinct from 12::bigint
     or (select pg_catalog.count(*)
         from private.agent_mcp_evidence_redemptions
         where outcome_code = 'delivered'
           and nonce_digest = pg_catalog.decode(
             pg_catalog.repeat('1',64), 'hex'
           )) is distinct from 1::bigint
     or (select pg_catalog.count(*)
         from private.agent_mcp_evidence_redemptions
         where outcome_code = 'expired'
           and nonce_digest = pg_catalog.decode(
             pg_catalog.repeat('9',64), 'hex'
           )) is distinct from 1::bigint
     or (select pg_catalog.count(*)
         from private.agent_mcp_evidence_redemptions ledger
         where ledger.outcome_code = 'denied'
           and pg_catalog.encode(ledger.nonce_digest, 'hex') = any(array[
             pg_catalog.repeat('2',64), pg_catalog.repeat('3',64),
             pg_catalog.repeat('4',64), pg_catalog.repeat('5',64),
             pg_catalog.repeat('6',64), pg_catalog.repeat('7',64),
             pg_catalog.repeat('8',64), pg_catalog.repeat('b',64),
             pg_catalog.repeat('c',64), pg_catalog.repeat('d',64)
           ]::text[])) is distinct from 10::bigint
     or (select pg_catalog.count(*) from private.mcp_request_audit audit
         where audit.request_id like 'task11-runtime-%')
       is distinct from 13::bigint
     or exists (
       select 1
       from private.mcp_request_audit audit
       where audit.request_id like 'task11-runtime-%'
         and (
           audit.input_sha256 !~ '^[0-9a-f]{64}$'
           or pg_catalog.row_to_json(audit)::text like '%company/%'
           or pg_catalog.row_to_json(audit)::text like '%ops_evidence:%'
           or pg_catalog.row_to_json(audit)::text like '%storage_path%'
           or pg_catalog.row_to_json(audit)::text like '%application/pdf%'
         )
     )
     or exists (
       select 1
       from private.mcp_request_audit audit
       where audit.request_id = 'task11-runtime-binding-tamper'
     )
     or not exists (
       select 1
       from private.agent_mcp_evidence_redemptions ledger
       where ledger.nonce_digest = extensions.digest(
         pg_catalog.convert_to('task11-recent-nonce', 'UTF8'), 'sha256'
       )
     )
     or exists (
       select 1
       from private.agent_mcp_evidence_redemptions ledger
       where ledger.authority_binding_digest = extensions.digest(
         pg_catalog.convert_to('task11-stale-binding', 'UTF8'), 'sha256'
       )
     ) then
    raise exception 'agent_mcp_evidence_bookkeeping_failed';
  end if;
end;
$single_use_runtime$;

rollback;
