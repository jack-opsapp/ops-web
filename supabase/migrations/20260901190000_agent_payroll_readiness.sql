-- Dormant OPS MCP payroll-readiness read.
--
-- Adds nullable source metadata and one authority-bound, bounded snapshot.
-- It moves no money, writes no projection, and activates no MCP exposure.

begin;

set local timezone = 'UTC';

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'private.agent_read_domains',
    'private.agent_read_domain_revisions',
    'private.mcp_oauth_clients',
    'private.mcp_oauth_grants',
    'public.companies',
    'public.expense_settings',
    'public.recurring_expenses',
    'public.expense_batches',
    'public.expenses',
    'public.invoices',
    'public.payments'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_payroll_readiness_prerequisite_missing: %',
        v_relation using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.bump_agent_read_domain_revision()',
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.mcp_oauth_labels_for_scopes(text[],text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_payroll_readiness_prerequisite_missing: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

do $source_shape$
declare
  v_invalid text[];
begin
  with expected(table_name, column_name, data_type) as (
    values
      ('companies', 'id', 'uuid'),
      ('companies', 'deleted_at', 'timestamp with time zone'),
      ('companies', 'timezone', 'text'),
      ('companies', 'currency_code', 'text'),
      ('expense_settings', 'id', 'uuid'),
      ('expense_settings', 'company_id', 'uuid'),
      ('expense_settings', 'forecast_current_balance', 'numeric'),
      ('expense_settings', 'forecast_balance_updated_at', 'timestamp with time zone'),
      ('recurring_expenses', 'id', 'uuid'),
      ('recurring_expenses', 'company_id', 'uuid'),
      ('recurring_expenses', 'amount', 'numeric'),
      ('recurring_expenses', 'currency', 'text'),
      ('recurring_expenses', 'cadence', 'text'),
      ('recurring_expenses', 'next_due_date', 'date'),
      ('recurring_expenses', 'end_date', 'date'),
      ('recurring_expenses', 'updated_at', 'timestamp with time zone'),
      ('recurring_expenses', 'deleted_at', 'timestamp with time zone'),
      ('expense_batches', 'id', 'uuid'),
      ('expense_batches', 'company_id', 'uuid'),
      ('expense_batches', 'status', 'text'),
      ('expense_batches', 'total_amount', 'numeric'),
      ('expense_batches', 'approved_amount', 'numeric'),
      ('expense_batches', 'created_at', 'timestamp with time zone'),
      ('expense_batches', 'reviewed_at', 'timestamp with time zone'),
      ('expense_batches', 'paid_at', 'timestamp with time zone'),
      ('expenses', 'id', 'uuid'),
      ('expenses', 'company_id', 'uuid'),
      ('expenses', 'batch_id', 'uuid'),
      ('expenses', 'currency', 'text'),
      ('expenses', 'deleted_at', 'timestamp with time zone'),
      ('invoices', 'id', 'uuid'),
      ('invoices', 'company_id', 'uuid'),
      ('invoices', 'client_id', 'uuid'),
      ('invoices', 'total', 'numeric'),
      ('invoices', 'amount_paid', 'numeric'),
      ('invoices', 'balance_due', 'numeric'),
      ('invoices', 'status', 'text'),
      ('invoices', 'due_date', 'date'),
      ('invoices', 'sent_at', 'timestamp with time zone'),
      ('invoices', 'deleted_at', 'timestamp with time zone'),
      ('invoices', 'qb_id', 'text'),
      ('invoices', 'sage_id', 'text'),
      ('payments', 'id', 'uuid'),
      ('payments', 'company_id', 'uuid'),
      ('payments', 'invoice_id', 'uuid'),
      ('payments', 'amount', 'numeric'),
      ('payments', 'payment_date', 'date'),
      ('payments', 'voided_at', 'timestamp with time zone'),
      ('payments', 'qb_id', 'text'),
      ('payments', 'sage_id', 'text'),
      ('payments', 'stripe_payment_intent', 'text')
  )
  select pg_catalog.array_agg(
           expected.table_name || '.' || expected.column_name
           order by expected.table_name, expected.column_name
         )
    into v_invalid
  from expected
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = expected.table_name
   and column_row.column_name = expected.column_name
  where column_row.column_name is null
     or column_row.data_type is distinct from expected.data_type;

  if v_invalid is not null then
    raise exception 'agent_payroll_readiness_source_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',') using errcode = '55000';
  end if;
end;
$source_shape$;

alter table public.recurring_expenses
  add column if not exists obligation_kind text,
  add column if not exists due_time_local time without time zone;

alter table public.expense_settings
  add column if not exists forecast_obligations_confirmed_through date,
  add column if not exists forecast_obligations_confirmed_at timestamptz;

do $metadata_shape$
declare
  v_invalid text[];
begin
  with expected(table_name, column_name, data_type, datetime_precision) as (
    values
      ('recurring_expenses', 'obligation_kind', 'text', null::integer),
      ('recurring_expenses', 'due_time_local', 'time without time zone', 6),
      ('expense_settings', 'forecast_obligations_confirmed_through', 'date', 0),
      ('expense_settings', 'forecast_obligations_confirmed_at', 'timestamp with time zone', 6)
  )
  select pg_catalog.array_agg(
           expected.table_name || '.' || expected.column_name
           order by expected.table_name, expected.column_name
         )
    into v_invalid
  from expected
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = expected.table_name
   and column_row.column_name = expected.column_name
  where column_row.column_name is null
     or column_row.data_type is distinct from expected.data_type
     or column_row.is_nullable is distinct from 'YES'
     or column_row.column_default is not null
     or column_row.is_identity is distinct from 'NO'
     or column_row.identity_generation is not null
     or column_row.is_generated is distinct from 'NEVER'
     or column_row.generation_expression is not null
     or column_row.datetime_precision is distinct from
        expected.datetime_precision;

  if v_invalid is not null then
    raise exception 'agent_payroll_readiness_metadata_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',') using errcode = '55000';
  end if;
end;
$metadata_shape$;

do $metadata_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.recurring_expenses'::regclass
      and constraint_row.conname = 'recurring_expenses_obligation_kind_check'
  ) then
    alter table public.recurring_expenses
      add constraint recurring_expenses_obligation_kind_check
      check (obligation_kind is null or obligation_kind in ('payroll', 'other'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.expense_settings'::regclass
      and constraint_row.conname = 'expense_settings_obligation_confirmation_pair_check'
  ) then
    alter table public.expense_settings
      add constraint expense_settings_obligation_confirmation_pair_check
      check (
        (forecast_obligations_confirmed_through is null) =
        (forecast_obligations_confirmed_at is null)
      );
  end if;
end;
$metadata_constraints$;

do $metadata_constraint_guards$
declare
  v_invalid text[];
begin
  select pg_catalog.array_agg(expected.constraint_name order by expected.constraint_name)
    into v_invalid
  from (
    values
      (
        'recurring_expenses',
        'recurring_expenses_obligation_kind_check',
        array['obligation_kind']::text[],
        'CHECK (obligation_kind IS NULL OR (obligation_kind = ANY (ARRAY[''payroll''::text, ''other''::text])))'
      ),
      (
        'expense_settings',
        'expense_settings_obligation_confirmation_pair_check',
        array['forecast_obligations_confirmed_through', 'forecast_obligations_confirmed_at']::text[],
        'CHECK ((forecast_obligations_confirmed_through IS NULL) = (forecast_obligations_confirmed_at IS NULL))'
      )
  ) expected(table_name, constraint_name, columns, definition)
  where not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          pg_catalog.to_regclass('public.' || expected.table_name)
      and constraint_row.conname = expected.constraint_name
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and not constraint_row.connoinherit
      and pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
          expected.definition
      and constraint_row.conkey = (
        select pg_catalog.array_agg(attribute.attnum order by requested.ordinality)
        from pg_catalog.unnest(expected.columns) with ordinality
          requested(column_name, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attname = requested.column_name
         and not attribute.attisdropped
      )
  );

  if v_invalid is not null then
    raise exception 'agent_payroll_readiness_constraint_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',') using errcode = '55000';
  end if;
end;
$metadata_constraint_guards$;

comment on column public.recurring_expenses.obligation_kind is
  'Structured forecast classification. NULL means not yet classified; payroll readiness fails closed.';
comment on column public.recurring_expenses.due_time_local is
  'Exact company-local due time for a forecast obligation. NULL means timing is unknown.';
comment on column public.expense_settings.forecast_obligations_confirmed_through is
  'Last company-local date through which recorded scheduled obligations were confirmed complete.';
comment on column public.expense_settings.forecast_obligations_confirmed_at is
  'Exact instant the scheduled-obligation coverage was confirmed.';

insert into private.agent_read_domains (domain)
values ('payroll_readiness')
on conflict (domain) do nothing;

insert into private.agent_read_domain_revisions (
  company_id, domain, source_revision, updated_at
)
select company.id, 'payroll_readiness', 0, pg_catalog.statement_timestamp()
from public.companies company
on conflict (company_id, domain) do nothing;

create index if not exists recurring_expenses_agent_payroll_due_v1_idx
  on public.recurring_expenses (company_id, next_due_date, id)
  where deleted_at is null;

create index if not exists expense_batches_agent_payroll_due_v1_idx
  on public.expense_batches (company_id, status, id)
  where paid_at is null
    and status in ('approved', 'partially_approved', 'auto_approved');

create index if not exists invoices_agent_payroll_open_v1_idx
  on public.invoices (company_id, due_date, id) include (client_id)
  where deleted_at is null
    and status in ('sent', 'awaiting_payment', 'partially_paid', 'past_due');

create index if not exists payments_agent_payroll_history_v1_idx
  on public.payments (company_id, invoice_id, payment_date, id)
  where voided_at is null;

do $index_guards$
declare
  v_invalid text[];
begin
  select pg_catalog.array_agg(expected.index_name order by expected.index_name)
    into v_invalid
  from (
    values
      (
        'recurring_expenses_agent_payroll_due_v1_idx',
        'recurring_expenses',
        array['company_id', 'next_due_date', 'id']::text[],
        3,
        'deleted_at IS NULL'
      ),
      (
        'expense_batches_agent_payroll_due_v1_idx',
        'expense_batches',
        array['company_id', 'status', 'id']::text[],
        3,
        'paid_at IS NULL AND (status = ANY (ARRAY[''approved''::text, ''partially_approved''::text, ''auto_approved''::text]))'
      ),
      (
        'invoices_agent_payroll_open_v1_idx',
        'invoices',
        array['company_id', 'due_date', 'id', 'client_id']::text[],
        3,
        'deleted_at IS NULL AND (status = ANY (ARRAY[''sent''::text, ''awaiting_payment''::text, ''partially_paid''::text, ''past_due''::text]))'
      ),
      (
        'payments_agent_payroll_history_v1_idx',
        'payments',
        array['company_id', 'invoice_id', 'payment_date', 'id']::text[],
        4,
        'voided_at IS NULL'
      )
  ) expected(index_name, table_name, columns, key_count, predicate)
  where not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_class relation
      on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where namespace.nspname = 'public'
      and relation.relname = expected.table_name
      and index_relation.relname = expected.index_name
      and access_method.amname = 'btree'
      and not index_row.indisunique
      and not index_row.indisprimary
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indislive
      and index_row.indnkeyatts = expected.key_count
      and index_row.indnatts = pg_catalog.array_length(expected.columns, 1)
      and index_row.indexprs is null
      and index_relation.reloptions is null
      and (
        select pg_catalog.array_agg(
          pg_catalog.pg_get_indexdef(
            index_row.indexrelid,
            ordinal.position,
            true
          )
          order by ordinal.position
        )
        from pg_catalog.generate_series(
          1,
          pg_catalog.array_length(expected.columns, 1)
        ) ordinal(position)
      ) = expected.columns
      and pg_catalog.pg_get_expr(
        index_row.indpred, index_row.indrelid, true
      ) = expected.predicate
  );

  if v_invalid is not null then
    raise exception 'agent_payroll_readiness_index_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',') using errcode = '55000';
  end if;
