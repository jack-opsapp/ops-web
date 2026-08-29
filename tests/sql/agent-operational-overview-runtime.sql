\set ON_ERROR_STOP on

\if :{?agent_mcp_operational_overview_bootstrap}
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;

create function auth.role() returns text
language sql stable set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
$$;

create table public.companies (
  id uuid primary key,
  deleted_at timestamptz
);
create table public.users (
  id uuid primary key,
  company_id uuid,
  is_active boolean not null default true,
  deleted_at timestamptz
);
create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null,
  permission text not null,
  scope text,
  granted boolean not null default true
);
create table private.mcp_oauth_clients (
  client_id uuid primary key,
  scope_ceiling text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null,
  disabled_at timestamptz
);
create table private.mcp_oauth_grants (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  client_id uuid not null,
  scopes text[] not null,
  revision text not null,
  revoked_at timestamptz,
  accepted_labels text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null
);
create table if not exists private.test_operational_overview_control (
  singleton boolean primary key default true check (singleton),
  force_bound boolean not null default false,
  force_invalid boolean not null default false,
  purchase_orders_inspected integer not null default 2,
  purchase_lines_inspected integer not null default 3
);
insert into private.test_operational_overview_control(singleton) values (true)
on conflict(singleton) do update
  set force_bound = false,
      force_invalid = false,
      purchase_orders_inspected = 2,
      purchase_lines_inspected = 3;

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
  with permissions as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'permission', permission.permission,
                 'scope', permission.scope
               ) order by permission.permission collate "C"
             ),
             '[]'::jsonb
           ) as value
    from public.user_permission_overrides permission
    where permission.user_id = p_actor_user_id
      and permission.company_id = p_company_id
      and permission.granted
      and permission.permission = any(p_registered_permission_keys)
  )
  select 'sha256:' || pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               p_actor_user_id::text || ':' || p_company_id::text || ':' ||
                 permissions.value::text,
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         ),
         permissions.value
  from public.users actor
  cross join permissions
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and actor.is_active is true;
$$;

create function private.mcp_oauth_labels_for_scopes(text[], text)
returns text[]
language sql immutable set search_path = ''
as $$ select coalesce($1, array[]::text[]) $$;

create function private.agent_rfc3339_utc(p_value timestamptz)
returns text
language sql immutable strict security invoker set search_path = ''
as $$
  select pg_catalog.to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$$;

create function private.canonical_agent_projection_json(p_value jsonb)
returns text
language sql immutable strict security invoker set search_path = ''
as $$ select p_value::text $$;

create function private.test_operational_overview_cards(p_count integer)
returns jsonb
language sql immutable strict set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ordinal', source.value)
      order by source.value),
    '[]'::jsonb
  )
  from pg_catalog.generate_series(1, p_count) source(value);
$$;

create function private.agent_p2_sales_expected_candidate_v1(
  p_kind text,
  p_permissions jsonb
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'variant_key', p_kind,
    'required_oauth_scopes',
      pg_catalog.jsonb_build_array('ops.financial_documents.read'),
    'resolved_permission_scopes', p_permissions,
    'satisfied_permission_group_indexes', pg_catalog.jsonb_build_array(0)
  );
$$;

create function private.agent_p2_payment_expected_candidate_v1(jsonb)
returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'variant_key', 'payment',
    'required_oauth_scopes', pg_catalog.jsonb_build_array('ops.payments.read'),
    'resolved_permission_scopes', $1,
    'satisfied_permission_group_indexes', pg_catalog.jsonb_build_array(0)
  );
$$;

create function private.agent_p2_expense_expected_candidate_v1(text,jsonb)
returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'variant_key', $1,
    'required_oauth_scopes', pg_catalog.jsonb_build_array('ops.expenses.read'),
    'resolved_permission_scopes', $2,
    'satisfied_permission_group_indexes', pg_catalog.jsonb_build_array(0)
  );
$$;

create function private.agent_p2_catalog_expected_candidate_v1(text,jsonb)
returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'variant_key', $1,
    'required_oauth_scopes', pg_catalog.jsonb_build_array('ops.catalog.read'),
    'resolved_permission_scopes', $2,
    'satisfied_permission_group_indexes', pg_catalog.jsonb_build_array(0)
  );
$$;

