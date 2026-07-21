-- Payment Review must never report a close/write-off before Postgres has
-- committed the authoritative state. Both functions derive tenant and actor
-- from the verified Firebase JWT, enforce the exact row/action permissions,
-- preserve completion history, and keep write-off + close in one transaction.

-- `project_ref` is the canonical invoice relationship; `project_id` is the
-- legacy mirror. Outstanding-balance fencing must cover both representations.
create or replace function private.guard_closed_project_invoice_balance()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_project_id uuid;
  v_project_status text;
begin
  if new.project_ref is not null
     and new.project_id is not null
     and new.project_ref is distinct from new.project_id then
    raise exception 'invoice project references disagree'
      using errcode = '23514';
  end if;

  v_project_id := coalesce(new.project_ref, new.project_id);
  if v_project_id is null then
    return new;
  end if;

  select project.status
    into v_project_status
    from public.projects project
   where project.id = v_project_id
     and project.company_id = new.company_id
     and project.deleted_at is null
   for update;

  if not found then
    raise exception 'invoice project relationship is invalid'
      using errcode = '23503';
  end if;

  if new.deleted_at is not null
     or new.status = 'void'
     or coalesce(new.balance_due, 0) <= 0 then
    return new;
  end if;

  if v_project_status = 'closed' then
    raise exception 'reopen the project before adding an outstanding balance'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_closed_project_invoice_balance()
  from public, anon, authenticated, service_role;

drop trigger if exists invoices_guard_closed_project_balance
  on public.invoices;
create trigger invoices_guard_closed_project_balance
before insert or update of company_id, project_id, project_ref, balance_due, status, deleted_at
on public.invoices
for each row
execute function private.guard_closed_project_invoice_balance();

-- The paid-invoice convenience trigger predates the canonical `project_ref`
-- relationship. Keep it source-agnostic so a canonical-only invoice cannot be
-- paid without closing its completed project.
create or replace function public.close_project_when_fully_paid()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_project_id uuid := coalesce(new.project_ref, new.project_id);
  v_outstanding numeric(12,2);
  v_prior_source text := current_setting(
    'ops.project_status_system_source',
    true
  );
begin
  if v_project_id is null then
    return new;
  end if;

  select coalesce(sum(invoice.balance_due), 0)
    into v_outstanding
    from public.invoices invoice
   where coalesce(invoice.project_ref, invoice.project_id) = v_project_id
     and invoice.company_id = new.company_id
     and invoice.deleted_at is null
     and invoice.status <> 'void';

  if v_outstanding <= 0 then
    perform set_config(
      'ops.project_status_system_source',
      'paid_invoice',
      true
    );
    update public.projects
       set status = 'closed'
     where id = v_project_id
       and company_id = new.company_id
       and status = 'completed'
       and deleted_at is null;
    perform set_config(
      'ops.project_status_system_source',
      coalesce(v_prior_source, ''),
      true
    );
  end if;

  return new;
exception
  when others then
    perform set_config(
      'ops.project_status_system_source',
      coalesce(v_prior_source, ''),
      true
    );
    raise warning 'close_project_when_fully_paid failed for invoice % (project %): %',
      new.id, v_project_id, sqlerrm;
    return new;
end;
$function$;

revoke all on function public.close_project_when_fully_paid()
  from public, anon, authenticated, service_role;