end;
$index_guards$;

drop trigger if exists expense_settings_agent_payroll_source_revision_v1
  on public.expense_settings;
create trigger expense_settings_agent_payroll_source_revision_v1
after insert or update or delete on public.expense_settings
for each row execute function private.bump_agent_read_domain_revision(
  'payroll_readiness', 'company_id'
);

drop trigger if exists recurring_expenses_agent_payroll_source_revision_v1
  on public.recurring_expenses;
create trigger recurring_expenses_agent_payroll_source_revision_v1
after insert or update or delete on public.recurring_expenses
for each row execute function private.bump_agent_read_domain_revision(
  'payroll_readiness', 'company_id'
);

drop trigger if exists expense_batches_agent_payroll_source_revision_v1
  on public.expense_batches;
create trigger expense_batches_agent_payroll_source_revision_v1
after insert or update or delete on public.expense_batches
for each row execute function private.bump_agent_read_domain_revision(
  'payroll_readiness', 'company_id'
);

drop trigger if exists expenses_agent_payroll_source_revision_v1
  on public.expenses;
create trigger expenses_agent_payroll_source_revision_v1
after insert or update or delete on public.expenses
for each row execute function private.bump_agent_read_domain_revision(
  'payroll_readiness', 'company_id'
);

drop trigger if exists invoices_agent_payroll_source_revision_v1
  on public.invoices;