create function private.agent_p2_purchase_order_expected_candidate_v1(text,jsonb)
returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'variant_key', $1,
    'required_oauth_scopes', pg_catalog.jsonb_build_array('ops.purchasing.read'),
    'resolved_permission_scopes', $2,
    'satisfied_permission_group_indexes', pg_catalog.jsonb_build_array(0)
  );
$$;

create function private.test_operational_overview_fail_if_requested()
returns void
language plpgsql stable set search_path = ''
as $$
declare
  v_control private.test_operational_overview_control%rowtype;
begin
  select * into strict v_control
  from private.test_operational_overview_control;
  if v_control.force_bound then
    raise exception 'test_domain_source_bound' using errcode = '54000';
  end if;
  if v_control.force_invalid then
    raise exception 'test_domain_source_invalid' using errcode = '22000';
  end if;
end;
$$;

create function private.agent_p2_sales_document_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorization_candidates jsonb,
  p_document_kinds text[],p_as_of timestamptz,p_source_limit integer,
  p_item_limit integer
) returns jsonb
language plpgsql stable set search_path = ''
as $$
begin
  perform private.test_operational_overview_fail_if_requested();
  return pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($11),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain','legacy_operational','source_revision',2
      ),
      pg_catalog.jsonb_build_object(
        'domain','sales_documents','source_revision',3
      )
    ),
    'source_inspected', 4,
    'cards', private.test_operational_overview_cards(1)
  );
end;
$$;

create function private.agent_p2_payment_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorization_candidate jsonb,
  p_read_at timestamptz,p_source_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($10),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain','legacy_operational','source_revision',2
      ),
      pg_catalog.jsonb_build_object('domain','payments','source_revision',5),
      pg_catalog.jsonb_build_object(
        'domain','sales_documents','source_revision',3
      )
    ),
    'source_inspected', 6,
    'summaries', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reconciliation_state','applied','payment_count',4
      ),
      pg_catalog.jsonb_build_object(
        'reconciliation_state','voided','payment_count',2
      )
    )
  );
$$;

create function private.agent_p2_expense_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,
  p_permission_snapshot_revision text,p_registered_permission_keys text[],
  p_authorization_candidate jsonb,p_read_at timestamptz,p_limit integer,
  p_source_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($6),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('domain','expenses','source_revision',4)
    ),
    'cards', private.test_operational_overview_cards(1)
  );
$$;

create function private.agent_p2_catalog_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorization_candidates jsonb,
  p_include_supplier_costs boolean,p_read_at timestamptz,
  p_item_limit integer,p_page_fetch_limit integer,p_source_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($11),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('domain','catalog','source_revision',6)
    ),
    'source_inspected', 30,
    'has_more', true,
    'items', private.test_operational_overview_cards(25)
  );
$$;

create function private.agent_p2_purchase_order_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorization_candidates jsonb,
  p_attention_kind text,p_as_of date,p_due_soon_days integer,
  p_include_costs boolean,p_read_at timestamptz,p_item_limit integer,
  p_page_fetch_limit integer,p_source_limit integer,p_line_fetch_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($14),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain','purchasing','source_revision',8
      )
    ),
    'source_inspected', pg_catalog.jsonb_build_object(
      'orders',(
        select control.purchase_orders_inspected
        from private.test_operational_overview_control control
      ),
      'lines',(
        select control.purchase_lines_inspected
        from private.test_operational_overview_control control
      ),
      'catalog_costs',0
    ),
    'has_more', false,
    'items', case when $10 = 'overdue'
      then private.test_operational_overview_cards(2)
      else private.test_operational_overview_cards(1)
    end
  );
$$;

create function private.agent_p2_integration_health_summary_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_required_oauth_scopes text[],
  p_settings_integrations_scope text,p_accounting_scope text,
  p_email_scope text,p_selections jsonb,p_source_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc(
      pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp())
    ),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('domain','company','source_revision',1),
      pg_catalog.jsonb_build_object(
        'domain','integrations','source_revision',9
      )
    ),
    'source_inspected', pg_catalog.jsonb_build_object(
      'accounting',1,'mailbox',1
    ),
    'rows', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item',pg_catalog.jsonb_build_object('reason_code','connected')
      ),
      pg_catalog.jsonb_build_object(
        'item',pg_catalog.jsonb_build_object('reason_code','not_configured')
      ),
      pg_catalog.jsonb_build_object(
        'item',pg_catalog.jsonb_build_object('reason_code','sync_stale')
      ),
      pg_catalog.jsonb_build_object(
        'item',pg_catalog.jsonb_build_object('reason_code','not_configured')
      )
    )
  );
