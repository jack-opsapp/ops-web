\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 fixture for the account-closure proof. Never apply
-- to an OPS database. Loaded after the released expense chain and the
-- recurring reimbursement migration (byte-identical to production ledger
-- 20260917023953); see scripts/test-company-data-purge-expense-postgres.sh.
--
-- Everything below is copied from read-only production metadata taken
-- 2026-09-17 (project ijeekuhbatykdomumfjx): function bodies verbatim, trigger
-- definitions, foreign keys with their delete actions, and service_role table
-- privileges for every table the closure plan touches in this harness.
-- tests/sql/company-data-purge-expense-fidelity.sql proves the copies by
-- comparing md5(pg_get_functiondef) and pg_get_triggerdef with production.

-- ── PostgREST identities ──────────────────────────────────────────────────
-- API requests log in as authenticator (never postgres) and SET ROLE to the
-- request role. service_role bypasses RLS in production.
do $$ begin create role authenticator login noinherit; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;
alter role service_role bypassrls;

-- ── Agent read-domain registry ────────────────────────────────────────────
-- The revision helper itself is already byte-identical to production; the
-- earlier fixtures register only three domains. Production registers these.
insert into private.agent_read_domains(domain)
select domain
from unnest(array['artifacts','availability','catalog','company','customer','deck_designs','expenses',
  'integrations','payments','payroll_readiness','purchasing','sales_documents','sales_truth',
  'site_visits','tasks','team','work_queue']) as production(domain)
where not exists (select 1 from private.agent_read_domains existing where existing.domain = production.domain);

-- ── Remaining live triggers on the closure path ───────────────────────────
CREATE OR REPLACE FUNCTION private.bump_agent_artifact_expense_allocation_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_expense_id uuid;
  v_new_expense_id uuid;
  v_company_ids uuid[];
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE')
     or tg_nargs is distinct from 0 then
    raise exception 'agent_artifact_expense_allocation_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_expense_id := old.expense_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_expense_id := new.expense_id;
  end if;

  select pg_catalog.array_agg(source.company_id order by source.company_id)
    into v_company_ids
  from (
    select distinct expense.company_id
    from public.expenses expense
    where expense.id = any(array[v_old_expense_id, v_new_expense_id])
      and expense.company_id is not null
  ) source;

  perform private.advance_agent_read_domain_revisions(
    v_company_ids,
    'artifacts'
  );
  return null;
end;
$function$
;
create trigger expense_project_allocations_bump_agent_artifact_revision after insert or delete or update on public.expense_project_allocations
  for each row execute function private.bump_agent_artifact_expense_allocation_revision();
create trigger expense_project_allocations_bump_agent_expense_revision after insert or delete or update on public.expense_project_allocations
  for each row execute function private.bump_agent_expense_source_revision();
create trigger expense_categories_bump_agent_expense_revision after insert or delete or update on public.expense_categories
  for each row execute function private.bump_agent_expense_source_revision();
create trigger expense_settings_agent_payroll_source_revision_v1 after insert or delete or update on public.expense_settings
  for each row execute function private.bump_agent_read_domain_revision('payroll_readiness', 'company_id');

-- The live body keeps CRLF line endings; build it byte-exact.
do $crlf$
begin
  execute 'CREATE OR REPLACE FUNCTION public.update_accounting_connections_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path TO ''public'', ''pg_temp'' AS $function$'
    || E'\r\nBEGIN\r\n  NEW.updated_at = now();\r\n  RETURN NEW;\r\nEND;\r\n'
    || '$function$';
end;
$crlf$;
create trigger set_accounting_connections_updated_at before update on public.accounting_connections
  for each row execute function public.update_accounting_connections_updated_at();
create trigger accounting_connections_bump_agent_integrations_revision
  after insert or delete or update of company_id, provider, provider_environment, is_connected, sync_enabled, last_sync_at
  on public.accounting_connections
  for each row execute function private.bump_agent_read_domain_revision('integrations', 'company_id');