create trigger invoices_agent_payroll_source_revision_v1
after insert or update or delete on public.invoices
for each row execute function private.bump_agent_read_domain_revision(
  'payroll_readiness', 'company_id'
);

drop trigger if exists payments_agent_payroll_source_revision_v1
  on public.payments;
create trigger payments_agent_payroll_source_revision_v1
after insert or update or delete on public.payments
for each row execute function private.bump_agent_read_domain_revision(
  'payroll_readiness', 'company_id'
);

create or replace function private.assert_agent_payroll_readiness_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_permission_snapshot_revision text;
  v_required_permissions constant jsonb := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('permission', 'expenses.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'reports.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'settings.company', 'scope', 'all')
  );
  v_required_scopes constant text[] := array[
    'ops.company.read',
    'ops.expenses.read',
    'ops.financial_documents.read',
    'ops.financials.read',
    'ops.payments.read'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or nullif(pg_catalog.btrim(p_grant_revision), '') is null
     or nullif(pg_catalog.btrim(p_permission_snapshot_revision), '') is null
     or p_capability_manifest_revision is distinct from
       '2026-09-01.capability-manifest.v14'
     or p_exposure_revision is distinct from
       '2026-09-01.mcp-exposure.v8'
     or p_capability_id is distinct from 'check_payroll_readiness'
     or p_capability_revision is distinct from
       'check_payroll_readiness:2026-09-01.v1' then
    raise exception 'AGENT_PAYROLL_READINESS_BINDING_INVALID'
      using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array['expenses.view', 'invoices.view', 'reports.view', 'settings.company']
  ) authority
  where authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null
     or v_permission_snapshot_revision is distinct from
       p_permission_snapshot_revision then
    raise exception 'AGENT_PAYROLL_READINESS_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and grant_record.scopes <@ client_record.scope_ceiling
     and grant_record.consent_catalog_revision =
       client_record.consent_catalog_revision
     and grant_record.exposure_revision = client_record.exposure_revision
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = p_granted_scope_ceiling
      and grant_record.revoked_at is null
      and grant_record.exposure_revision = '2026-09-01.mcp-exposure.v8'
      and grant_record.accepted_labels =
        private.mcp_oauth_labels_for_scopes(
          grant_record.scopes,
          grant_record.consent_catalog_revision
        )
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_PAYROLL_READINESS_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_payroll_readiness_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_payroll_readiness_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_observed_at timestamptz,
  p_target_date date,
  p_recurring_obligation_limit integer,
  p_reimbursement_batch_limit integer,
  p_receivable_limit integer,
  p_payer_history_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_timezone text;
  v_currency_code text;
  v_business_date date;
  v_company_revision bigint;
  v_payroll_revision bigint;
  v_settings jsonb := 'null'::jsonb;
  v_recurring jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_receivables jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_recurring_count integer := 0;
  v_batch_count integer := 0;
  v_receivable_count integer := 0;
  v_history_count integer := 0;