$$;

create function private.agent_p2_legacy_schedule_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,
  p_permission_snapshot_revision text,p_registered_permission_keys text[],
  p_calendar_scope text,p_projects_scope text,p_tasks_scope text,
  p_read_at timestamptz,p_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'projection_revision','agent-p2-legacy-schedule-attention:v1',
    'read_at',private.agent_rfc3339_utc($8),
    'source_versions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'source_domain','operations',
        'source_type','operational_read_revision',
        'source_id','private.agent_operational_read_revisions',
        'version','revision:2'
      )
    ),
    'source_inspected_count',0,
    'returned_count',0,
    'has_more',false,
    'cards','[]'::jsonb
  );
$$;

create function private.agent_p2_work_queue_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorized_sources jsonb,
  p_sources text[],p_read_at timestamptz,p_source_limit integer,
  p_item_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at',private.agent_rfc3339_utc($11),
    'source_revisions',case when $10 = array['task','lead']::text[]
      then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'domain','legacy_operational','source_revision',2
        ),
        pg_catalog.jsonb_build_object('domain','tasks','source_revision',7),
        pg_catalog.jsonb_build_object(
          'domain','work_queue','source_revision',13
        )
      )
      else pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'domain','legacy_job_history','source_revision',11
        ),
        pg_catalog.jsonb_build_object(
          'domain','legacy_operational','source_revision',2
        ),
        pg_catalog.jsonb_build_object(
          'domain','work_queue','source_revision',13
        )
      )
    end,
    'source_inspected',case when $10 = array['task','lead']::text[]
      then 5 else 4 end,
    'returned_count',case when $10 = array['task','lead']::text[]
      then 3 else 2 end,
    'has_more',false,
    'cards',private.test_operational_overview_cards(
      case when $10 = array['task','lead']::text[] then 3 else 2 end
    )
  );
$$;

\ir ../../supabase/migrations/20260829110002_agent_operational_overview_read.sql
\endif

begin;

-- The full-wave path already has every production dependency installed. Its
-- runtime proof replaces only the bounded upstream projections, inside this
-- rollback-only transaction, so deterministic overview behavior is exercised
-- without persisting test doubles or weakening the production functions.
create table if not exists private.test_operational_overview_control (
  singleton boolean primary key default true check (singleton),
  force_bound boolean not null default false,
  force_invalid boolean not null default false,
  purchase_orders_inspected integer not null default 2,
  purchase_lines_inspected integer not null default 3
);
insert into private.test_operational_overview_control(singleton) values (true)
on conflict(singleton) do update
  set force_bound = false,
      force_invalid = false,
      purchase_orders_inspected = 2,
      purchase_lines_inspected = 3;

create or replace function private.test_operational_overview_cards(
  p_count integer
) returns jsonb
language sql immutable strict set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ordinal', source.value)
      order by source.value),
    '[]'::jsonb
  )
  from pg_catalog.generate_series(1, p_count) source(value);
$$;

create or replace function private.test_operational_overview_fail_if_requested()
returns void
language plpgsql stable set search_path = ''
as $$
declare
  v_control private.test_operational_overview_control%rowtype;
begin
  select * into strict v_control
  from private.test_operational_overview_control;
  if v_control.force_bound then
    raise exception 'test_domain_source_bound' using errcode = '54000';
  end if;
  if v_control.force_invalid then
    raise exception 'test_domain_source_invalid' using errcode = '22000';
  end if;
end;
$$;

create or replace function private.agent_p2_sales_document_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorization_candidates jsonb,
  p_document_kinds text[],p_as_of timestamptz,p_source_limit integer,
  p_item_limit integer
) returns jsonb
language plpgsql stable set search_path = ''
as $$
begin
  perform private.test_operational_overview_fail_if_requested();
  return pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($11),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain','legacy_operational','source_revision',2
      ),
      pg_catalog.jsonb_build_object(
        'domain','sales_documents','source_revision',3
      )
    ),
    'source_inspected', 4,
    'cards', private.test_operational_overview_cards(1)
  );
end;
$$;

