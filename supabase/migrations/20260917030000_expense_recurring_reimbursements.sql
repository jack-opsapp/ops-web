-- Recurring reimbursements.
--
-- A fixed monthly amount the office pays a crew member with their expenses,
-- for example "Vehicle advertising, CA$350.00 a month". The office sets it up
-- once. The database then adds one pre-approved line to that person's
-- envelope for every month, including months with no receipts. Each line rides
-- the ordinary envelope lifecycle: review, approval, Mark paid, payroll
-- readiness and accounting capture are unchanged.
--
-- Rules:
--   * A month's line joins the envelope for its first day. If that envelope is
--     approved but not paid, the line joins it (the office already owes that
--     period). If it was already paid out, the line rolls forward to today's
--     envelope and still names its own month.
--   * Lines are office-owned. Nobody edits, flags or deletes one directly;
--     setup commands change them inside an unforgeable transaction scope.
--     Payout stamps and approval stamps still move freely.
--   * Skip removes one unpaid month. Restore brings it back. Ending never
--     removes lines. Delete removes the setup and every line, and is refused
--     once any month has been paid.
--   * Every additive column is nullable; shipped iOS builds read the lines as
--     ordinary approved expenses with a no-receipt note.
begin;

-- Fail closed if a parallel release changed the expense machinery these
-- commands build on. The second hash of each replaced function is this exact
-- implementation, so reapplying the migration is safe.
do $$
begin
  if to_regprocedure('private.lock_expense_approver_context()') is null
    or to_regclass('private.expense_correction_scope') is null
    or to_regclass('public.expense_accounting_events') is null
    or not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='expense_batches' and column_name='reimbursement_amount')
    or not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='companies' and column_name='currency_code') then
    raise exception 'Install the expense release (decisions, accounting lifecycle and corrections) first';
  end if;
  if md5(pg_get_functiondef('public.place_expense(uuid)'::regprocedure))<>'5d3a1254421fc4378f9b9a32d4cc3bd5'
    or md5(pg_get_functiondef('public.tg_place_expense()'::regprocedure))<>'258dc02efee98372f6205e731ac0251f'
    or md5(pg_get_functiondef('public.get_or_create_open_batch(uuid,uuid,date,date,uuid)'::regprocedure))<>'243314b13e3a19dc91787eee29b1de6d'
    or md5(pg_get_functiondef('public.recalculate_expense_batch_total(uuid)'::regprocedure))<>'8781e28a7a0485dc02b1d06eefcc8a22'
    or md5(pg_get_functiondef('public.expense_envelope_period(date,text)'::regprocedure))<>'f2245029594013ed33ff380558f11f8a'
    or md5(pg_get_functiondef('private.execute_expense_decision(text,uuid)'::regprocedure))<>'66d32835f9c4e6027e39e3897d599809'
    or md5(pg_get_functiondef('private.lock_expense_approver_context()'::regprocedure))<>'0d1c657a02e2df56bed9da57bad63116'
    or md5(pg_get_functiondef('private.enforce_expense_accounting_authority()'::regprocedure))<>'15919972aa7bced567a0ae3dfff5a807'
    or md5(pg_get_functiondef('private.enforce_expense_edit_authority()'::regprocedure)) not in
      ('d342596cd9e55adf458239a7025dfeaa','1955996bf8bcff1b568ab1ea3776b47c')
    or md5(pg_get_functiondef('public.expense_envelope_sweep()'::regprocedure)) not in
      ('aa4be69a2553c815cf242bbd7b43f684','b8aef34bc63889db33a6a2dd6cbf6ace') then
    raise exception 'Expense placement, decisions, authority or the envelope sweep changed; review the recurring reimbursement migration before applying';
  end if;
end $$;

-- ─── Setup ─────────────────────────────────────────────────────────────────

create table if not exists public.expense_recurring_reimbursements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  name text not null,
  amount numeric not null,
  currency text not null,
  category_id uuid references public.expense_categories(id),
  first_period date not null,
  last_period date,
  next_period date not null,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint expense_recurring_reimbursements_name_check
    check (name=btrim(name) and char_length(name) between 1 and 80 and name !~ '[[:cntrl:]]'),
  constraint expense_recurring_reimbursements_amount_check
    check (amount>0 and amount<=10000 and amount=round(amount,2)),
  constraint expense_recurring_reimbursements_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint expense_recurring_reimbursements_period_check check (
    extract(day from first_period)=1 and extract(day from next_period)=1 and next_period>=first_period
    and (last_period is null or (extract(day from last_period)=1 and last_period>=first_period))),
  constraint expense_recurring_reimbursements_deleted_check check ((deleted_at is null)=(deleted_by is null))
);
comment on table public.expense_recurring_reimbursements is
  'Fixed monthly reimbursements the office pays a crew member with their expenses. One pre-approved expenses line per month (expenses.recurring_reimbursement_id + recurring_period). Written only through the recurring reimbursement RPCs.';
comment on column public.expense_recurring_reimbursements.next_period is
  'Watermark: the first month not yet considered by the generator. Months passed while the person was inactive are not backfilled.';

create index if not exists expense_recurring_reimbursements_company_user_idx
  on public.expense_recurring_reimbursements(company_id,user_id) where deleted_at is null;
create index if not exists expense_recurring_reimbursements_due_idx
  on public.expense_recurring_reimbursements(next_period) where deleted_at is null;
create index if not exists expense_recurring_reimbursements_category_idx
  on public.expense_recurring_reimbursements(category_id) where category_id is not null;

alter table public.expense_recurring_reimbursements enable row level security;
revoke all on public.expense_recurring_reimbursements from public,anon,authenticated;
grant select on public.expense_recurring_reimbursements to anon,authenticated;
grant select,insert,update,delete on public.expense_recurring_reimbursements to service_role;

drop policy if exists expense_recurring_reimbursements_read on public.expense_recurring_reimbursements;
-- Office (expense view/approve across the company) reads every setup; a crew
-- member reads the ones paid to them.
create policy expense_recurring_reimbursements_read on public.expense_recurring_reimbursements
  for select to public
  using (
    company_id=(select private.get_user_company_id())
    and (
      coalesce(private.current_user_is_admin(),false)
      or private.current_user_scope_for('expenses.view')='all'
      or private.current_user_scope_for('expenses.approve')='all'
      or user_id=(select private.get_current_user_id())
    )
  );