-- A response can be lost after Postgres commits. The receipt ties a retry to
-- this exact write-off invocation instead of guessing from historical invoice
-- status, which is unsafe for provider-managed or legacy rows.
create table if not exists public.payment_review_writeoff_receipts (
  company_id uuid not null references public.companies(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  idempotency_key uuid not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  written_off_invoice_count integer not null
    check (written_off_invoice_count > 0),
  written_off_balance numeric not null check (written_off_balance > 0),
  created_at timestamptz not null default now(),
  primary key (company_id, project_id, idempotency_key)
);

alter table public.payment_review_writeoff_receipts enable row level security;
alter table public.payment_review_writeoff_receipts force row level security;
revoke all on table public.payment_review_writeoff_receipts
  from public, anon, authenticated;
grant select on table public.payment_review_writeoff_receipts to service_role;

create or replace function public.close_project_from_payment_review(
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_project public.projects%rowtype;
begin
  if auth.role() not in ('anon', 'authenticated')
     or v_actor_user_id is null
     or v_company_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  -- Permission and membership mutations take this same company-scoped lock.
  -- Holding it through commit prevents a concurrent revocation from racing a
  -- privileged financial action.
  perform private.lock_lead_assignment_company(v_company_id);
  perform 1
    from public.users actor
   where actor.id = v_actor_user_id
     and actor.company_id = v_company_id
     and actor.deleted_at is null
     and coalesce(actor.is_active, false)
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  perform 1
    from public.companies company
   where company.id = v_company_id
     and company.deleted_at is null
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  -- Authorize before taking broad locks. The state is re-read under lock below.
  select *
    into v_project
    from public.projects
   where id = p_project_id
     and company_id = v_company_id
     and deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'project_not_found';
  end if;
  if not private.user_can_edit_project(v_actor_user_id, p_project_id) then
    raise exception using errcode = '42501', message = 'project_edit_forbidden';
  end if;
  if not public.has_permission(v_actor_user_id, 'invoices.view', 'all')
     or not public.has_permission(v_actor_user_id, 'finances.view', 'all') then
    raise exception using errcode = '42501', message = 'invoice_financial_view_forbidden';
  end if;
  if v_project.status not in ('completed', 'closed') then
    raise exception using errcode = '40001', message = 'project_state_changed';
  end if;

  -- Canonical invoice writes take an invoice tuple before their project guard.
  -- Match that order, then lock the project to fence new positive-balance rows.
  perform 1
    from public.invoices invoice
   where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
     and invoice.company_id = v_company_id
     and invoice.deleted_at is null
   order by invoice.id
   for update;

  select *
    into v_project
    from public.projects
   where id = p_project_id
     and company_id = v_company_id
     and deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project_not_found';
  end if;
  if not private.user_can_edit_project(v_actor_user_id, p_project_id) then
    raise exception using errcode = '42501', message = 'project_edit_forbidden';
  end if;
  if not public.has_permission(v_actor_user_id, 'invoices.view', 'all')
     or not public.has_permission(v_actor_user_id, 'finances.view', 'all') then
    raise exception using errcode = '42501', message = 'invoice_financial_view_forbidden';
  end if;
  if v_project.status not in ('completed', 'closed') then
    raise exception using errcode = '40001', message = 'project_state_changed';
  end if;

  -- A local terminal status is not proof that a connected accounting ledger
  -- cleared its balance. Refuse to close until every provider-owned positive
  -- balance has been resolved at the provider and synchronized back to OPS.
  if exists (
    select 1
      from public.invoices invoice
     where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
       and invoice.company_id = v_company_id
       and invoice.deleted_at is null
       and coalesce(invoice.balance_due, 0) > 0
       and (invoice.qb_id is not null or invoice.sage_id is not null)
  ) then
    raise exception using
      errcode = '55000',
      message = 'external_accounting_writeoff_required';
  end if;

  if exists (
    select 1
      from public.invoices invoice
     where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
       and invoice.company_id = v_company_id
       and invoice.deleted_at is null
       and coalesce(invoice.balance_due, 0) > 0
       and invoice.status not in ('paid', 'void', 'written_off')
  ) then
    raise exception using
      errcode = '55000',
      message = 'invoice_balance_requires_resolution';
  end if;

  update public.projects
     set status = 'closed',
         updated_at = now()
   where id = p_project_id
     and status <> 'closed';

  return jsonb_build_object(
    'project_id', p_project_id,
    'status', 'closed',
    'already_closed', v_project.status = 'closed'
  );
end;
$$;

create or replace function public.write_off_project_from_payment_review(
  p_project_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_project public.projects%rowtype;
  v_receipt public.payment_review_writeoff_receipts%rowtype;
  v_invoice_count integer := 0;
  v_balance numeric := 0;
begin
  if auth.role() not in ('anon', 'authenticated')
     or v_actor_user_id is null
     or v_company_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_project_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'invalid_writeoff_request';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);
  perform 1
    from public.users actor
   where actor.id = v_actor_user_id
     and actor.company_id = v_company_id
     and actor.deleted_at is null
     and coalesce(actor.is_active, false)
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  perform 1
    from public.companies company
   where company.id = v_company_id
     and company.deleted_at is null
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  -- Authorize and validate the inexpensive project snapshot before taking every
  -- invoice lock. Every permission and state check is repeated before commit.
  select *
    into v_project
    from public.projects
   where id = p_project_id
     and company_id = v_company_id
     and deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'project_not_found';
  end if;
  if not private.user_can_edit_project(v_actor_user_id, p_project_id) then
    raise exception using errcode = '42501', message = 'project_edit_forbidden';
  end if;
  if not public.has_permission(v_actor_user_id, 'invoices.edit', 'all') then
    raise exception using errcode = '42501', message = 'invoice_edit_forbidden';
  end if;
  if not public.has_permission(v_actor_user_id, 'invoices.view', 'all')
     or not public.has_permission(v_actor_user_id, 'finances.view', 'all') then
    raise exception using errcode = '42501', message = 'invoice_financial_view_forbidden';
  end if;
  if v_project.status not in ('completed', 'closed') then
    raise exception using errcode = '40001', message = 'project_state_changed';
  end if;

  select receipt.*
    into v_receipt
    from public.payment_review_writeoff_receipts receipt
   where receipt.company_id = v_company_id
     and receipt.project_id = p_project_id
     and receipt.idempotency_key = p_idempotency_key;
  if found then
    select *
      into v_project
      from public.projects
     where id = p_project_id
       and company_id = v_company_id
       and deleted_at is null
     for update;
    if not found or v_project.status <> 'closed' then
      raise exception using errcode = '40001', message = 'project_state_changed';
    end if;
    return jsonb_build_object(
      'project_id', p_project_id,
      'status', 'closed',
      'written_off_invoice_count', v_receipt.written_off_invoice_count,
      'written_off_balance', v_receipt.written_off_balance,
      'already_written_off', true
    );
  end if;

  -- Invoice -> project is the one canonical lock order. No project lock is held
  -- while balances are zeroed, so invoice guards cannot form the inverse edge.
  perform 1
    from public.invoices invoice
   where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
     and invoice.company_id = v_company_id
     and invoice.deleted_at is null
   order by invoice.id
   for update;

  -- A concurrent request with the same key can pass the first receipt lookup
  -- before the winning transaction commits, then wait here on its invoice
  -- locks. Re-read after that serialization point so a lost-response retry is
  -- exactly-once even when both requests arrive together.
  select receipt.*
    into v_receipt
    from public.payment_review_writeoff_receipts receipt
   where receipt.company_id = v_company_id
     and receipt.project_id = p_project_id
     and receipt.idempotency_key = p_idempotency_key;
  if found then
    select *
      into v_project
      from public.projects
     where id = p_project_id
       and company_id = v_company_id
       and deleted_at is null
     for update;
    if not found or v_project.status <> 'closed' then
      raise exception using errcode = '40001', message = 'project_state_changed';
    end if;
    return jsonb_build_object(
      'project_id', p_project_id,
      'status', 'closed',
      'written_off_invoice_count', v_receipt.written_off_invoice_count,
      'written_off_balance', v_receipt.written_off_balance,
      'already_written_off', true
    );
  end if;

  if exists (
    select 1
      from public.invoices invoice
     where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
       and invoice.company_id = v_company_id
       and invoice.deleted_at is null
       and coalesce(invoice.balance_due, 0) > 0
       and invoice.status not in (
         'sent', 'awaiting_payment', 'partially_paid', 'past_due',
         'paid', 'void', 'written_off'
       )
  ) then
    raise exception using
      errcode = '55000',
      message = 'invoice_not_writeoff_eligible';
  end if;

  -- Provider-linked invoices are owned by the connected accounting ledger.
  -- Mutating only OPS would be overwritten by the next provider sync and could
  -- silently reopen a closed project with debt still outstanding upstream.
  if exists (
    select 1
      from public.invoices invoice
     where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
       and invoice.company_id = v_company_id
       and invoice.deleted_at is null
       and coalesce(invoice.balance_due, 0) > 0
       and (invoice.qb_id is not null or invoice.sage_id is not null)
  ) then
    raise exception using
      errcode = '55000',
      message = 'external_accounting_writeoff_required';
  end if;

  select count(*)::integer, coalesce(sum(invoice.balance_due), 0)
    into v_invoice_count, v_balance
    from public.invoices invoice
   where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
     and invoice.company_id = v_company_id
     and invoice.deleted_at is null
     and coalesce(invoice.balance_due, 0) > 0
     and invoice.status in ('sent', 'awaiting_payment', 'partially_paid', 'past_due');

  if v_invoice_count > 0 then
    update public.invoices invoice
       set status = 'written_off',
           balance_due = 0,
           updated_at = now()
     where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
       and invoice.company_id = v_company_id
       and invoice.deleted_at is null
       and coalesce(invoice.balance_due, 0) > 0
       and invoice.status in ('sent', 'awaiting_payment', 'partially_paid', 'past_due');
  end if;

  -- Fence new invoices and revalidate project state/permissions after the
  -- invoice mutation. Any failure below rolls the whole write-off back.
  select *
    into v_project
    from public.projects
   where id = p_project_id
     and company_id = v_company_id
     and deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project_not_found';
  end if;
  if not private.user_can_edit_project(v_actor_user_id, p_project_id) then
    raise exception using errcode = '42501', message = 'project_edit_forbidden';
  end if;
  if not public.has_permission(v_actor_user_id, 'invoices.edit', 'all') then
    raise exception using errcode = '42501', message = 'invoice_edit_forbidden';
  end if;
  if not public.has_permission(v_actor_user_id, 'invoices.view', 'all')
     or not public.has_permission(v_actor_user_id, 'finances.view', 'all') then
    raise exception using errcode = '42501', message = 'invoice_financial_view_forbidden';
  end if;
  if v_project.status not in ('completed', 'closed') then
    raise exception using errcode = '40001', message = 'project_state_changed';
  end if;

  -- Repeat the provider fence after the project lock. An accounting-linked
  -- invoice could have committed between the initial invoice snapshot and this
  -- fence; even a locally marked paid/void/written_off row is not proof that
  -- the provider ledger cleared its positive balance.
  if exists (
    select 1
      from public.invoices invoice
     where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
       and invoice.company_id = v_company_id
       and invoice.deleted_at is null
       and coalesce(invoice.balance_due, 0) > 0
       and (invoice.qb_id is not null or invoice.sage_id is not null)
  ) then
    raise exception using
      errcode = '55000',
      message = 'external_accounting_writeoff_required';
  end if;

  -- A positive invoice committed before the project fence is visible here. A
  -- later insert blocks on the project and is rejected once it becomes closed.
  if exists (
    select 1
      from public.invoices invoice
     where coalesce(invoice.project_ref, invoice.project_id) = p_project_id
       and invoice.company_id = v_company_id
       and invoice.deleted_at is null
       and coalesce(invoice.balance_due, 0) > 0
       and invoice.status not in ('paid', 'void', 'written_off')
  ) then
    raise exception using errcode = '40001', message = 'invoice_set_changed';
  end if;

  if v_invoice_count = 0 then
    raise exception using errcode = 'P0002', message = 'no_outstanding_invoices';
  end if;

  update public.projects
     set status = 'closed',
         updated_at = now()
   where id = p_project_id
     and status <> 'closed';

  insert into public.payment_review_writeoff_receipts (
    company_id,
    project_id,
    idempotency_key,
    actor_user_id,
    written_off_invoice_count,
    written_off_balance
  ) values (
    v_company_id,
    p_project_id,
    p_idempotency_key,
    v_actor_user_id,
    v_invoice_count,
    v_balance
  );

  return jsonb_build_object(
    'project_id', p_project_id,
    'status', 'closed',
    'written_off_invoice_count', v_invoice_count,
    'written_off_balance', v_balance,
    'already_written_off', false
  );
end;
$$;

revoke all on function public.close_project_from_payment_review(uuid) from public;
revoke all on function public.write_off_project_from_payment_review(uuid, uuid) from public;
grant execute on function public.close_project_from_payment_review(uuid) to anon, authenticated;
grant execute on function public.write_off_project_from_payment_review(uuid, uuid)
  to anon, authenticated;