create or replace function private.agent_p2_payment_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorization_candidate jsonb,
  p_read_at timestamptz,p_source_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($10),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain','legacy_operational','source_revision',2
      ),
      pg_catalog.jsonb_build_object('domain','payments','source_revision',5),
      pg_catalog.jsonb_build_object(
        'domain','sales_documents','source_revision',3
      )
    ),
    'source_inspected', 6,
    'summaries', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reconciliation_state','applied','payment_count',4
      ),
      pg_catalog.jsonb_build_object(
        'reconciliation_state','voided','payment_count',2
      )
    )
  );
$$;

create or replace function private.agent_p2_expense_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,
  p_permission_snapshot_revision text,p_registered_permission_keys text[],
  p_authorization_candidate jsonb,p_read_at timestamptz,p_limit integer,
  p_source_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($6),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('domain','expenses','source_revision',4)
    ),
    'cards', private.test_operational_overview_cards(1)
  );
$$;

create or replace function private.agent_p2_catalog_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorization_candidates jsonb,
  p_include_supplier_costs boolean,p_read_at timestamptz,
  p_item_limit integer,p_page_fetch_limit integer,p_source_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($11),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('domain','catalog','source_revision',6)
    ),
    'source_inspected', 30,
    'has_more', true,
    'items', private.test_operational_overview_cards(25)
  );
$$;

create or replace function private.agent_p2_purchase_order_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorization_candidates jsonb,
  p_attention_kind text,p_as_of date,p_due_soon_days integer,
  p_include_costs boolean,p_read_at timestamptz,p_item_limit integer,
  p_page_fetch_limit integer,p_source_limit integer,p_line_fetch_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc($14),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain','purchasing','source_revision',8
      )
    ),
    'source_inspected', pg_catalog.jsonb_build_object(
      'orders',(
        select control.purchase_orders_inspected
        from private.test_operational_overview_control control
      ),
      'lines',(
        select control.purchase_lines_inspected
        from private.test_operational_overview_control control
      ),
      'catalog_costs',0
    ),
    'has_more', false,
    'items', case when $10 = 'overdue'
      then private.test_operational_overview_cards(2)
      else private.test_operational_overview_cards(1)
    end
  );
$$;

create or replace function private.agent_p2_integration_health_summary_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_required_oauth_scopes text[],
  p_settings_integrations_scope text,p_accounting_scope text,
  p_email_scope text,p_selections jsonb,p_source_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc(
      pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp())
    ),
    'source_revisions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('domain','company','source_revision',1),
      pg_catalog.jsonb_build_object(
        'domain','integrations','source_revision',9
      )
    ),
    'source_inspected', pg_catalog.jsonb_build_object(
      'accounting',1,'mailbox',1
    ),
    'rows', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item',pg_catalog.jsonb_build_object('reason_code','connected')
      ),
      pg_catalog.jsonb_build_object(
        'item',pg_catalog.jsonb_build_object('reason_code','not_configured')
      ),
      pg_catalog.jsonb_build_object(
        'item',pg_catalog.jsonb_build_object('reason_code','sync_stale')
      ),
      pg_catalog.jsonb_build_object(
        'item',pg_catalog.jsonb_build_object('reason_code','not_configured')
      )
    )
  );
$$;

create or replace function private.agent_p2_legacy_schedule_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,
  p_permission_snapshot_revision text,p_registered_permission_keys text[],
  p_calendar_scope text,p_projects_scope text,p_tasks_scope text,
  p_read_at timestamptz,p_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'projection_revision','agent-p2-legacy-schedule-attention:v1',
    'read_at',private.agent_rfc3339_utc($8),
    'source_versions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'source_domain','operations',
        'source_type','operational_read_revision',
        'source_id','private.agent_operational_read_revisions',
        'version','revision:2'
      )
    ),
    'source_inspected_count',0,
    'returned_count',0,
    'has_more',false,
    'cards','[]'::jsonb
  );
$$;