alter table public.expense_recurring_reimbursements replica identity full;
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='expense_recurring_reimbursements') then
    alter publication supabase_realtime add table public.expense_recurring_reimbursements;
  end if;
end $$;

-- ─── Lines ─────────────────────────────────────────────────────────────────

alter table public.expenses add column if not exists recurring_reimbursement_id uuid;
alter table public.expenses add column if not exists recurring_period date;
comment on column public.expenses.recurring_reimbursement_id is
  'Set on the monthly line a recurring reimbursement adds. Null for ordinary receipts.';
comment on column public.expenses.recurring_period is
  'First day of the month a recurring reimbursement line pays for.';

do $$
begin
  if not exists(select 1 from pg_constraint where conname='expenses_recurring_reimbursement_id_fkey'
    and conrelid='public.expenses'::regclass) then
    alter table public.expenses add constraint expenses_recurring_reimbursement_id_fkey
      foreign key (recurring_reimbursement_id) references public.expense_recurring_reimbursements(id);
  end if;
  if not exists(select 1 from pg_constraint where conname='expenses_recurring_period_check'
    and conrelid='public.expenses'::regclass) then
    alter table public.expenses add constraint expenses_recurring_period_check check (
      (recurring_reimbursement_id is null)=(recurring_period is null)
      and (recurring_period is null or extract(day from recurring_period)=1));
  end if;
end $$;

-- One line per month per setup, including skipped (soft-deleted) months, so a
-- skipped month is never regenerated.
create unique index if not exists expenses_recurring_reimbursement_period_key
  on public.expenses(recurring_reimbursement_id,recurring_period)
  where recurring_reimbursement_id is not null;

-- Short-lived capability proving the current transaction is a recurring
-- reimbursement command. Clients cannot write it or forge it with a GUC.
create table if not exists private.expense_recurring_reimbursement_scope (
  transaction_id xid8 not null,
  company_id uuid not null,
  actor_id uuid not null,
  primary key (transaction_id,company_id)
);
alter table private.expense_recurring_reimbursement_scope enable row level security;
revoke all on private.expense_recurring_reimbursement_scope from public,anon,authenticated,service_role;

-- ─── Helpers ───────────────────────────────────────────────────────────────

create or replace function private.expense_recurring_month_start(p_date date)
returns date
language sql
immutable
set search_path to ''
as $$
  select case when p_date is null then null
    else make_date(extract(year from p_date)::integer,extract(month from p_date)::integer,1) end
$$;