create table public.estimates (
  id uuid primary key,
  company_id uuid not null,
  distribution_hold boolean not null default false
);
CREATE OR REPLACE FUNCTION private.guard_financial_document_distribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
begin
 if new.entity_type='estimate' and exists(select 1 from public.estimates where id=new.entity_id and company_id=new.company_id and distribution_hold) then return null; end if;
 return new;
end $function$
;
create trigger accounting_sync_queue_private_drafts before insert or update on public.accounting_sync_queue
  for each row execute function private.guard_financial_document_distribution();

-- ── Production foreign keys among the closure harness tables ──────────────
-- Converge every key to its exact production definition: add it when missing,
-- replace it when an earlier fixture declared it differently.
do $fk$
declare
  v_key record;
  v_current text;
begin
  for v_key in
    select * from (values
      ('public.users', 'users_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL'),
      ('public.projects', 'projects_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE'),
      ('public.expense_batches', 'expense_batches_parent_batch_id_fkey', 'FOREIGN KEY (parent_batch_id) REFERENCES expense_batches(id)'),
      ('public.expenses', 'expenses_batch_id_fkey', 'FOREIGN KEY (batch_id) REFERENCES expense_batches(id)'),
      ('public.expenses', 'expenses_category_id_fkey', 'FOREIGN KEY (category_id) REFERENCES expense_categories(id)'),
      ('public.expenses', 'expenses_flagged_by_fkey', 'FOREIGN KEY (flagged_by) REFERENCES users(id)'),
      ('public.expense_project_allocations', 'expense_project_allocations_expense_id_fkey', 'FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE'),
      ('public.accounting_sync_queue', 'accounting_sync_queue_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE CASCADE'),
      ('public.accounting_sync_events', 'accounting_sync_events_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE SET NULL'),
      ('public.accounting_sync_events', 'accounting_sync_events_queue_id_fkey', 'FOREIGN KEY (queue_id) REFERENCES accounting_sync_queue(id) ON DELETE SET NULL'),
      ('public.notifications', 'notifications_resolved_by_fkey', 'FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL')
    ) as keys(table_name, constraint_name, definition)
  loop
    select pg_get_constraintdef(c.oid) into v_current
    from pg_constraint c
    where c.conrelid = v_key.table_name::regclass and c.conname = v_key.constraint_name;
    if v_current is distinct from v_key.definition then
      if v_current is not null then
        execute format('alter table %s drop constraint %I', v_key.table_name, v_key.constraint_name);
      end if;
      execute format('alter table %s add constraint %I %s', v_key.table_name, v_key.constraint_name, v_key.definition);
    end if;
  end loop;
end;
$fk$;

-- ── Try OPS health receipts (production ledger 20260914222840) ────────────
create table public.tryops_runs (id uuid primary key);
create table public.tryops_health_notifications (
  dedupe_key text primary key,
  run_id uuid references public.tryops_runs(id),
  reason text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  notification_id uuid references public.notifications(id),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);

-- ── Stubs the supplier-bill purge migration alters when applied verbatim ──
create table public.phase_c_bilateral_event_handoffs (id uuid primary key);
create table public.site_visits (
  id uuid primary key,
  appointment_handoff_id uuid,
  constraint site_visits_appointment_handoff_id_fkey
    foreign key (appointment_handoff_id) references public.phase_c_bilateral_event_handoffs(id)
);

-- ── Production service_role privileges on every closure harness table ────
grant select, insert, update, delete on
  public.companies, public.users, public.projects, public.expenses,
  public.expense_project_allocations, public.expense_batches, public.expense_categories,
  public.expense_settings, public.expense_recurring_reimbursements,
  public.accounting_connections, public.accounting_sync_queue, public.accounting_sync_events,
  public.notifications, public.tryops_health_notifications
to service_role;