create or replace function private.agent_p2_work_queue_attention_v1(
  p_actor_user_id uuid,p_company_id uuid,p_oauth_grant_id uuid,
  p_oauth_client_id uuid,p_grant_revision text,
  p_granted_scope_ceiling text[],p_permission_snapshot_revision text,
  p_registered_permission_keys text[],p_authorized_sources jsonb,
  p_sources text[],p_read_at timestamptz,p_source_limit integer,
  p_item_limit integer
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'read_at',private.agent_rfc3339_utc($11),
    'source_revisions',case when $10 = array['task','lead']::text[]
      then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'domain','legacy_operational','source_revision',2
        ),
        pg_catalog.jsonb_build_object('domain','tasks','source_revision',7),
        pg_catalog.jsonb_build_object(
          'domain','work_queue','source_revision',13
        )
      )
      else pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'domain','legacy_job_history','source_revision',11
        ),
        pg_catalog.jsonb_build_object(
          'domain','legacy_operational','source_revision',2
        ),
        pg_catalog.jsonb_build_object(
          'domain','work_queue','source_revision',13
        )
      )
    end,
    'source_inspected',case when $10 = array['task','lead']::text[]
      then 5 else 4 end,
    'returned_count',case when $10 = array['task','lead']::text[]
      then 3 else 2 end,
    'has_more',false,
    'cards',private.test_operational_overview_cards(
      case when $10 = array['task','lead']::text[] then 3 else 2 end
    )
  );
$$;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';
set local timezone = 'UTC';

insert into public.companies(id,name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Operational Overview');
insert into public.users(id,company_id,first_name,last_name,is_active) values
  (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Overview', 'Reader',
    true
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Other', 'Reader',
    true
  );

insert into public.user_permission_overrides(
  user_id,company_id,permission,scope
)
select '11111111-1111-4111-8111-111111111111'::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
       permission.permission,
       permission.scope
from (values
  ('accounting.view','all'),
  ('calendar.view','all'),
  ('catalog.orders.view','all'),
  ('catalog.products.view','all'),
  ('catalog.view','all'),
  ('email.view','all'),
  ('estimates.view','all'),
  ('expenses.approve','all'),
  ('expenses.view','all'),
  ('finances.view','all'),
  ('inbox.view','all'),
  ('invoices.view','all'),
  ('pipeline.view','all'),
  ('projects.view','all'),
  ('reports.view','all'),
  ('settings.integrations','all'),
  ('tasks.view','all')
) permission(permission,scope);
insert into public.user_permission_overrides(
  user_id,company_id,permission,scope
) values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'reports.view',
  'all'
);

insert into private.mcp_oauth_clients(
  client_id,client_name,redirect_uris,token_endpoint_auth_method,
  grant_types,response_types,scope,registration_source,
  scope_ceiling,consent_catalog_revision,exposure_revision
) values (
  '33333333-3333-4333-8333-333333333333',
  'Operational overview runtime',
  array['https://operational-overview-runtime.ops.invalid/callback']::text[],
  'none',
  array['authorization_code','refresh_token']::text[],
  array['code']::text[],
  'ops.catalog.read ops.correspondence.read ops.expenses.read ops.financial_documents.read ops.integrations.read ops.jobs.read ops.operations.read ops.payments.read ops.purchasing.read ops.schedule.read ops.tasks.read',
  'manual',
  array[
    'ops.catalog.read',
    'ops.correspondence.read',
    'ops.expenses.read',
    'ops.financial_documents.read',
    'ops.integrations.read',
    'ops.jobs.read',
    'ops.operations.read',
    'ops.payments.read',
    'ops.purchasing.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ]::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_grants(
  id,user_id,company_id,client_id,scopes,revision,accepted_labels,
  consent_catalog_revision,exposure_revision
) values
  (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    array[
      'ops.catalog.read',
      'ops.correspondence.read',
      'ops.expenses.read',
      'ops.financial_documents.read',
      'ops.integrations.read',
      'ops.jobs.read',
      'ops.operations.read',
      'ops.payments.read',
      'ops.purchasing.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    private.mcp_oauth_labels_for_scopes(
      array[
        'ops.catalog.read',
        'ops.correspondence.read',
        'ops.expenses.read',
        'ops.financial_documents.read',
        'ops.integrations.read',
        'ops.jobs.read',
        'ops.operations.read',
        'ops.payments.read',
        'ops.purchasing.read',
        'ops.schedule.read',
        'ops.tasks.read'
      ]::text[],
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    array['ops.operations.read']::text[],
    'cccccccccccccccccccccccccccccccc',
    private.mcp_oauth_labels_for_scopes(
      array['ops.operations.read']::text[],
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );

create function private.test_operational_overview_call(
  p_request_id text,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_selections jsonb
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_company_id constant uuid :=
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_permission_keys constant text[] := array[
    'accounting.view','calendar.view','catalog.orders.view',
    'catalog.products.view','catalog.view','email.view','estimates.view',
    'expenses.approve','expenses.view','finances.view','inbox.view',
    'invoices.view','pipeline.view','projects.view','reports.view',
    'settings.integrations','tasks.view'
  ]::text[];
  v_client_id uuid;
  v_grant_revision text;
  v_scopes text[];
  v_permission_revision text;
  v_permissions jsonb;
  v_authorized jsonb;
  v_warnings jsonb;
begin
  select grant_row.client_id,grant_row.revision,grant_row.scopes
    into strict v_client_id,v_grant_revision,v_scopes
  from private.mcp_oauth_grants grant_row
  where grant_row.id = p_oauth_grant_id;
  select authority.permission_snapshot_revision,
         coalesce(
           pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',
             permission.value ->> 'scope'
             order by permission.value ->> 'permission'
           ) filter (where permission.value ->> 'permission' is not null),
           '{}'::jsonb
         )
    into strict v_permission_revision,v_permissions
  from private.resolve_agent_actor_authority(
    p_actor_user_id,v_company_id,v_permission_keys
  ) authority
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true
  group by authority.permission_snapshot_revision;
  select coalesce(
           pg_catalog.jsonb_agg(source.expected order by source.ordinality)
             filter (where source.expected is not null),
           '[]'::jsonb
         ),
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'code','DEFAULT_COMPONENT_OMITTED',
               'component',source.component
             ) order by source.ordinality
           ) filter (where source.expected is null),
           '[]'::jsonb
         )
    into v_authorized,v_warnings
  from (
    select selection.ordinality,
           selection.value ->> 'component' as component,
           private.agent_p2_operational_overview_expected_component_v1(
             selection.value ->> 'component',
             selection.value ->> 'origin',
             v_permissions,
             v_scopes
           ) as expected
    from pg_catalog.jsonb_array_elements(p_selections)
      with ordinality selection(value,ordinality)
  ) source;
  return public.read_agent_operational_overview_as_system(
    p_request_id,p_actor_user_id,v_company_id,p_oauth_grant_id,v_client_id,
    v_grant_revision,v_scopes,v_permission_revision,v_permission_keys,
    'get_operational_overview','get_operational_overview:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',p_selections,v_authorized,v_warnings,
    25,26,501
  );