-- Money renders en_US with a per-record currency prefix on every surface
-- (Money Rendering Canon): $350.00, CA$350.00.
create or replace function private.expense_recurring_money_text(p_amount numeric,p_currency text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case upper(coalesce(p_currency,'USD'))
      when 'USD' then '$' when 'CAD' then 'CA$' when 'AUD' then 'A$' when 'NZD' then 'NZ$'
      when 'EUR' then '€' when 'GBP' then '£'
      else upper(p_currency)||' ' end
    ||to_char(p_amount,'FM999,999,990.00')
$$;

create or replace function private.expense_recurring_company_today(p_company_id uuid)
returns date
language sql
stable
security definer
set search_path to ''
as $$
  select (clock_timestamp() at time zone coalesce(tz.name,'UTC'))::date
  from public.companies c
  left join pg_catalog.pg_timezone_names tz on tz.name=c.timezone
  where c.id=p_company_id and c.deleted_at is null
$$;

create or replace function private.expense_recurring_validate(p_name text,p_amount numeric)
returns void
language plpgsql
immutable
set search_path to ''
as $$
begin
  if p_name is null or char_length(p_name) not between 1 and 80 or p_name ~ '[[:cntrl:]]' then
    raise exception 'Name it in 80 characters or fewer.' using errcode='22023';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>10000 or p_amount<>round(p_amount,2) then
    raise exception 'Enter an amount from 0.01 to 10,000.00.' using errcode='22023';
  end if;
end $$;

create or replace function private.expense_recurring_validate_category(
  p_company_id uuid,p_category_id uuid,p_current_category_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if p_category_id is not null and not exists(select 1 from public.expense_categories c
    where c.id=p_category_id and c.company_id=p_company_id
      and (coalesce(c.is_active,true) or c.id is not distinct from p_current_category_id)) then
    raise exception 'That category is unavailable.' using errcode='23503';
  end if;
end $$;

-- The envelope a recurring line for p_period belongs in. Locks and returns it,
-- creating the period's open envelope when none can take the line.
create or replace function private.expense_recurring_target_batch(
  p_company_id uuid,p_user_id uuid,p_period date)
returns public.expense_batches
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_frequency text;
  v_date date:=p_period;
  v_start date;
  v_end date;
  v_today date;
  v_batch public.expense_batches;
begin
  select coalesce(s.review_frequency,'monthly') into v_frequency
    from public.expense_settings s where s.company_id=p_company_id;
  v_frequency:=coalesce(v_frequency,'monthly');
  for v_attempt in 1..2 loop
    if v_frequency='per_job' then
      -- Per-job envelopes are scoped to a job. A reimbursement belongs to no
      -- job, so it keeps a calendar-month envelope of its own.
      v_start:=private.expense_recurring_month_start(v_date);
      v_end:=((v_start+interval '1 month')::date-1);
    else
      select e.period_start,e.period_end into v_start,v_end
        from public.expense_envelope_period(v_date,v_frequency) e;
    end if;

    -- Still filling, or with the office for review.
    select b.* into v_batch from public.expense_batches b
      where b.company_id=p_company_id and b.submitted_by=p_user_id and b.amendment_number=0
        and b.scope_project_id is null and b.period_start=v_start and b.period_end=v_end
        and b.status in ('open','pending_review','submitted')
      order by b.created_at desc limit 1
      for update;
    if found then return v_batch; end if;

    -- Approved and still owed: the office already owes this period.
    select b.* into v_batch from public.expense_batches b
      where b.company_id=p_company_id and b.submitted_by=p_user_id and b.amendment_number=0
        and b.scope_project_id is null and b.period_start=v_start and b.period_end=v_end
        and b.status in ('approved','auto_approved','partially_approved') and b.paid_at is null
      order by b.created_at desc limit 1
      for update;
    if found then return v_batch; end if;

    -- Already paid out: roll forward to the envelope for today.
    if v_attempt=1 and exists(select 1 from public.expense_batches b
      where b.company_id=p_company_id and b.submitted_by=p_user_id and b.amendment_number=0
        and b.scope_project_id is null and b.period_start=v_start and b.period_end=v_end
        and b.status in ('approved','auto_approved','partially_approved') and b.paid_at is not null) then
      v_today:=private.expense_recurring_company_today(p_company_id);
      if v_today is not null and v_today>v_end then
        v_date:=v_today;
        continue;
      end if;
    end if;
    exit;
  end loop;

  v_batch:=public.get_or_create_open_batch(p_company_id,p_user_id,v_start,v_end,null);
  select b.* into strict v_batch from public.expense_batches b where b.id=v_batch.id for update;
  return v_batch;
end $$;

-- Adds every due month for one setup. Idempotent: a month that already has a
-- line (including a skipped one) is never written again.
create or replace function private.generate_expense_recurring_lines_for(p_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.expense_recurring_reimbursements;
  v_today date;
  v_current date;
  v_period date;
  v_batch public.expense_batches;
  v_requires_project boolean;
  v_count integer:=0;
begin
  select * into v_row from public.expense_recurring_reimbursements where id=p_id for update;
  if not found or v_row.deleted_at is not null then return 0; end if;
  v_today:=private.expense_recurring_company_today(v_row.company_id);
  if v_today is null then return 0; end if;
  v_current:=private.expense_recurring_month_start(v_today);
  select coalesce(s.require_project_assignment,false) into v_requires_project
    from public.expense_settings s where s.company_id=v_row.company_id;
  v_period:=v_row.next_period;

  while v_period<=v_current and (v_row.last_period is null or v_period<=v_row.last_period) loop
    if exists(select 1 from public.users u where u.id=v_row.user_id and u.company_id=v_row.company_id
        and coalesce(u.is_active,false) and u.deleted_at is null)
      and not exists(select 1 from public.expenses e
        where e.recurring_reimbursement_id=v_row.id and e.recurring_period=v_period) then
      v_batch:=private.expense_recurring_target_batch(v_row.company_id,v_row.user_id,v_period);
      insert into public.expenses(
        company_id,submitted_by,status,category_id,merchant_name,description,amount,currency,
        expense_date,payment_method,batch_id,approved_by,approved_at,
        receipt_missing_reason,receipt_missing_note,project_missing_reason,
        recurring_reimbursement_id,recurring_period)
      values (
        v_row.company_id,v_row.user_id,'approved',v_row.category_id,v_row.name,
        'Monthly · '||to_char(v_period,'FMMonth YYYY'),v_row.amount,v_row.currency,
        v_period,null,v_batch.id,v_row.updated_by,clock_timestamp(),
        'other','Recurring reimbursement. No receipt needed.',
        case when coalesce(v_requires_project,false) then 'overhead' end,
        v_row.id,v_period);
      perform public.recalculate_expense_batch_total(v_batch.id);
      v_count:=v_count+1;
    end if;
    v_period:=(v_period+interval '1 month')::date;
  end loop;

  if v_period>v_row.next_period then
    update public.expense_recurring_reimbursements set next_period=v_period where id=v_row.id;
  end if;
  return v_count;
end $$;

-- A returned (rejected) envelope waits on the crew, who cannot touch an
-- office-owned line. Move such lines to where they will be paid.
create or replace function private.rescue_expense_recurring_lines()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_line record;
  v_batch public.expense_batches;
  v_count integer:=0;
begin
  for v_line in
    select e.id,e.company_id,e.submitted_by,e.recurring_period,e.batch_id
    from public.expenses e
    join public.expense_batches b on b.id=e.batch_id
    where e.recurring_reimbursement_id is not null and e.deleted_at is null and e.status='approved'
      and b.status='rejected'
    order by e.company_id,e.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('save_expense_atomic:'||v_line.company_id::text,0));
    v_batch:=private.expense_recurring_target_batch(v_line.company_id,v_line.submitted_by,v_line.recurring_period);
    update public.expenses set batch_id=v_batch.id
      where id=v_line.id and batch_id=v_line.batch_id and deleted_at is null and status='approved';
    if found then
      perform public.recalculate_expense_batch_total(v_line.batch_id);
      perform public.recalculate_expense_batch_total(v_batch.id);
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end $$;

-- Daily entry point (called by the envelope sweep). One failing setup never
-- blocks the others or the sweep's own sends.
create or replace function private.generate_expense_recurring_lines()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_setup record;
  v_count integer:=0;
begin
  for v_setup in
    select r.id,r.company_id from public.expense_recurring_reimbursements r
    where r.deleted_at is null and (r.last_period is null or r.next_period<=r.last_period)
    order by r.company_id,r.id
  loop
    begin
      perform pg_advisory_xact_lock(hashtextextended('save_expense_atomic:'||v_setup.company_id::text,0));
      v_count:=v_count+private.generate_expense_recurring_lines_for(v_setup.id);
    exception when others then
      raise warning 'recurring reimbursement % was not generated [%]: %',v_setup.id,sqlstate,sqlerrm;
    end;
  end loop;
  begin
    v_count:=v_count+private.rescue_expense_recurring_lines();
  exception when others then
    raise warning 'recurring reimbursement rescue failed [%]: %',sqlstate,sqlerrm;
  end;
  return v_count;
end $$;

create or replace function private.expense_recurring_reimbursement_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select to_jsonb(r)||jsonb_build_object('lines',coalesce((
    select jsonb_agg(jsonb_build_object(
      'expense_id',e.id,'period',e.recurring_period,'batch_id',e.batch_id,'status',e.status,
      'amount',e.amount,'deleted',e.deleted_at is not null) order by e.recurring_period)
    from public.expenses e where e.recurring_reimbursement_id=r.id),'[]'::jsonb))
  from public.expense_recurring_reimbursements r
  where r.id=p_id
$$;

-- Resolves the approver, takes the company expense lock and opens the
-- transaction scope. Every command calls this first.
create or replace function private.expense_recurring_lock_actor()
returns table(actor_id uuid,company_id uuid)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=private.get_current_user_id();
  v_company uuid:=private.get_user_company_id();
  v_context record;
begin
  if v_actor is null or v_company is null or not public.has_permission(v_actor,'expenses.approve','all') then
    raise exception 'You do not have permission to manage recurring reimbursements.' using errcode='42501';
  end if;
  -- Same serialization namespace as saves, corrections and decisions.
  perform pg_advisory_xact_lock(hashtextextended('save_expense_atomic:'||v_company::text,0));
  select * into v_context from private.lock_expense_approver_context();
  if v_context.actor_id is distinct from v_actor or v_context.company_id is distinct from v_company then
    raise exception 'Your access changed. Reload and try again.' using errcode='40001';
  end if;
  insert into private.expense_recurring_reimbursement_scope(transaction_id,company_id,actor_id)
    values (pg_current_xact_id(),v_company,v_actor)
    on conflict on constraint expense_recurring_reimbursement_scope_pkey
    do update set actor_id=excluded.actor_id;
  return query select v_actor,v_company;
end $$;

create or replace function private.expense_recurring_release_scope()
returns void
language sql
security definer
set search_path to ''
as $$
  delete from private.expense_recurring_reimbursement_scope where transaction_id=pg_current_xact_id();
$$;

create or replace function private.expense_recurring_lock_setup(
  p_id uuid,p_company_id uuid,p_expected_updated_at timestamptz)
returns public.expense_recurring_reimbursements
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.expense_recurring_reimbursements;
begin
  select * into v_row from public.expense_recurring_reimbursements
    where id=p_id and company_id=p_company_id
    for update nowait;
  if not found or v_row.deleted_at is not null then
    raise exception 'This recurring reimbursement is no longer available.' using errcode='42501';
  end if;
  if p_expected_updated_at is null or v_row.updated_at<>p_expected_updated_at then
    raise exception 'This recurring reimbursement changed. Reload and try again.' using errcode='P0001';
  end if;
  return v_row;
end $$;

-- Locks every envelope holding one of the setup's unpaid lines, then the lines,
-- in the same parent-then-child order as expense decisions.
create or replace function private.expense_recurring_lock_unpaid_lines(p_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_batches uuid[];
begin
  select coalesce(array_agg(distinct e.batch_id order by e.batch_id),'{}') into v_batches
    from public.expenses e
    join public.expense_batches b on b.id=e.batch_id
    where e.recurring_reimbursement_id=p_id and e.deleted_at is null and e.status='approved'
      and b.paid_at is null;
  perform 1 from public.expense_batches b where b.id=any(v_batches) order by b.id for update nowait;
  perform 1 from public.expenses e
    where e.recurring_reimbursement_id=p_id and e.deleted_at is null and e.status='approved'
    order by e.id for update nowait;
  return v_batches;
end $$;

create or replace function private.notify_expense_recurring_reimbursement(
  p_row public.expense_recurring_reimbursements,p_actor_id uuid,p_title text,p_body text,
  p_dedupe_key text,p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- The person changing their own reimbursement needs no notice.
  if p_row.user_id=p_actor_id then return; end if;
  insert into public.notifications(
    user_id,company_id,type,title,body,batch_id,deep_link_type,is_read,persistent,
    action_url,action_label,dedupe_key)
  values (
    p_row.user_id::text,p_row.company_id::text,'expense_recurring',p_title,p_body,p_batch_id::text,
    'expense',false,false,
    '/books?segment=expenses'||case when p_batch_id is null then '' else '&batch='||p_batch_id::text end,
    'View expenses',p_dedupe_key)
  on conflict do nothing;
end $$;

-- The envelope holding the setup's most recent live line (for notice links).
create or replace function private.expense_recurring_latest_batch(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select e.batch_id from public.expenses e
  where e.recurring_reimbursement_id=p_id and e.deleted_at is null
  order by e.recurring_period desc limit 1
$$;

-- ─── Line authority ────────────────────────────────────────────────────────

create or replace function private.enforce_expense_recurring_line_authority()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role text;
  v_free text[]:=array['status','approved_by','approved_at','updated_at',
    'accounting_sync_status','accounting_sync_id','accounting_synced_at'];
begin
  if tg_op='INSERT' then
    if new.recurring_reimbursement_id is null and new.recurring_period is null then return new; end if;
  elsif tg_op='UPDATE' then
    if old.recurring_reimbursement_id is null and old.recurring_period is null
      and new.recurring_reimbursement_id is null and new.recurring_period is null then
      return new;
    end if;
  elsif old.recurring_reimbursement_id is null then
    return old;
  end if;

  v_role:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  if v_role='service_role' or (v_role is null and session_user='postgres') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op<>'DELETE' and exists(select 1 from private.expense_recurring_reimbursement_scope s
    where s.transaction_id=pg_current_xact_id() and s.company_id=new.company_id
      and (tg_op='INSERT' or s.company_id=old.company_id)
      and s.actor_id=private.get_current_user_id()) then
    return new;
  end if;

  -- Outside a setup command only payout and approval stamps may move.
  if tg_op='UPDATE' and old.status in ('approved','reimbursed') and new.status in ('approved','reimbursed')
    and (to_jsonb(old)-v_free)=(to_jsonb(new)-v_free) then
    return new;
  end if;

  raise exception 'Recurring reimbursements change from their setup' using errcode='42501';
end $$;

drop trigger if exists enforce_expense_recurring_line_authority on public.expenses;
create trigger enforce_expense_recurring_line_authority
  before insert or update or delete on public.expenses
  for each row execute function private.enforce_expense_recurring_line_authority();

CREATE OR REPLACE FUNCTION private.enforce_expense_edit_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid; v_is_admin boolean; v_correction boolean;
  v_pending private.expense_correction_pending;
begin
  if coalesce(current_setting('request.jwt.claims',true),'')='' then return new; end if;
  v_uid:=private.get_current_user_id();
  v_is_admin:=private.current_user_is_admin();
  -- Recurring reimbursement lines are office-owned. Their setup commands edit
  -- them inside private.expense_recurring_reimbursement_scope.
  if (old.recurring_reimbursement_id is not null or new.recurring_reimbursement_id is not null)
    and exists(select 1 from private.expense_recurring_reimbursement_scope s
      where s.transaction_id=pg_current_xact_id() and s.company_id=old.company_id
        and s.actor_id=v_uid) then
    return new;
  end if;
  v_correction:=exists(select 1 from private.expense_correction_scope s
    where s.transaction_id=pg_current_xact_id() and s.expense_id=old.id
      and s.company_id=old.company_id and s.actor_id=v_uid
      and s.before_content=private.expense_correction_content(old)
      and s.after_content=private.expense_correction_content(new)
      and new.company_id=old.company_id and new.submitted_by=old.submitted_by
      and old.status in('submitted','rejected') and new.status='rejected'
      and new.flagged_by=v_uid and new.rejected_by=v_uid
      and new.deleted_at is not distinct from old.deleted_at);
  if private.expense_correction_content(new) is distinct from private.expense_correction_content(old)
    and not v_correction and (v_uid is null or v_uid<>old.submitted_by) then
    raise exception 'Only the expense submitter may edit its details' using errcode='42501';
  end if;
  if row(new.receipt_image_url,new.receipt_thumbnail_url,new.ocr_raw_data,new.ocr_confidence,
      new.receipt_missing_reason,new.receipt_missing_note)
    is distinct from row(old.receipt_image_url,old.receipt_thumbnail_url,old.ocr_raw_data,old.ocr_confidence,
      old.receipt_missing_reason,old.receipt_missing_note)
    and (v_uid is null or v_uid<>old.submitted_by) then
    raise exception 'Only the expense submitter may edit its receipt' using errcode='42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null
    and not coalesce(v_is_admin or (v_uid is not null and v_uid=old.submitted_by),false) then
    raise exception 'Only the submitter or a company admin may delete this expense' using errcode='42501';
  end if;
  -- A successful crew resubmission acknowledges only the exact correction
  -- markers it read. A later independent flag is never silently erased.
  if old.status='rejected' and new.status='submitted' and v_uid=old.submitted_by then
    select * into v_pending from private.expense_correction_pending where expense_id=old.id;
    if found and v_pending.company_id=old.company_id
      and row(old.flagged_by,old.flagged_at,old.flag_comment,old.rejected_by,old.rejected_at,old.rejection_reason)
        is not distinct from row(v_pending.actor_id,v_pending.marked_at,v_pending.feedback,
          v_pending.actor_id,v_pending.marked_at,v_pending.feedback)
      and row(new.flagged_by,new.flagged_at,new.flag_comment,new.rejected_by,new.rejected_at,new.rejection_reason)
        is not distinct from row(old.flagged_by,old.flagged_at,old.flag_comment,old.rejected_by,old.rejected_at,old.rejection_reason) then
      new.flagged_by:=null; new.flagged_at:=null; new.flag_comment:=null;
      new.rejected_by:=null; new.rejected_at:=null; new.rejection_reason:=null;
      delete from private.expense_correction_pending where expense_id=old.id;
    end if;
  end if;
  return new;
end; $function$
;

-- ─── Daily sweep ───────────────────────────────────────────────────────────
-- Unchanged except: (0) files due recurring months first, and per-job
-- companies send envelopes that belong to no job on their calendar period
-- (previously such envelopes never auto-sent).

CREATE OR REPLACE FUNCTION public.expense_envelope_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sent int := 0;
  v_batch record;
  v_uid uuid;
  v_draft record;
begin
  -- (0) RECURRING: file every recurring reimbursement month that has come due,
  -- and rescue lines stranded in returned envelopes, before any send.
  perform private.generate_expense_recurring_lines();

  -- (1) SAFETY NET: adopt any non-draft, unbatched expense.
  for v_draft in
    select id from public.expenses
    where deleted_at is null and status <> 'draft' and batch_id is null
    for update skip locked
  loop
    perform public.place_expense(v_draft.id);
  end loop;

  -- (2) AUTO-SEND: every 'open' envelope that is due. Calendar period+grace for normal cadences
  -- and job-less envelopes; project completion+grace for per_job job envelopes.
  for v_batch in
    select b.* from public.expense_batches b
    where b.status = 'open' and b.amendment_number = 0
      and (
        case
          when coalesce((select s.review_frequency from public.expense_settings s where s.company_id = b.company_id),'monthly') = 'per_job'
               and b.scope_project_id is not null
            then (select p.completed_at from public.projects p where p.id = b.scope_project_id) is not null
                 and (select p.completed_at from public.projects p where p.id = b.scope_project_id)
                     + (coalesce((select auto_submit_grace_days from public.expense_settings s where s.company_id = b.company_id), 7) * interval '1 day') <= now()
          else b.period_end
                 + (coalesce((select auto_submit_grace_days from public.expense_settings s where s.company_id = b.company_id), 7) * interval '1 day') <= now()
        end
      )
    for update of b skip locked
  loop
    for v_draft in
      select id from public.expenses e
      where e.company_id = v_batch.company_id and e.submitted_by = v_batch.submitted_by
        and e.status = 'draft' and e.deleted_at is null and e.amount is not null and e.amount > 0
        and e.expense_date between v_batch.period_start and v_batch.period_end
      for update skip locked
    loop
      update public.expenses set status='submitted', batch_id=v_batch.id, updated_at=now() where id=v_draft.id;
    end loop;

    perform public.recalculate_expense_batch_total(v_batch.id);
    update public.expense_batches set status='pending_review' where id = v_batch.id;

    for v_uid in select * from public.users_with_permission(v_batch.company_id, 'expenses.approve')
    loop
      insert into public.notifications(
        user_id, company_id, type, title, body, batch_id, deep_link_type, action_url, action_label, dedupe_key)
      values (
        v_uid::text, v_batch.company_id::text, 'expense_submitted',
        'Expenses ready for review',
        v_batch.batch_number || ' — ' || to_char(v_batch.period_start,'Mon YYYY')
          || ' (' || to_char(v_batch.total_amount,'FM999G999G990D00') || ')',
        v_batch.id::text, 'expense',
        '/accounting?tab=expenses&batch=' || v_batch.id, 'REVIEW',
        'expense_batch_review:' || v_batch.id)
      on conflict do nothing;
    end loop;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$
;
revoke all on function public.expense_envelope_sweep() from public,anon,authenticated;
grant execute on function public.expense_envelope_sweep() to service_role;

-- ─── Commands ──────────────────────────────────────────────────────────────

create or replace function public.create_expense_recurring_reimbursement(
  p_user_id uuid,p_name text,p_amount numeric,p_first_period date,p_category_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
set lock_timeout to '250ms'
as $$
declare
  v_context record;
  v_name text:=btrim(coalesce(p_name,''));
  v_current date;
  v_first date;
  v_currency text;
  v_row public.expense_recurring_reimbursements;
begin
  select * into v_context from private.expense_recurring_lock_actor();
  perform private.expense_recurring_validate(v_name,p_amount);
  if p_user_id is null then
    raise exception 'Choose who receives this reimbursement.' using errcode='22023';
  end if;
  perform 1 from public.users u
    where u.id=p_user_id and u.company_id=v_context.company_id
      and coalesce(u.is_active,false) and u.deleted_at is null
    for share nowait;
  if not found then
    raise exception 'That person is not an active member of your company.' using errcode='42501';
  end if;
  if p_user_id=v_context.actor_id and not coalesce(private.current_user_is_admin(),false) then
    raise exception 'Only an admin can set up a recurring reimbursement for themselves.' using errcode='42501';
  end if;
  perform private.expense_recurring_validate_category(v_context.company_id,p_category_id,null);
  if p_first_period is null then
    raise exception 'Choose the first month.' using errcode='22023';
  end if;
  v_current:=private.expense_recurring_month_start(private.expense_recurring_company_today(v_context.company_id));
  v_first:=private.expense_recurring_month_start(p_first_period);
  if v_first<(v_current-interval '12 months')::date or v_first>(v_current+interval '12 months')::date then
    raise exception 'Start within 12 months of this month.' using errcode='22023';
  end if;
  select upper(btrim(c.currency_code)) into v_currency from public.companies c where c.id=v_context.company_id;
  v_currency:=coalesce(nullif(v_currency,''),'USD');
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Your company currency is not set correctly.' using errcode='22023';
  end if;
  if exists(select 1 from public.expense_recurring_reimbursements r
    where r.company_id=v_context.company_id and r.user_id=p_user_id and r.deleted_at is null
      and lower(r.name)=lower(v_name) and (r.last_period is null or r.last_period>=v_first)) then
    raise exception 'This person already has a recurring reimbursement with that name.' using errcode='23505';
  end if;

  insert into public.expense_recurring_reimbursements(
    company_id,user_id,name,amount,currency,category_id,first_period,next_period,created_by,updated_by)
  values (v_context.company_id,p_user_id,v_name,p_amount,v_currency,p_category_id,v_first,v_first,
    v_context.actor_id,v_context.actor_id)
  returning * into v_row;

  perform private.generate_expense_recurring_lines_for(v_row.id);

  perform private.notify_expense_recurring_reimbursement(v_row,v_context.actor_id,
    'Recurring reimbursement added',
    v_row.name||' · '||private.expense_recurring_money_text(v_row.amount,v_row.currency)
      ||' a month, starting '||to_char(v_row.first_period,'Mon YYYY'),
    'expense-recurring:'||v_row.id::text||':added',
    private.expense_recurring_latest_batch(v_row.id));

  perform private.expense_recurring_release_scope();
  return private.expense_recurring_reimbursement_json(v_row.id);
exception when lock_not_available or deadlock_detected then
  raise exception 'Expenses are being updated. Try again.' using errcode='40001';
end $$;

create or replace function public.update_expense_recurring_reimbursement(
  p_id uuid,p_name text,p_amount numeric,p_category_id uuid,p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
set lock_timeout to '250ms'
as $$
declare
  v_context record;
  v_row public.expense_recurring_reimbursements;
  v_name text:=btrim(coalesce(p_name,''));
  v_amount_changed boolean;
  v_batches uuid[];
  v_batch uuid;
begin
  select * into v_context from private.expense_recurring_lock_actor();
  v_row:=private.expense_recurring_lock_setup(p_id,v_context.company_id,p_expected_updated_at);
  perform private.expense_recurring_validate(v_name,p_amount);
  perform private.expense_recurring_validate_category(v_context.company_id,p_category_id,v_row.category_id);

  if v_name=v_row.name and p_amount=v_row.amount and p_category_id is not distinct from v_row.category_id then
    perform private.expense_recurring_release_scope();
    return private.expense_recurring_reimbursement_json(v_row.id);
  end if;
  if lower(v_name)<>lower(v_row.name) and exists(select 1 from public.expense_recurring_reimbursements r
    where r.company_id=v_row.company_id and r.user_id=v_row.user_id and r.id<>v_row.id and r.deleted_at is null
      and lower(r.name)=lower(v_name)) then
    raise exception 'This person already has a recurring reimbursement with that name.' using errcode='23505';
  end if;

  v_amount_changed:=p_amount<>v_row.amount;
  update public.expense_recurring_reimbursements
    set name=v_name,amount=p_amount,category_id=p_category_id,
      updated_by=v_context.actor_id,updated_at=clock_timestamp()
    where id=v_row.id
    returning * into v_row;

  -- Unpaid months follow the setup; paid months keep what was paid.
  v_batches:=private.expense_recurring_lock_unpaid_lines(v_row.id);
  update public.expenses e
    set merchant_name=v_row.name,amount=v_row.amount,category_id=v_row.category_id,
      approved_by=v_context.actor_id,approved_at=clock_timestamp()
    where e.recurring_reimbursement_id=v_row.id and e.deleted_at is null and e.status='approved'
      and e.batch_id=any(v_batches);
  foreach v_batch in array v_batches loop
    perform public.recalculate_expense_batch_total(v_batch);
  end loop;

  if v_amount_changed then
    perform private.notify_expense_recurring_reimbursement(v_row,v_context.actor_id,
      'Recurring reimbursement updated',
      v_row.name||' · '||private.expense_recurring_money_text(v_row.amount,v_row.currency)||' a month',
      'expense-recurring:'||v_row.id::text||':updated:'||(extract(epoch from v_row.updated_at)*1000000)::bigint::text,
      private.expense_recurring_latest_batch(v_row.id));
  end if;

  perform private.expense_recurring_release_scope();
  return private.expense_recurring_reimbursement_json(v_row.id);
exception when lock_not_available or deadlock_detected then
  raise exception 'Expenses are being updated. Try again.' using errcode='40001';
end $$;

-- Sets (or clears, with null) the last month. Ending never removes a line:
-- skip a month first to leave it out.
create or replace function public.end_expense_recurring_reimbursement(
  p_id uuid,p_last_period date,p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
set lock_timeout to '250ms'
as $$
declare
  v_context record;
  v_row public.expense_recurring_reimbursements;
  v_last date:=private.expense_recurring_month_start(p_last_period);
  v_current date;
  v_latest date;
  v_next date;
begin
  select * into v_context from private.expense_recurring_lock_actor();
  v_row:=private.expense_recurring_lock_setup(p_id,v_context.company_id,p_expected_updated_at);

  if v_row.last_period is not distinct from v_last then
    perform private.expense_recurring_release_scope();
    return private.expense_recurring_reimbursement_json(v_row.id);
  end if;

  if v_last is not null then
    if v_last<v_row.first_period then
      raise exception 'End on or after the first month, or delete it instead.' using errcode='22023';
    end if;
    select max(e.recurring_period) into v_latest from public.expenses e
      where e.recurring_reimbursement_id=v_row.id and e.deleted_at is null;
    if v_latest is not null and v_last<v_latest then
      raise exception '% is already on a batch. Skip that month first, or end after it.',
        to_char(v_latest,'Mon YYYY') using errcode='22023';
    end if;
  end if;

  -- A setup that had stopped resumes from this month, never backfilling the gap.
  v_next:=v_row.next_period;
  if v_row.last_period is not null and v_row.next_period>v_row.last_period
    and (v_last is null or v_last>v_row.last_period) then
    v_current:=private.expense_recurring_month_start(private.expense_recurring_company_today(v_context.company_id));
    v_next:=greatest(v_row.next_period,v_current);
  end if;

  update public.expense_recurring_reimbursements
    set last_period=v_last,next_period=v_next,updated_by=v_context.actor_id,updated_at=clock_timestamp()
    where id=v_row.id
    returning * into v_row;

  perform private.generate_expense_recurring_lines_for(v_row.id);

  if v_last is null then
    perform private.notify_expense_recurring_reimbursement(v_row,v_context.actor_id,
      'Recurring reimbursement resumed',
      v_row.name||' · '||private.expense_recurring_money_text(v_row.amount,v_row.currency)||' a month',
      'expense-recurring:'||v_row.id::text||':resumed:'||(extract(epoch from v_row.updated_at)*1000000)::bigint::text,
      private.expense_recurring_latest_batch(v_row.id));
  else
    perform private.notify_expense_recurring_reimbursement(v_row,v_context.actor_id,
      'Recurring reimbursement ending',
      v_row.name||' · last month '||to_char(v_last,'Mon YYYY'),
      'expense-recurring:'||v_row.id::text||':ends:'||to_char(v_last,'YYYY-MM'),
      private.expense_recurring_latest_batch(v_row.id));
  end if;

  perform private.expense_recurring_release_scope();
  return private.expense_recurring_reimbursement_json(v_row.id);
exception when lock_not_available or deadlock_detected then
  raise exception 'Expenses are being updated. Try again.' using errcode='40001';
end $$;

-- Removes a setup made in error, with every line. Refused once any month has
-- been paid: end it instead so the history stays true.
create or replace function public.delete_expense_recurring_reimbursement(
  p_id uuid,p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
set lock_timeout to '250ms'
as $$
declare
  v_context record;
  v_row public.expense_recurring_reimbursements;
  v_batches uuid[];
  v_batch uuid;
begin
  select * into v_context from private.expense_recurring_lock_actor();
  v_row:=private.expense_recurring_lock_setup(p_id,v_context.company_id,p_expected_updated_at);
  if exists(select 1 from public.expenses e
    where e.recurring_reimbursement_id=v_row.id and e.deleted_at is null and e.status='reimbursed') then
    raise exception 'A month has already been paid. End it instead.' using errcode='55000';
  end if;

  v_batches:=private.expense_recurring_lock_unpaid_lines(v_row.id);
  if exists(select 1 from public.expenses e
    where e.recurring_reimbursement_id=v_row.id and e.deleted_at is null
      and not (e.batch_id=any(v_batches))) then
    raise exception 'A month has already been paid. End it instead.' using errcode='55000';
  end if;
  update public.expenses e set deleted_at=clock_timestamp()
    where e.recurring_reimbursement_id=v_row.id and e.deleted_at is null;
  foreach v_batch in array v_batches loop
    perform public.recalculate_expense_batch_total(v_batch);
  end loop;

  update public.expense_recurring_reimbursements
    set deleted_at=clock_timestamp(),deleted_by=v_context.actor_id,
      updated_by=v_context.actor_id,updated_at=clock_timestamp()
    where id=v_row.id
    returning * into v_row;

  perform private.notify_expense_recurring_reimbursement(v_row,v_context.actor_id,
    'Recurring reimbursement removed',v_row.name,
    'expense-recurring:'||v_row.id::text||':removed',null);

  perform private.expense_recurring_release_scope();
  return private.expense_recurring_reimbursement_json(v_row.id);
exception when lock_not_available or deadlock_detected then
  raise exception 'Expenses are being updated. Try again.' using errcode='40001';
end $$;

-- Leaves one unpaid month out. Restore undoes it.
create or replace function public.skip_expense_recurring_reimbursement_line(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
set lock_timeout to '250ms'
as $$
declare
  v_context record;
  v_line public.expenses;
  v_row public.expense_recurring_reimbursements;
  v_batch public.expense_batches;
begin
  select * into v_context from private.expense_recurring_lock_actor();
  select e.* into v_line from public.expenses e
    where e.id=p_expense_id and e.company_id=v_context.company_id and e.recurring_reimbursement_id is not null;
  if not found then
    raise exception 'That line is not a recurring reimbursement.' using errcode='42501';
  end if;
  select r.* into v_row from public.expense_recurring_reimbursements r
    where r.id=v_line.recurring_reimbursement_id
    for update nowait;
  select b.* into v_batch from public.expense_batches b where b.id=v_line.batch_id for update nowait;
  select e.* into strict v_line from public.expenses e where e.id=p_expense_id for update nowait;

  if v_line.deleted_at is not null then
    perform private.expense_recurring_release_scope();
    return private.expense_recurring_reimbursement_json(v_row.id);
  end if;
  if v_line.status<>'approved' or v_batch.paid_at is not null then
    raise exception 'That month has already been paid.' using errcode='55000';
  end if;

  update public.expenses set deleted_at=clock_timestamp() where id=v_line.id;
  perform public.recalculate_expense_batch_total(v_batch.id);

  perform private.notify_expense_recurring_reimbursement(v_row,v_context.actor_id,
    'Recurring reimbursement skipped',
    v_row.name||' · '||to_char(v_line.recurring_period,'Mon YYYY'),
    'expense-recurring-skip:'||v_line.id::text,v_batch.id);

  perform private.expense_recurring_release_scope();
  return private.expense_recurring_reimbursement_json(v_row.id);
exception when lock_not_available or deadlock_detected then
  raise exception 'Expenses are being updated. Try again.' using errcode='40001';
end $$;

-- Puts a skipped month back at the setup's current amount. If its envelope was
-- paid in the meantime, the month rolls forward to today's envelope.
create or replace function public.restore_expense_recurring_reimbursement_line(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
set lock_timeout to '250ms'
as $$
declare
  v_context record;
  v_line public.expenses;
  v_row public.expense_recurring_reimbursements;
  v_batch public.expense_batches;
begin
  select * into v_context from private.expense_recurring_lock_actor();
  select e.* into v_line from public.expenses e
    where e.id=p_expense_id and e.company_id=v_context.company_id and e.recurring_reimbursement_id is not null;
  if not found then
    raise exception 'That line is not a recurring reimbursement.' using errcode='42501';
  end if;
  select r.* into v_row from public.expense_recurring_reimbursements r
    where r.id=v_line.recurring_reimbursement_id
    for update nowait;
  if v_row.deleted_at is not null then
    raise exception 'This recurring reimbursement was removed.' using errcode='55000';
  end if;
  if v_line.deleted_at is null then
    perform private.expense_recurring_release_scope();
    return private.expense_recurring_reimbursement_json(v_row.id);
  end if;
  if v_row.last_period is not null and v_line.recurring_period>v_row.last_period then
    raise exception 'That month is after this reimbursement ends.' using errcode='55000';
  end if;

  v_batch:=private.expense_recurring_target_batch(v_context.company_id,v_line.submitted_by,v_line.recurring_period);
  select e.* into strict v_line from public.expenses e where e.id=p_expense_id for update nowait;
  update public.expenses
    set deleted_at=null,batch_id=v_batch.id,merchant_name=v_row.name,amount=v_row.amount,
      category_id=v_row.category_id,approved_by=v_context.actor_id,approved_at=clock_timestamp()
    where id=v_line.id;
  if v_line.batch_id is not null and v_line.batch_id<>v_batch.id then
    perform public.recalculate_expense_batch_total(v_line.batch_id);
  end if;
  perform public.recalculate_expense_batch_total(v_batch.id);

  update public.notifications
    set is_read=true,resolved_at=clock_timestamp(),resolved_by=v_context.actor_id,
      resolution_reason='recurring_reimbursement_restored'
    where user_id=v_line.submitted_by::text and company_id=v_context.company_id::text
      and dedupe_key='expense-recurring-skip:'||v_line.id::text and resolved_at is null;

  perform private.expense_recurring_release_scope();
  return private.expense_recurring_reimbursement_json(v_row.id);
exception when lock_not_available or deadlock_detected then
  raise exception 'Expenses are being updated. Try again.' using errcode='40001';
end $$;

-- ─── Privileges ────────────────────────────────────────────────────────────

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.expense_recurring_month_start(date)',
    'private.expense_recurring_money_text(numeric,text)',
    'private.expense_recurring_company_today(uuid)',
    'private.expense_recurring_validate(text,numeric)',
    'private.expense_recurring_validate_category(uuid,uuid,uuid)',
    'private.expense_recurring_target_batch(uuid,uuid,date)',
    'private.generate_expense_recurring_lines_for(uuid)',
    'private.rescue_expense_recurring_lines()',
    'private.generate_expense_recurring_lines()',
    'private.expense_recurring_reimbursement_json(uuid)',
    'private.expense_recurring_lock_actor()',
    'private.expense_recurring_release_scope()',
    'private.expense_recurring_lock_setup(uuid,uuid,timestamptz)',
    'private.expense_recurring_lock_unpaid_lines(uuid)',
    'private.notify_expense_recurring_reimbursement(public.expense_recurring_reimbursements,uuid,text,text,text,uuid)',
    'private.expense_recurring_latest_batch(uuid)',
    'private.enforce_expense_recurring_line_authority()'
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_fn);
  end loop;
  foreach v_fn in array array[
    'public.create_expense_recurring_reimbursement(uuid,text,numeric,date,uuid)',
    'public.update_expense_recurring_reimbursement(uuid,text,numeric,uuid,timestamptz)',
    'public.end_expense_recurring_reimbursement(uuid,date,timestamptz)',
    'public.delete_expense_recurring_reimbursement(uuid,timestamptz)',
    'public.skip_expense_recurring_reimbursement_line(uuid)',
    'public.restore_expense_recurring_reimbursement_line(uuid)'
  ] loop
    execute format('revoke all on function %s from public,anon,service_role',v_fn);
    execute format('grant execute on function %s to authenticated',v_fn);
  end loop;
end $$;

commit;
