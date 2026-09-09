\set ON_ERROR_STOP on
-- Synthetic catalog + exact OAuth table shapes and captured live routines.
set check_function_bodies=off;
create table private.agent_day_closeout_routines (
  "id" uuid default gen_random_uuid() not null,
  "company_id" uuid not null,
  "actor_user_id" uuid not null,
  "oauth_grant_id" uuid not null,
  "oauth_client_id" uuid not null,
  "grant_revision" text not null,
  "granted_scope_ceiling" text[] not null,
  "permission_snapshot_revision" text not null,
  "capability_manifest_revision" text not null,
  "exposure_revision" text not null,
  "local_time" time without time zone not null,
  "timezone" text not null,
  "weekdays" smallint[] default ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint] not null,
  "enabled" boolean default false not null,
  "next_run_at" timestamp with time zone not null,
  "claimed_at" timestamp with time zone,
  "claim_token" uuid,
  "last_run_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_failure_code" text,
  "change_cursor" jsonb default '{}'::jsonb not null,
  "schedule_revision" bigint default 0 not null,
  "created_at" timestamp with time zone default statement_timestamp() not null,
  "updated_at" timestamp with time zone default statement_timestamp() not null,
  "claim_expires_at" timestamp with time zone,
  "attempt_count" smallint default 0 not null,
  "retry_not_before" timestamp with time zone
);
create table private.mcp_oauth_authorization_codes (
  "code_hash" text not null,
  "client_id" uuid not null,
  "user_id" uuid not null,
  "company_id" uuid not null,
  "scopes" text[] not null,
  "redirect_uri" text not null,
  "code_challenge" text not null,
  "code_challenge_method" text not null,
  "resource" text not null,
  "expires_at" timestamp with time zone not null,
  "created_at" timestamp with time zone default statement_timestamp() not null,
  "consumed_at" timestamp with time zone,
  "minted_grant_id" uuid,
  "accepted_labels" text[] not null,
  "consent_catalog_revision" text not null,
  "exposure_revision" text not null
);
create table private.mcp_oauth_consent_previews (
  "preview_hash" text not null,
  "client_id" uuid not null,
  "user_id" uuid not null,
  "company_id" uuid not null,
  "client_name" text not null,
  "company_name" text not null,
  "redirect_uri" text not null,
  "response_type" text not null,
  "scopes" text[] not null,
  "accepted_labels" text[] not null,
  "consent_catalog_revision" text not null,
  "exposure_revision" text not null,
  "state" text,
  "code_challenge" text not null,
  "code_challenge_method" text not null,
  "resource" text not null,
  "expires_at" timestamp with time zone not null,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone default statement_timestamp() not null
);
create table private.mcp_oauth_tokens (
  "token_hash" text not null,
  "kind" text not null,
  "grant_id" uuid not null,
  "family_id" uuid not null,
  "issuer" text not null,
  "audience" text not null,
  "expires_at" timestamp with time zone not null,
  "created_at" timestamp with time zone default statement_timestamp() not null,
  "rotated_to_hash" text,
  "used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);

create table private.financial_document_effect_policy (
revision text not null,
effect_revision text not null
);
create table private.financial_document_policies (
id uuid not null default extensions.gen_random_uuid(),
company_id uuid not null,
revision text not null,
status text not null,
currency_code text not null,
terms text not null,
permitted_price_sources text[] not null,
permitted_units text[] not null,
source_document_id uuid not null,
source_sha256 text not null,
created_at timestamp with time zone not null default clock_timestamp(),
approved_by uuid,
approved_at timestamp with time zone,
approval_preview_id uuid
);
create table private.financial_policy_previews (
id uuid not null default extensions.gen_random_uuid(),
company_id uuid not null,
actor_user_id uuid not null,
operation text not null,
request jsonb not null,
context jsonb not null,
preview jsonb not null,
preview_sha256 text not null,
created_at timestamp with time zone not null default clock_timestamp(),
expires_at timestamp with time zone not null,
consumed_at timestamp with time zone,
receipt jsonb
);
create table private.mcp_oauth_canary_bindings (
id uuid not null default gen_random_uuid(),
oauth_client_id uuid not null,
user_id uuid not null,
company_id uuid not null,
exposure_revision text not null,
consent_catalog_revision text not null,
expires_at timestamp with time zone not null,
disabled_at timestamp with time zone,
created_at timestamp with time zone not null default statement_timestamp(),
financial_policy_id uuid,
financial_policy_sha256 text,
financial_effect_revision text
);
create table public.project_notes (
id uuid not null default gen_random_uuid(),
project_id text not null,
company_id text not null,
author_id text not null,
content text not null default ''::text,
attachments jsonb not null default '[]'::jsonb,
mentioned_user_ids text[] not null default '{}'::text[],
created_at timestamp with time zone not null default now(),
updated_at timestamp with time zone default now(),
deleted_at timestamp with time zone,
photo_url text,
event_kind text,
content_metadata jsonb
);
create table public.projects (
id uuid not null default gen_random_uuid(),
bubble_id text,
company_id uuid not null,
client_id uuid,
title text not null,
address text,
latitude double precision,
longitude double precision,
status text not null default 'rfq'::text,
notes text,
description text,
all_day boolean default false,
project_images text[] default '{}'::text[],
team_member_ids text[] default '{}'::text[],
opportunity_id text,
start_date timestamp with time zone,
end_date timestamp with time zone,
duration integer,
created_at timestamp with time zone default now(),
updated_at timestamp with time zone default now(),
deleted_at timestamp with time zone,
completed_at timestamp with time zone,
visibility text default 'all'::text,
trade text,
created_by uuid,
vinyl_order_status text default 'not_ordered'::text,
vinyl_ordered_at timestamp with time zone,
vinyl_ordered_by uuid,
estimated_value numeric,
source text,
platform_metadata jsonb,
opportunity_ref uuid,
priority_rank double precision,
title_is_auto boolean not null default false,
vinyl_color text,
vinyl_po text,
status_version bigint not null default 0,
vinyl_source text,
primary_sub_client_id uuid
);
create table public.tax_rates (
id uuid not null default gen_random_uuid(),
company_id uuid not null,
name text not null,
rate numeric(6,4) not null,
is_default boolean default false,
is_active boolean default true,
created_at timestamp with time zone default now()
);
CREATE OR REPLACE FUNCTION private.financial_document_effect_revision()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
 select private.financial_document_hash(jsonb_build_object(
 'triggers',(select jsonb_agg(jsonb_build_array(t.tgrelid::regclass::text,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) order by t.tgrelid::regclass::text,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private')),
 'functions',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.prosecdef,p.proconfig) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f')))

$function$
;
CREATE OR REPLACE FUNCTION private.financial_document_hash(value jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
 select 'sha256:'||encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex')
$function$
;
CREATE OR REPLACE FUNCTION private.user_is_active_company_member(p_actor_user_id uuid, p_actor_company_id uuid)
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
  );
$function$
;
\ir catalog-trial-live-oauth.sql
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_pkey" PRIMARY KEY (id);
alter table private.mcp_oauth_authorization_codes add constraint "mcp_oauth_authorization_codes_pkey" PRIMARY KEY (code_hash);
alter table private.mcp_oauth_canary_bindings add constraint "mcp_oauth_canary_bindings_pkey" PRIMARY KEY (id);
alter table private.mcp_oauth_consent_previews add constraint "mcp_oauth_consent_previews_pkey" PRIMARY KEY (preview_hash);
alter table private.mcp_oauth_tokens add constraint "mcp_oauth_tokens_pkey" PRIMARY KEY (token_hash);
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_company_id_actor_user_id_oauth__key" UNIQUE (company_id, actor_user_id, oauth_client_id);
alter table private.mcp_oauth_canary_bindings add constraint "mcp_oauth_canary_bindings_oauth_client_id_key" UNIQUE (oauth_client_id);
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_attempt_count_valid" CHECK (((attempt_count >= 0) AND (attempt_count <= 4)));
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_claim_complete" CHECK ((((claimed_at IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((claimed_at IS NOT NULL) AND (claim_token IS NOT NULL) AND (claim_expires_at > claimed_at))));
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_exposure_pinned" CHECK ((exposure_revision = '2026-08-30.mcp-exposure.v3'::text));
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_manifest_pinned" CHECK ((capability_manifest_revision = '2026-08-30.capability-manifest.v9'::text));
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_revision_valid" CHECK (((schedule_revision >= 0) AND (schedule_revision <= '9007199254740991'::bigint)));
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_timezone_bounded" CHECK (((length(timezone) >= 1) AND (length(timezone) <= 128)));
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_weekdays_valid" CHECK ((((cardinality(weekdays) >= 1) AND (cardinality(weekdays) <= 7)) AND (weekdays <@ ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint, (7)::smallint])));
alter table private.mcp_oauth_authorization_codes add constraint "mcp_oauth_codes_challenge_method" CHECK ((code_challenge_method = 'S256'::text));
alter table private.mcp_oauth_authorization_codes add constraint "mcp_oauth_codes_challenge_shape" CHECK ((code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'::text));
alter table private.mcp_oauth_authorization_codes add constraint "mcp_oauth_codes_consent_snapshot_valid" CHECK ((private.mcp_oauth_scope_array_is_valid(scopes) AND (cardinality(accepted_labels) = cardinality(scopes)) AND (accepted_labels = private.mcp_oauth_labels_for_scopes(scopes, consent_catalog_revision)) AND (consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'::text) AND (exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'::text)));
alter table private.mcp_oauth_authorization_codes add constraint "mcp_oauth_codes_hash_shape" CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text));
alter table private.mcp_oauth_authorization_codes add constraint "mcp_oauth_codes_scopes_present" CHECK (((cardinality(scopes) >= 1) AND (cardinality(scopes) <= 32)));
alter table private.mcp_oauth_canary_bindings add constraint "mcp_oauth_canary_bindings_expiry_bounded" CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '24:00:00'::interval))));
alter table private.mcp_oauth_clients add constraint "mcp_oauth_clients_name_bounded" CHECK (((length(client_name) >= 1) AND (length(client_name) <= 256)));
alter table private.mcp_oauth_clients add constraint "mcp_oauth_clients_public_only" CHECK ((token_endpoint_auth_method = 'none'::text));
alter table private.mcp_oauth_clients add constraint "mcp_oauth_clients_redirect_uris_present" CHECK (((cardinality(redirect_uris) >= 1) AND (cardinality(redirect_uris) <= 8)));
alter table private.mcp_oauth_clients add constraint "mcp_oauth_clients_registration_source" CHECK ((registration_source = ANY (ARRAY['dynamic'::text, 'manual'::text])));
alter table private.mcp_oauth_clients add constraint "mcp_oauth_clients_scope_ceiling_valid" CHECK ((private.mcp_oauth_scope_array_is_valid(scope_ceiling) AND (scope = array_to_string(scope_ceiling, ' '::text)) AND (private.mcp_oauth_labels_for_scopes(scope_ceiling, consent_catalog_revision) IS NOT NULL) AND (consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'::text) AND (exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'::text)));
alter table private.mcp_oauth_consent_previews add constraint "mcp_oauth_consent_previews_snapshot_valid" CHECK (((preview_hash ~ '^[0-9a-f]{64}$'::text) AND ((length(client_name) >= 1) AND (length(client_name) <= 256)) AND ((length(company_name) >= 1) AND (length(company_name) <= 512)) AND ((length(redirect_uri) >= 1) AND (length(redirect_uri) <= 2048)) AND (response_type = 'code'::text) AND private.mcp_oauth_scope_array_is_valid(scopes) AND (cardinality(accepted_labels) = cardinality(scopes)) AND (accepted_labels = private.mcp_oauth_labels_for_scopes(scopes, consent_catalog_revision)) AND (consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'::text) AND (exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'::text) AND ((state IS NULL) OR ((length(state) <= 2048) AND (state !~ '[[:cntrl:]]'::text))) AND (code_challenge ~ '^[A-Za-z0-9._~-]{43,128}$'::text) AND (code_challenge_method = 'S256'::text) AND ((length(resource) >= 1) AND (length(resource) <= 2048)) AND (expires_at > created_at) AND (expires_at <= (created_at + '00:05:00'::interval)) AND ((consumed_at IS NULL) OR ((consumed_at >= created_at) AND (consumed_at < expires_at)))));
alter table private.mcp_oauth_grants add constraint "mcp_oauth_grants_consent_snapshot_valid" CHECK ((private.mcp_oauth_scope_array_is_valid(scopes) AND (cardinality(accepted_labels) = cardinality(scopes)) AND (accepted_labels = private.mcp_oauth_labels_for_scopes(scopes, consent_catalog_revision)) AND (consent_catalog_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'::text) AND (exposure_revision ~ '^[0-9a-z][0-9a-z._:-]{0,127}$'::text)));
alter table private.mcp_oauth_grants add constraint "mcp_oauth_grants_revision_shape" CHECK ((revision ~ '^[0-9a-f]{32}$'::text));
alter table private.mcp_oauth_grants add constraint "mcp_oauth_grants_scopes_present" CHECK (((cardinality(scopes) >= 1) AND (cardinality(scopes) <= 32)));
alter table private.mcp_oauth_tokens add constraint "mcp_oauth_tokens_hash_shape" CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text));
alter table private.mcp_oauth_tokens add constraint "mcp_oauth_tokens_kind" CHECK ((kind = ANY (ARRAY['access'::text, 'refresh'::text])));
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_oauth_client_id_fkey" FOREIGN KEY (oauth_client_id) REFERENCES private.mcp_oauth_clients(client_id);
alter table private.agent_day_closeout_routines add constraint "agent_day_closeout_routines_oauth_grant_id_fkey" FOREIGN KEY (oauth_grant_id) REFERENCES private.mcp_oauth_grants(id);
alter table private.mcp_oauth_authorization_codes add constraint "mcp_oauth_authorization_codes_client_id_fkey" FOREIGN KEY (client_id) REFERENCES private.mcp_oauth_clients(client_id);
alter table private.mcp_oauth_canary_bindings add constraint "mcp_oauth_canary_bindings_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table private.mcp_oauth_canary_bindings add constraint "mcp_oauth_canary_bindings_oauth_client_id_fkey" FOREIGN KEY (oauth_client_id) REFERENCES private.mcp_oauth_clients(client_id);
alter table private.mcp_oauth_canary_bindings add constraint "mcp_oauth_canary_bindings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
alter table private.mcp_oauth_grants add constraint "mcp_oauth_grants_client_id_fkey" FOREIGN KEY (client_id) REFERENCES private.mcp_oauth_clients(client_id);
alter table private.mcp_oauth_tokens add constraint "mcp_oauth_tokens_grant_id_fkey" FOREIGN KEY (grant_id) REFERENCES private.mcp_oauth_grants(id);
alter table private.agent_day_closeout_routines enable row level security;
revoke all on private.agent_day_closeout_routines from public,anon,authenticated,service_role;
CREATE TRIGGER mcp_oauth_authorization_codes_v3_canary BEFORE INSERT ON private.mcp_oauth_authorization_codes FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_v3_canary_write();
CREATE TRIGGER mcp_oauth_codes_immutable_consent BEFORE UPDATE ON private.mcp_oauth_authorization_codes FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_oauth_consent_immutability();
alter table private.mcp_oauth_authorization_codes enable row level security;
revoke all on private.mcp_oauth_authorization_codes from public,anon,authenticated,service_role;
alter table private.mcp_oauth_canary_bindings enable row level security;
revoke all on private.mcp_oauth_canary_bindings from public,anon,authenticated,service_role;
CREATE TRIGGER mcp_oauth_clients_immutable_ceiling BEFORE UPDATE ON private.mcp_oauth_clients FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_oauth_consent_immutability();
alter table private.mcp_oauth_clients enable row level security;
revoke all on private.mcp_oauth_clients from public,anon,authenticated,service_role;
CREATE TRIGGER mcp_oauth_consent_previews_immutable BEFORE UPDATE ON private.mcp_oauth_consent_previews FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_oauth_consent_immutability();
CREATE TRIGGER mcp_oauth_consent_previews_v3_canary BEFORE INSERT ON private.mcp_oauth_consent_previews FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_v3_canary_write();
alter table private.mcp_oauth_consent_previews enable row level security;
revoke all on private.mcp_oauth_consent_previews from public,anon,authenticated,service_role;
CREATE TRIGGER mcp_oauth_grants_immutable_consent BEFORE UPDATE ON private.mcp_oauth_grants FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_oauth_consent_immutability();
CREATE TRIGGER mcp_oauth_grants_v3_canary BEFORE INSERT ON private.mcp_oauth_grants FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_v3_canary_write();
alter table private.mcp_oauth_grants enable row level security;
revoke all on private.mcp_oauth_grants from public,anon,authenticated,service_role;
CREATE TRIGGER mcp_oauth_tokens_v3_canary BEFORE INSERT ON private.mcp_oauth_tokens FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_v3_canary_write();
alter table private.mcp_oauth_tokens enable row level security;
revoke all on private.mcp_oauth_tokens from public,anon,authenticated,service_role;
revoke all on function private.enforce_mcp_oauth_consent_immutability() from public,anon,authenticated,service_role;
revoke all on function private.enforce_mcp_v3_canary_write() from public,anon,authenticated,service_role;
revoke all on function private.lock_mcp_v3_canary_client(uuid) from public,anon,authenticated,service_role;
revoke all on function private.mcp_oauth_canary_is_current(uuid, uuid, uuid, text, text) from public,anon,authenticated,service_role;
revoke all on function private.mcp_oauth_labels_for_scopes(text[], text) from public,anon,authenticated,service_role;
revoke all on function private.mcp_oauth_scope_array(text) from public,anon,authenticated,service_role;
revoke all on function private.mcp_oauth_scope_array_is_valid(text[]) from public,anon,authenticated,service_role;
revoke all on function private.prune_expired_mcp_oauth_artifacts() from public,anon,authenticated,service_role;
revoke all on function private.user_is_active_company_member(uuid, uuid) from public,anon,authenticated,service_role;
revoke all on function public.consume_mcp_oauth_authorization_code_as_system(text, uuid, text) from public,anon,authenticated,service_role;
grant execute on function public.consume_mcp_oauth_authorization_code_as_system(text, uuid, text) to service_role;
revoke all on function public.consume_mcp_oauth_consent_preview_as_system(text, uuid, uuid) from public,anon,authenticated,service_role;
grant execute on function public.consume_mcp_oauth_consent_preview_as_system(text, uuid, uuid) to service_role;
revoke all on function public.create_mcp_oauth_authorization_code_as_system(text, uuid, uuid, uuid, text[], text[], text, text, text, text, text, timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public.create_mcp_oauth_authorization_code_as_system(text, uuid, uuid, uuid, text[], text[], text, text, text, text, text, timestamp with time zone) to service_role;
revoke all on function public.issue_mcp_oauth_consent_preview_as_system(text, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text, text, text, timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public.issue_mcp_oauth_consent_preview_as_system(text, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text, text, text, timestamp with time zone) to service_role;
revoke all on function public.mint_mcp_oauth_grant_as_system(text, uuid, uuid, uuid, text, text[], text, text, text, text, timestamp with time zone, timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public.mint_mcp_oauth_grant_as_system(text, uuid, uuid, uuid, text, text[], text, text, text, text, timestamp with time zone, timestamp with time zone) to service_role;
revoke all on function public.register_mcp_oauth_client_as_system(text, text[], text, text[], text, text, text, text) from public,anon,authenticated,service_role;
grant execute on function public.register_mcp_oauth_client_as_system(text, text[], text, text[], text, text, text, text) to service_role;
revoke all on function public.resolve_mcp_oauth_access_token_as_system(text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_mcp_oauth_access_token_as_system(text) to service_role;
revoke all on function public.resolve_mcp_oauth_access_token_as_system(text, text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_mcp_oauth_access_token_as_system(text, text) to service_role;
revoke all on function public.revoke_mcp_oauth_grant_as_system(uuid, uuid) from public,anon,authenticated,service_role;
grant execute on function public.revoke_mcp_oauth_grant_as_system(uuid, uuid) to service_role;
revoke all on function public.revoke_mcp_oauth_token_as_system(text) from public,anon,authenticated,service_role;
grant execute on function public.revoke_mcp_oauth_token_as_system(text) to service_role;
revoke all on function public.rotate_mcp_oauth_refresh_token_as_system(text, uuid, text[], text, text, timestamp with time zone, timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public.rotate_mcp_oauth_refresh_token_as_system(text, uuid, text[], text, text, timestamp with time zone, timestamp with time zone) to service_role;
revoke all on function public.rotate_mcp_oauth_refresh_token_without_v3_canary(text, uuid, text[], text, text, timestamp with time zone, timestamp with time zone) from public,anon,authenticated,service_role;