begin
  perform private.assert_agent_payroll_readiness_authority(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_capability_manifest_revision,
    p_exposure_revision,
    p_capability_id,
    p_capability_revision
  );

  if p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_observed_at > pg_catalog.statement_timestamp() + interval '5 minutes'
     or p_target_date is null
     or not pg_catalog.isfinite(p_target_date)
     or p_recurring_obligation_limit is distinct from 40
     or p_reimbursement_batch_limit is distinct from 50
     or p_receivable_limit is distinct from 100
     or p_payer_history_limit is distinct from 500 then
    raise exception 'AGENT_PAYROLL_READINESS_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select company.timezone,
         pg_catalog.upper(pg_catalog.btrim(company.currency_code))
    into v_timezone, v_currency_code
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;

  if v_timezone is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_timezone
     )
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'AGENT_PAYROLL_READINESS_COMPANY_CONTEXT_INVALID'
      using errcode = '22000';
  end if;

  v_business_date := (p_observed_at at time zone v_timezone)::date;
  if p_target_date < v_business_date
     or p_target_date > v_business_date + 93 then
    raise exception 'AGENT_PAYROLL_READINESS_TARGET_DATE_INVALID'
      using errcode = '22023';
  end if;

  select revision.source_revision
    into v_company_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'company';
  select revision.source_revision
    into v_payroll_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'payroll_readiness';
  if v_company_revision is null or v_payroll_revision is null then
    raise exception 'AGENT_PAYROLL_READINESS_SOURCE_REVISION_MISSING'
      using errcode = '55000';
  end if;

  select pg_catalog.jsonb_build_object(
           'id', settings.id,
           'cash_balance', case
             when pg_catalog.lower(settings.forecast_current_balance::text)
               in ('nan', 'infinity', '-infinity')
               or pg_catalog.length(settings.forecast_current_balance::text) > 64
               then '__invalid__'
             else settings.forecast_current_balance::text
           end,
           'cash_balance_updated_at', case
             when settings.forecast_balance_updated_at is null then null
             when not pg_catalog.isfinite(
               settings.forecast_balance_updated_at
             ) or extract(
               year from settings.forecast_balance_updated_at at time zone 'UTC'
             ) not between 1 and 9999 then '__invalid__'
             else pg_catalog.to_char(
               settings.forecast_balance_updated_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             )
           end,
           'obligations_confirmed_through',
             case
               when settings.forecast_obligations_confirmed_through is null
                 then null
               when not pg_catalog.isfinite(
                 settings.forecast_obligations_confirmed_through
               ) or extract(
                 year from settings.forecast_obligations_confirmed_through
               ) not between 1 and 9999 then '__invalid__'
               else settings.forecast_obligations_confirmed_through::text
             end,
           'obligations_confirmed_at', case
             when settings.forecast_obligations_confirmed_at is null then null
             when not pg_catalog.isfinite(
               settings.forecast_obligations_confirmed_at
             ) or extract(
               year from settings.forecast_obligations_confirmed_at at time zone 'UTC'
             ) not between 1 and 9999 then '__invalid__'
             else pg_catalog.to_char(
               settings.forecast_obligations_confirmed_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             )
           end
         )
    into v_settings
  from public.expense_settings settings
  where settings.company_id = p_company_id;
  v_settings := coalesce(v_settings, 'null'::jsonb);

  with candidate as materialized (
    select recurring.id,
           recurring.amount,
           case
             when pg_catalog.upper(pg_catalog.btrim(recurring.currency)) =
               v_currency_code then v_currency_code
             else '__mismatch__'
           end as currency,
           case
             when pg_catalog.lower(pg_catalog.btrim(recurring.cadence)) in (
               'weekly', 'biweekly', 'monthly', 'quarterly', 'annually'
             ) then pg_catalog.lower(pg_catalog.btrim(recurring.cadence))
             else '__invalid__'
           end as cadence,
           recurring.next_due_date,
           recurring.end_date,
           recurring.obligation_kind,
           recurring.due_time_local,
           recurring.updated_at
    from public.recurring_expenses recurring
    where recurring.company_id = p_company_id
      and recurring.deleted_at is null
      and (
        not pg_catalog.isfinite(recurring.next_due_date)
        or extract(year from recurring.next_due_date)
          not between 1 and 9999
        or recurring.next_due_date <= p_target_date
      )
    order by recurring.next_due_date, recurring.id
    limit p_recurring_obligation_limit + 1
  ), retained as materialized (
    select * from candidate
    order by next_due_date, id
    limit p_recurring_obligation_limit
  )
  select least((select count(*) from candidate),
               p_recurring_obligation_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', retained.id,
             'amount', case
               when pg_catalog.lower(retained.amount::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.amount::text) > 64
                 then '__invalid__'
               else retained.amount::text
             end,
             'currency', retained.currency,
             'cadence', retained.cadence,
             'next_due_date', case
               when pg_catalog.isfinite(retained.next_due_date)
                 and extract(year from retained.next_due_date)
                   between 1 and 9999
                 then retained.next_due_date::text
               else '__invalid__'
             end,
             'end_date', case
               when retained.end_date is null then null
               when pg_catalog.isfinite(retained.end_date)
                 and extract(year from retained.end_date)
                   between 1 and 9999
                 then retained.end_date::text
               else '__invalid__'
             end,
             'obligation_kind', retained.obligation_kind,
             'due_time_local', case
               when retained.due_time_local is null then null
               else pg_catalog.to_char(retained.due_time_local, 'HH24:MI:SS.US')
             end,
             'updated_at', case
               when pg_catalog.isfinite(retained.updated_at)
                 and extract(
                   year from retained.updated_at at time zone 'UTC'
                 ) between 1 and 9999
                 then pg_catalog.to_char(
                   retained.updated_at at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                 )
               else '__invalid__'
             end
           ) order by retained.next_due_date, retained.id
         ), '[]'::jsonb)
    into v_recurring_count, v_recurring
  from retained;

  with candidate as materialized (
    select batch.id,
           case
             when batch.status = 'partially_approved'
               then coalesce(batch.approved_amount, batch.total_amount, 0)
             when batch.approved_amount is not null
               and batch.approved_amount > 0
               then batch.approved_amount
             else coalesce(batch.total_amount, 0)
           end as owed_amount,
           coalesce(lines.line_count, 0) as line_count,
           coalesce(lines.currency_codes, array[]::text[]) as currency_codes,
           coalesce(batch.reviewed_at, batch.created_at, '-infinity'::timestamptz)
             as ordered_at
    from public.expense_batches batch
    left join lateral (
      select least(count(*), 10000::bigint)::integer as line_count,
             pg_catalog.array_agg(distinct case
               when pg_catalog.upper(pg_catalog.btrim(expense.currency)) =
                 v_currency_code then v_currency_code
               else '__mismatch__'
             end order by case
               when pg_catalog.upper(pg_catalog.btrim(expense.currency)) =
                 v_currency_code then v_currency_code
               else '__mismatch__'
             end) as currency_codes
      from public.expenses expense
      where expense.company_id = p_company_id
        and expense.batch_id = batch.id
        and expense.deleted_at is null
    ) lines on true
    where batch.company_id = p_company_id
      and batch.status in ('approved', 'partially_approved', 'auto_approved')
      and batch.paid_at is null
    order by ordered_at, batch.id
    limit p_reimbursement_batch_limit + 1
  ), retained as materialized (
    select * from candidate
    order by ordered_at, id
    limit p_reimbursement_batch_limit
  )
  select least((select count(*) from candidate),
               p_reimbursement_batch_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', retained.id,
             'owed_amount', case
               when pg_catalog.lower(retained.owed_amount::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.owed_amount::text) > 64
                 then '__invalid__'
               else retained.owed_amount::text
             end,
             'line_count', retained.line_count,
             'currency_codes', pg_catalog.to_jsonb(retained.currency_codes)
           ) order by retained.ordered_at, retained.id
         ), '[]'::jsonb)
    into v_batch_count, v_batches
  from retained;

  with payment_totals as materialized (
    select payment.invoice_id,
           coalesce(pg_catalog.sum(payment.amount), 0::numeric) as paid_amount
    from public.payments payment
    where payment.company_id = p_company_id
      and payment.voided_at is null
      and payment.payment_date <= v_business_date
    group by payment.invoice_id
  ), candidate as materialized (
    select invoice.id as invoice_id,
           invoice.client_id as payer_id,
           invoice.total,
           invoice.amount_paid,
           invoice.balance_due,
           greatest(
             invoice.total - coalesce(payment_totals.paid_amount, 0::numeric),
             0::numeric
           ) as calculated_balance,
           invoice.due_date,
           invoice.status,
           invoice.sent_at,
           (
             exists (
               select 1 from public.invoices duplicate
               where duplicate.company_id = p_company_id
                 and duplicate.id <> invoice.id
                 and duplicate.deleted_at is null
                 and (
                   (invoice.qb_id is not null and duplicate.qb_id = invoice.qb_id)
                   or (invoice.sage_id is not null and duplicate.sage_id = invoice.sage_id)
                 )
             )
             or exists (
               select 1
               from public.payments payment
               join public.payments duplicate
                on duplicate.company_id = payment.company_id
                and duplicate.id <> payment.id
                and duplicate.voided_at is null
                and duplicate.payment_date <= v_business_date
                and (
                  (payment.qb_id is not null and duplicate.qb_id = payment.qb_id)
                  or (payment.sage_id is not null and duplicate.sage_id = payment.sage_id)
                  or (
                    payment.stripe_payment_intent is not null
                    and duplicate.stripe_payment_intent = payment.stripe_payment_intent
                  )
                )
               where payment.company_id = p_company_id
                 and payment.invoice_id = invoice.id
                 and payment.voided_at is null
                 and payment.payment_date <= v_business_date
             )
           ) as identity_conflict
    from public.invoices invoice
    left join payment_totals on payment_totals.invoice_id = invoice.id
    where invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and invoice.status in ('sent', 'awaiting_payment', 'partially_paid', 'past_due')
    order by invoice.due_date, invoice.id
    limit p_receivable_limit + 1
  ), retained as materialized (
    select * from candidate
    order by due_date, invoice_id
    limit p_receivable_limit
  )
  select least((select count(*) from candidate), p_receivable_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'invoice_id', retained.invoice_id,
             'payer_id', retained.payer_id,
             'total_amount', case
               when pg_catalog.lower(retained.total::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.total::text) > 64
                 then '__invalid__'
               else retained.total::text
             end,
             'stored_amount_paid', case
               when pg_catalog.lower(retained.amount_paid::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.amount_paid::text) > 64
                 then '__invalid__'
               else retained.amount_paid::text
             end,
             'stored_balance_due', case
               when pg_catalog.lower(retained.balance_due::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.balance_due::text) > 64
                 then '__invalid__'
               else retained.balance_due::text
             end,
             'calculated_balance', case
               when pg_catalog.lower(retained.calculated_balance::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.calculated_balance::text) > 64
                 then '__invalid__'
               else retained.calculated_balance::text
             end,
             'due_date', case
               when pg_catalog.isfinite(retained.due_date)
                 and extract(year from retained.due_date)
                   between 1 and 9999
                 then retained.due_date::text
               else '__invalid__'
             end,
             'status', retained.status,
             'sent_at', case
               when retained.sent_at is null then null
               when not pg_catalog.isfinite(retained.sent_at)
                 or extract(
                   year from retained.sent_at at time zone 'UTC'
                 ) not between 1 and 9999
                 then '__invalid__'
               else pg_catalog.to_char(
                 retained.sent_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               )
             end,
             'identity_conflict', retained.identity_conflict
           ) order by retained.due_date, retained.invoice_id
         ), '[]'::jsonb)
    into v_receivable_count, v_receivables
  from retained;

  with invoice_payment_source as materialized (
    select invoice.id as invoice_id,
           invoice.client_id as payer_id,
           invoice.due_date,
           invoice.total as invoice_total,
           payment.payment_date,
           payment.amount,
           (
             pg_catalog.lower(invoice.total::text) not in (
               'nan', 'infinity', '-infinity'
             )
             and pg_catalog.length(invoice.total::text) <= 64
             and pg_catalog.lower(payment.amount::text) not in (
               'nan', 'infinity', '-infinity'
             )
             and pg_catalog.length(payment.amount::text) <= 64
           ) as amount_valid,
           (
             exists (
               select 1 from public.invoices duplicate
               where duplicate.company_id = p_company_id
                 and duplicate.id <> invoice.id
                 and duplicate.deleted_at is null
                 and (
                   (invoice.qb_id is not null and duplicate.qb_id = invoice.qb_id)
                   or (invoice.sage_id is not null and duplicate.sage_id = invoice.sage_id)
                 )
             )
             or exists (
               select 1
               from public.payments same_payment
               join public.payments duplicate
                on duplicate.company_id = same_payment.company_id
                and duplicate.id <> same_payment.id
                and duplicate.voided_at is null
                and duplicate.payment_date <= v_business_date
                and (
                  (same_payment.qb_id is not null and duplicate.qb_id = same_payment.qb_id)
                  or (same_payment.sage_id is not null and duplicate.sage_id = same_payment.sage_id)
                  or (
                    same_payment.stripe_payment_intent is not null
                    and duplicate.stripe_payment_intent = same_payment.stripe_payment_intent
                  )
                )
               where same_payment.company_id = p_company_id
                 and same_payment.invoice_id = invoice.id
                 and same_payment.voided_at is null
                 and same_payment.payment_date <= v_business_date
             )
           ) as identity_conflict
    from public.invoices invoice
    join public.payments payment
     on payment.invoice_id = invoice.id
     and payment.company_id = p_company_id
     and payment.voided_at is null
     and payment.payment_date <= v_business_date
    where invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and (
        invoice.total > 0
        or pg_catalog.lower(invoice.total::text) in (
          'nan', 'infinity', '-infinity'
        )
        or pg_catalog.length(invoice.total::text) > 64
      )
  ), payment_daily as materialized (
    select invoice_payment_source.invoice_id,
           invoice_payment_source.payer_id,
           invoice_payment_source.due_date,
           invoice_payment_source.invoice_total,
           invoice_payment_source.payment_date,
           pg_catalog.sum(invoice_payment_source.amount) as daily_amount,
           pg_catalog.bool_and(invoice_payment_source.amount_valid)
             as amount_valid,
           pg_catalog.bool_or(invoice_payment_source.identity_conflict)
             as identity_conflict
    from invoice_payment_source
    group by invoice_payment_source.invoice_id,
             invoice_payment_source.payer_id,
             invoice_payment_source.due_date,
             invoice_payment_source.invoice_total,
             invoice_payment_source.payment_date
  ), payment_running as materialized (
    select payment_daily.*,
           pg_catalog.sum(payment_daily.daily_amount) over (
             partition by payment_daily.invoice_id
             order by payment_daily.payment_date
             rows between unbounded preceding and current row
           ) as cumulative_amount
    from payment_daily
  ), payment_sustained as materialized (
    select payment_running.*,
           pg_catalog.min(payment_running.cumulative_amount) over (
             partition by payment_running.invoice_id
             order by payment_running.payment_date
             rows between current row and unbounded following
           ) as future_minimum_amount
    from payment_running
  ), settlement as materialized (
    select payment_sustained.invoice_id,
           payment_sustained.payer_id,
           payment_sustained.due_date,
           pg_catalog.min(payment_sustained.payment_date) filter (
             where payment_sustained.future_minimum_amount >=
               payment_sustained.invoice_total
               or not payment_sustained.amount_valid
           ) as settled_on,
           pg_catalog.bool_and(payment_sustained.amount_valid) as amount_valid,
           pg_catalog.bool_or(payment_sustained.identity_conflict)
             as identity_conflict
    from payment_sustained
    group by payment_sustained.invoice_id,
             payment_sustained.payer_id,
             payment_sustained.due_date
  ), candidate as materialized (
    select settlement.invoice_id,
           settlement.payer_id,
           settlement.due_date,
           settlement.settled_on,
           case
             when pg_catalog.isfinite(settlement.settled_on)
               and pg_catalog.isfinite(settlement.due_date)
               then (settlement.settled_on - settlement.due_date)::integer
             else 0
           end as delay_days,
           settlement.identity_conflict,
           settlement.amount_valid
    from settlement
    where settlement.settled_on is not null
    order by settlement.settled_on desc, settlement.invoice_id
    limit p_payer_history_limit + 1
  ), retained as materialized (
    select * from candidate
    order by settled_on desc, invoice_id
    limit p_payer_history_limit
  )
  select least((select count(*) from candidate), p_payer_history_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'invoice_id', retained.invoice_id,
             'payer_id', retained.payer_id,
             'due_date', case
               when pg_catalog.isfinite(retained.due_date)
                 and extract(year from retained.due_date)
                   between 1 and 9999
                 then retained.due_date::text
               else '__invalid__'
             end,
             'settled_on', case
               when pg_catalog.isfinite(retained.settled_on)
                 and extract(year from retained.settled_on)
                   between 1 and 9999
                 then retained.settled_on::text
               else '__invalid__'
             end,
             'delay_days', retained.delay_days,
             'identity_conflict', retained.identity_conflict,
             'amount_valid', retained.amount_valid
           ) order by retained.settled_on desc, retained.invoice_id
         ), '[]'::jsonb)
    into v_history_count, v_history
  from retained;

  return pg_catalog.jsonb_build_object(
    'observed_at', pg_catalog.to_char(
      p_observed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'business_date', v_business_date,
    'target_date', p_target_date,
    'context', pg_catalog.jsonb_build_object(
      'company_id', p_company_id,
      'timezone', v_timezone,
      'currency_code', v_currency_code
    ),
    'source_revisions', pg_catalog.jsonb_build_object(
      'company', v_company_revision,
      'payroll_readiness', v_payroll_revision
    ),
    'settings', v_settings,
    'recurring_obligations', v_recurring,
    'reimbursement_batches', v_batches,
    'receivables', v_receivables,
    'payer_history', v_history,
    'source_counts', pg_catalog.jsonb_build_object(
      'recurring_obligations', v_recurring_count,
      'reimbursement_batches', v_batch_count,
      'receivables', v_receivable_count,
      'payer_history', v_history_count
    ),
    'source_bounds', pg_catalog.jsonb_build_object(
      'recurring_obligations',
        v_recurring_count > p_recurring_obligation_limit,
      'reimbursement_batches',
        v_batch_count > p_reimbursement_batch_limit,
      'receivables', v_receivable_count > p_receivable_limit,
      'payer_history', v_history_count > p_payer_history_limit
    )
  );
end;
$function$;

revoke all on function public.read_agent_payroll_readiness_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, date, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.read_agent_payroll_readiness_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, date, integer, integer, integer, integer
) to service_role;

commit;