end;
$$;

do $runtime_contract$
declare
  v_all_defaults constant jsonb := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'component','financial_attention','origin','default'
    ),
    pg_catalog.jsonb_build_object(
      'component','integration_attention','origin','default'
    ),
    pg_catalog.jsonb_build_object(
      'component','schedule_readiness','origin','default'
    ),
    pg_catalog.jsonb_build_object(
      'component','stock_attention','origin','default'
    ),
    pg_catalog.jsonb_build_object(
      'component','unresolved_correspondence','origin','default'
    ),
    pg_catalog.jsonb_build_object(
      'component','work_due','origin','default'
    )
  );
  v_result jsonb;
  v_second jsonb;
  v_context jsonb;
  v_request_context jsonb;
  v_children jsonb;
  v_expected_ref text;
  v_row jsonb;
  v_authorization jsonb;
  v_signature constant text :=
    'public.read_agent_operational_overview_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)';
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_operational_overview_runtime_failed: requires_pg17';
  end if;
  if pg_catalog.to_regprocedure(v_signature) is null
     or pg_catalog.to_regprocedure(
       'private.agent_p2_operational_overview_summary_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)'
     ) is null then
    raise exception 'agent_operational_overview_runtime_failed: function_missing';
  end if;
  if pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated',v_signature,'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',v_signature,'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_operational_overview_summary_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'agent_operational_overview_runtime_failed: acl';
  end if;
  if pg_catalog.pg_get_functiondef(
       pg_catalog.to_regprocedure(v_signature)::oid
     ) ~* '\m(insert|update|delete|merge|truncate)\M'
     or pg_catalog.pg_get_functiondef(
       pg_catalog.to_regprocedure(
         'private.agent_p2_operational_overview_summary_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)'
       )::oid
     ) ~* '\m(insert|update|delete|merge|truncate)\M' then
    raise exception 'agent_operational_overview_runtime_failed: dml';
  end if;

  v_result := private.test_operational_overview_call(
    'overview-runtime-all',
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    v_all_defaults
  );
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 6
     or v_result -> 'warnings' <> '[]'::jsonb
     or (v_result ->> 'source_inspected')::integer <> 61
     or v_result #>> '{component_source_inspected,0,component}' <>
          'financial_attention'
     or v_result #>> '{component_source_inspected,0,source_inspected}' <> '10'
     or v_result #>> '{component_source_inspected,5,component}' <> 'work_due'
     or v_result #>> '{component_source_inspected,5,source_inspected}' <> '5'
     or v_result #>> '{rows,0,source_inspected}' <> '10'
     or v_result #>> '{rows,3,source_inspected}' <> '40'
     or v_result #>> '{rows,0,item,component}' <> 'financial_attention'
     or v_result #>> '{rows,0,item,attention_count}' <> '5'
     or v_result #>> '{rows,0,item,count_state}' <> 'exact'
     or v_result #>> '{rows,1,item,attention_count}' <> '1'
     or v_result #>> '{rows,2,item,state}' <> 'clear'
     or v_result #>> '{rows,2,item,attention_count}' <> '0'
     or v_result #>> '{rows,3,item,attention_count}' <> '25'
     or v_result #>> '{rows,3,item,count_state}' <> 'at_least_limit'
     or v_result #>> '{rows,4,item,attention_count}' <> '2'
     or v_result #>> '{rows,5,item,attention_count}' <> '3'
     or pg_catalog.jsonb_array_length(v_result -> 'source_revisions') <> 11
     or v_result #>> '{source_revisions,0,domain}' <> 'catalog'
     or v_result #>> '{source_revisions,10,domain}' <> 'work_queue'
     or v_result #>> '{rows,0,source_revisions,0,domain}' <> 'expenses'
     or v_result #>> '{rows,0,source_revisions,3,domain}' <>
          'sales_documents'
     or v_result #>> '{rows,1,source_revisions,0,domain}' <> 'company'
     or v_result #>> '{rows,2,source_revisions,0,domain}' <>
          'legacy_operational'
     or v_result #>> '{rows,3,source_revisions,0,domain}' <> 'catalog'
     or v_result #>> '{rows,4,source_revisions,0,domain}' <>
          'legacy_job_history'
     or v_result #>> '{rows,5,source_revisions,1,domain}' <> 'tasks'
     or v_result::text ~ '"(title|notes|subject|merchant_name|provider|reason_code|amount|cards)"'
     or v_result ->> 'collection_proof_ref' !~
          '^ops_proof:v1:[0-9a-f]{64}$' then
    raise exception 'agent_operational_overview_runtime_failed: projection:%',
      v_result;
  end if;

  v_context := v_result - array[
    'source_revisions','rows','collection_proof_ref'
  ];
  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'component',row.value #>> '{item,component}',
               'proof_ref',row.value -> 'proof_ref',
               'evidence_ref',row.value -> 'evidence_ref',
               'source_inspected',row.value -> 'source_inspected',
               'source_revisions',row.value -> 'source_revisions'
             ) order by row.ordinality
           ),
           '[]'::jsonb
         )
    into v_children
  from pg_catalog.jsonb_array_elements(v_result -> 'rows')
    with ordinality row(value,ordinality);
  v_expected_ref := private.agent_p2_operational_overview_hash_ref_v1(
    'ops_proof:v1:',
    v_context || pg_catalog.jsonb_build_object(
      'proof_kind','operational_overview_collection',
      'source_revisions',v_result -> 'source_revisions',
      'returned_count',6,
      'has_more',false,
      'children',v_children
    )
  );
  if v_result ->> 'collection_proof_ref' is distinct from v_expected_ref then
    raise exception 'agent_operational_overview_runtime_failed: collection_hash';
  end if;
  v_request_context := v_context - array[
    'selections','authorized_components','warnings',
    'component_source_inspected','source_inspected'
  ];

  for v_row in
    select row.value
    from pg_catalog.jsonb_array_elements(v_result -> 'rows') row(value)
  loop
    select component_authorization_row.value
      into strict v_authorization
    from pg_catalog.jsonb_array_elements(v_result -> 'authorized_components')
      component_authorization_row(value)
    where component_authorization_row.value ->> 'component' =
          v_row #>> '{item,component}';
    v_expected_ref := private.agent_p2_operational_overview_hash_ref_v1(
      'ops_proof:v1:',
      v_request_context || pg_catalog.jsonb_build_object(
        'proof_kind','operational_overview_entity',
        'component_authorization',v_authorization,
        'source_inspected',v_row -> 'source_inspected',
        'source_revisions',v_row -> 'source_revisions',
        'item',v_row -> 'item'
      )
    );
    if v_row ->> 'proof_ref' is distinct from v_expected_ref then
      raise exception 'agent_operational_overview_runtime_failed: entity_hash';
    end if;
  end loop;

  perform pg_catalog.set_config('TimeZone','Asia/Kathmandu',true);
  v_second := private.test_operational_overview_call(
    'overview-runtime-timezone',
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    v_all_defaults
  );
  if (select pg_catalog.jsonb_agg(row.value -> 'item' order by row.ordinality)
      from pg_catalog.jsonb_array_elements(v_result -> 'rows')
        with ordinality row(value,ordinality)) is distinct from
     (select pg_catalog.jsonb_agg(row.value -> 'item' order by row.ordinality)
      from pg_catalog.jsonb_array_elements(v_second -> 'rows')
        with ordinality row(value,ordinality)) then
    raise exception 'agent_operational_overview_runtime_failed: timezone';
  end if;
  perform pg_catalog.set_config('TimeZone','UTC',true);

  update private.test_operational_overview_control set force_bound = true;
  v_result := private.test_operational_overview_call(
    'overview-runtime-warnings-only',
    '22222222-2222-4222-8222-222222222222',
    '55555555-5555-4555-8555-555555555555',
    v_all_defaults
  );
  if v_result -> 'rows' <> '[]'::jsonb
     or v_result -> 'source_revisions' <> '[]'::jsonb
     or v_result -> 'component_source_inspected' <> '[]'::jsonb
     or v_result ->> 'source_inspected' <> '0'
     or pg_catalog.jsonb_array_length(v_result -> 'warnings') <> 6
     or v_result ->> 'collection_proof_ref' !~
          '^ops_proof:v1:[0-9a-f]{64}$' then
    raise exception 'agent_operational_overview_runtime_failed: warnings_only';
  end if;

  begin
    perform private.test_operational_overview_call(
      'overview-runtime-explicit-denied',
      '22222222-2222-4222-8222-222222222222',
      '55555555-5555-4555-8555-555555555555',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'component','integration_attention','origin','explicit'
      ))
    );
    raise exception 'agent_operational_overview_runtime_failed: explicit_allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    perform private.test_operational_overview_call(
      'overview-runtime-bound',
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
      v_all_defaults
    );
    raise exception 'agent_operational_overview_runtime_failed: bound_allowed';
  exception
    when sqlstate '54000' then
      if sqlerrm <> 'agent_operational_overview_source_query_bound' then
        raise;
      end if;
  end;
  update private.test_operational_overview_control
    set force_bound = false,force_invalid = true;
  begin
    perform private.test_operational_overview_call(
      'overview-runtime-invalid',
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
      v_all_defaults
    );
    raise exception 'agent_operational_overview_runtime_failed: invalid_allowed';
  exception
    when sqlstate '22000' then
      if sqlerrm <> 'agent_operational_overview_source_data_invalid' then
        raise;
      end if;
  end;
  update private.test_operational_overview_control
    set force_invalid = false;

  update private.test_operational_overview_control
    set purchase_orders_inspected = 501;
  begin
    perform private.test_operational_overview_call(
      'overview-runtime-purchase-orders-bound',
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'component','stock_attention','origin','explicit'
      ))
    );
    raise exception 'agent_operational_overview_runtime_failed: purchase_orders_allowed';
  exception when sqlstate '22000' then
    if sqlerrm <> 'agent_operational_overview_source_data_invalid' then raise; end if;
  end;
  update private.test_operational_overview_control
    set purchase_orders_inspected = 2,purchase_lines_inspected = 501;
  begin
    perform private.test_operational_overview_call(
      'overview-runtime-purchase-lines-bound',
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'component','stock_attention','origin','explicit'
      ))
    );
    raise exception 'agent_operational_overview_runtime_failed: purchase_lines_allowed';
  exception when sqlstate '22000' then
    if sqlerrm <> 'agent_operational_overview_source_data_invalid' then raise; end if;
  end;
  update private.test_operational_overview_control
    set purchase_lines_inspected = 3;

  perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform private.test_operational_overview_call(
      'overview-runtime-browser',
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
      v_all_defaults
    );
    raise exception 'agent_operational_overview_runtime_failed: browser_allowed';
  exception when insufficient_privilege then null;
  end;
end;
$runtime_contract$;

rollback;
