-- Atomic iOS expense save.
--
-- The previous client flow patched content, replaced allocations, submitted,
-- re-filed, and recalculated the source envelope in separate requests. Any
-- interrupted request could leave a partial expense or a stale batch total.
-- This additive RPC gives new clients one all-or-nothing transaction while
-- leaving already-shipped clients operational.

create table if not exists private.expense_save_requests (
  request_id uuid primary key,
  company_id uuid not null,
  submitted_by uuid not null,
  expense_id uuid not null,
  command_hash text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

revoke all on table private.expense_save_requests from public, anon, authenticated;

create index if not exists expense_save_requests_completed_at_idx
  on private.expense_save_requests (company_id, completed_at)
  where completed_at is not null;

comment on table private.expense_save_requests is
  'Private 90-day idempotency ledger for atomic iOS expense saves. Stores only a SHA-256 command hash; no receipt, OCR, or expense content is duplicated.';

-- Every writer, including already-shipped direct-table clients, receives a
-- non-null, strictly advancing compare-and-swap token. `clock_timestamp()` can
-- repeat at PostgreSQL's microsecond resolution, so UPDATE explicitly advances
-- at least one microsecond beyond OLD.updated_at.
update public.expenses
   set updated_at = coalesce(updated_at, created_at, clock_timestamp())
 where updated_at is null;

alter table public.expenses
  alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function private.set_expense_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.updated_at := clock_timestamp();
  else
    new.updated_at := greatest(
      clock_timestamp(),
      old.updated_at + interval '1 microsecond'
    );
  end if;
  return new;
end;
$function$;

revoke all on function private.set_expense_updated_at() from public, anon, authenticated;

drop trigger if exists trg_set_expense_updated_at on public.expenses;
create trigger trg_set_expense_updated_at
before insert or update on public.expenses
for each row execute function private.set_expense_updated_at();

-- Allocation-only edits are part of the same expense snapshot, so they must
-- advance the parent token too. This closes the CAS hole for legacy clients
-- that still write the relation directly.
create or replace function private.touch_expense_from_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.expenses
       set updated_at = clock_timestamp()
     where id = old.expense_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and (tg_op = 'INSERT' or new.expense_id is distinct from old.expense_id) then
    update public.expenses
       set updated_at = clock_timestamp()
     where id = new.expense_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.touch_expense_from_allocation() from public, anon, authenticated;

drop trigger if exists trg_touch_expense_from_allocation
  on public.expense_project_allocations;
create trigger trg_touch_expense_from_allocation
after insert or update or delete on public.expense_project_allocations
for each row execute function private.touch_expense_from_allocation();

-- Lock the envelope before calculating its total. The old implementation read
-- SUM first and locked only during UPDATE, allowing concurrent expense writes
-- to persist a total from a stale snapshot.
create or replace function public.recalculate_expense_batch_total(p_batch_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_total numeric;
  v_batch_company_id uuid;
  v_batch_submitted_by uuid;
  v_batch_status text;
  v_user_id uuid;
  v_company_id uuid;
  v_jwt_role text;
  v_is_admin boolean;
  v_view_scope text;
  v_edit_scope text;
  v_approve_scope text;
begin
  select b.company_id, b.submitted_by, b.status
    into v_batch_company_id, v_batch_submitted_by, v_batch_status
    from public.expense_batches
   where id = p_batch_id
   for update;

  if not found then
    return 0;
  end if;

  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );

  -- API/server placement calls carry a JWT. The live pg_cron sweep connects as
  -- database session_user `postgres` without request claims; that one known
  -- trusted context must remain operational. Authenticated legacy iOS callers
  -- may recalculate only their own envelope or a same-company envelope they
  -- are allowed to edit/approve.
  if v_jwt_role is distinct from 'service_role'
     and not (v_jwt_role is null and session_user = 'postgres') then
    v_user_id := private.get_current_user_id();
    v_company_id := private.get_user_company_id();
    v_is_admin := coalesce(private.current_user_is_admin(), false);
    v_view_scope := private.current_user_scope_for('expenses.view');
    v_edit_scope := private.current_user_scope_for('expenses.edit');
    v_approve_scope := private.current_user_scope_for('expenses.approve');

    if v_user_id is null
       or v_company_id is null
       or v_batch_company_id <> v_company_id
       or not coalesce(
         v_is_admin
         or v_approve_scope = 'all'
         or (
           v_batch_status not in ('approved', 'auto_approved')
           and (
             v_edit_scope = 'all'
             or (
               v_batch_submitted_by = v_user_id
               and v_view_scope in ('own', 'all')
             )
           )
         ),
         false
       ) then
      raise exception 'Expense batch total access is not permitted'
        using errcode = '42501';
    end if;
  end if;

  select coalesce(sum(e.amount), 0)
    into v_total
    from public.expenses e
   where e.batch_id = p_batch_id
     and e.deleted_at is null;

  update public.expense_batches
     set total_amount = v_total
   where id = p_batch_id;

  return v_total;
end;
$function$;

-- Already-shipped iOS clients call this after moving their own submitted line,
-- so authenticated execution remains available behind the in-function tenant
-- and permission check above.
revoke execute on function public.recalculate_expense_batch_total(uuid)
  from public, anon;
grant execute on function public.recalculate_expense_batch_total(uuid)
  to authenticated, service_role;

-- Build every RPC response from the live row. Replays never return a stored
-- snapshot, so later approval, reimbursement, flags, accounting state, policy
-- revocation, and deletion are respected.
create or replace function private.expense_atomic_response(p_expense_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select to_jsonb(e) || jsonb_build_object(
    'expense_project_allocations', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id)
        from public.expense_project_allocations a
       where a.expense_id = e.id
    ), '[]'::jsonb),
    'expense_categories', (
      select to_jsonb(c)
        from public.expense_categories c
       where c.id = e.category_id
    )
  )
  from public.expenses e
  where e.id = p_expense_id
    and e.deleted_at is null;
$function$;

revoke all on function private.expense_atomic_response(uuid) from public, anon, authenticated;

create or replace function public.save_expense_atomic(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_id uuid;
  v_request_inserted integer;
  v_request private.expense_save_requests%rowtype;
  v_expense_id uuid;
  v_command_company_id uuid;
  v_command_submitted_by uuid;
  v_user_id uuid;
  v_company_id uuid;
  v_command_hash text;
  v_expected_status text;
  v_expected_updated_at timestamptz;
  v_category_id uuid;
  v_merchant_name text;
  v_description text;
  v_amount numeric;
  v_tax_amount numeric;
  v_currency text;
  v_expense_date date;
  v_payment_method text;
  v_receipt_image_url text;
  v_receipt_thumbnail_url text;
  v_receipt_missing_reason text;
  v_receipt_missing_note text;
  v_project_missing_reason text;
  v_project_missing_note text;
  v_ocr_raw_data jsonb;
  v_ocr_confidence real;
  v_allocations jsonb;
  v_allocation_count integer;
  v_allocation_total numeric;
  v_current_allocations jsonb;
  v_desired_allocations jsonb;
  v_submit boolean;
  v_require_receipt boolean;
  v_require_project boolean;
  v_review_frequency text;
  v_company_timezone text;
  v_company_today date;
  v_view_scope text;
  v_edit_scope text;
  v_approve_scope text;
  v_is_admin boolean;
  v_target_status text;
  v_should_refile boolean;
  v_old_batch_id uuid;
  v_existing boolean := false;
  v_content_matches boolean := false;
  v_status_matches boolean := false;
  v_exp public.expenses%rowtype;
  v_saved public.expenses%rowtype;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'Expense save command must be a JSON object'
      using errcode = '22023';
  end if;

  if not p_command ?& array[
    'request_id', 'expense_id', 'company_id', 'submitted_by',
    'expected_status', 'expected_updated_at',
    'category_id', 'merchant_name', 'description',
    'amount', 'tax_amount', 'currency', 'expense_date', 'payment_method',
    'receipt_image_url', 'receipt_thumbnail_url',
    'receipt_missing_reason', 'receipt_missing_note',
    'project_missing_reason', 'project_missing_note',
    'ocr_raw_data', 'ocr_confidence', 'allocations', 'submit'
  ] then
    raise exception 'Expense save command is missing required keys'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_command) as key(name)
     where key.name not in (
       'request_id', 'expense_id', 'company_id', 'submitted_by',
       'expected_status', 'expected_updated_at',
       'category_id', 'merchant_name', 'description',
       'amount', 'tax_amount', 'currency', 'expense_date', 'payment_method',
       'receipt_image_url', 'receipt_thumbnail_url',
       'receipt_missing_reason', 'receipt_missing_note',
       'project_missing_reason', 'project_missing_note',
       'ocr_raw_data', 'ocr_confidence', 'allocations', 'submit'
     )
  ) then
    raise exception 'Expense save command contains unsupported keys'
      using errcode = '22023';
  end if;

  -- `->>` coerces arrays, objects, numbers, and booleans to text. Validate the
  -- JSON contract before any cast so malformed callers cannot make an array
  -- count as a receipt URL or persist OCR that Swift can never decode.
  if jsonb_typeof(p_command -> 'request_id') <> 'string'
     or jsonb_typeof(p_command -> 'expense_id') <> 'string'
     or jsonb_typeof(p_command -> 'company_id') <> 'string'
     or jsonb_typeof(p_command -> 'submitted_by') <> 'string'
     or jsonb_typeof(p_command -> 'amount') <> 'number'
     or jsonb_typeof(p_command -> 'currency') <> 'string'
     or jsonb_typeof(p_command -> 'expense_date') <> 'string'
     or jsonb_typeof(p_command -> 'payment_method') <> 'string'
     or jsonb_typeof(p_command -> 'allocations') <> 'array'
     or jsonb_typeof(p_command -> 'submit') <> 'boolean' then
    raise exception 'Expense save command contains an invalid JSON type'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from (values
        ('expected_status'), ('expected_updated_at'), ('category_id'),
        ('merchant_name'), ('description'), ('receipt_image_url'),
        ('receipt_thumbnail_url'), ('receipt_missing_reason'),
        ('receipt_missing_note'), ('project_missing_reason'),
        ('project_missing_note')
      ) as nullable_string(name)
     where jsonb_typeof(p_command -> nullable_string.name) not in ('string', 'null')
  ) then
    raise exception 'Expense save command contains an invalid nullable text field'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_command -> 'tax_amount') not in ('number', 'null')
     or jsonb_typeof(p_command -> 'ocr_confidence') not in ('number', 'null')
     or jsonb_typeof(p_command -> 'ocr_raw_data') not in ('object', 'null') then
    raise exception 'Expense save command contains an invalid nullable value'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_command -> 'ocr_raw_data') = 'object'
     and exists (
       select 1
         from jsonb_each(p_command -> 'ocr_raw_data') as item(key, value)
        where jsonb_typeof(item.value) <> 'string'
     ) then
    raise exception 'Expense OCR values must all be strings'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_command -> 'allocations') as allocation(value)
     where jsonb_typeof(allocation.value) <> 'object'
  ) then
    raise exception 'Every expense allocation must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_command -> 'allocations') as allocation(value)
     where not allocation.value ?& array['project_id', 'percentage', 'amount']
        or exists (
          select 1
            from jsonb_object_keys(allocation.value) as allocation_key(name)
           where allocation_key.name not in ('project_id', 'percentage', 'amount')
        )
        or jsonb_typeof(allocation.value -> 'project_id') <> 'string'
        or jsonb_typeof(allocation.value -> 'percentage') <> 'number'
        or jsonb_typeof(allocation.value -> 'amount') <> 'null'
  ) then
    raise exception 'Expense allocation contains unsupported keys or JSON types'
      using errcode = '22023';
  end if;

  begin
    v_request_id := nullif(p_command ->> 'request_id', '')::uuid;
    v_expense_id := nullif(p_command ->> 'expense_id', '')::uuid;
    v_command_company_id := nullif(p_command ->> 'company_id', '')::uuid;
    v_command_submitted_by := nullif(p_command ->> 'submitted_by', '')::uuid;
    v_expected_updated_at := nullif(p_command ->> 'expected_updated_at', '')::timestamptz;
    v_category_id := nullif(p_command ->> 'category_id', '')::uuid;
    v_amount := (p_command ->> 'amount')::numeric;
    v_tax_amount := nullif(p_command ->> 'tax_amount', '')::numeric;
    v_expense_date := nullif(p_command ->> 'expense_date', '')::date;
    v_ocr_confidence := nullif(p_command ->> 'ocr_confidence', '')::real;
    v_submit := (p_command ->> 'submit')::boolean;
  exception
    when invalid_text_representation
      or numeric_value_out_of_range
      or invalid_datetime_format
      or datetime_field_overflow then
    raise exception 'Expense save command contains an invalid typed value'
      using errcode = '22023';
  end;

  if v_request_id is null or v_expense_id is null
     or v_command_company_id is null or v_command_submitted_by is null then
    raise exception 'Request, expense, company, and submitter identifiers are required'
      using errcode = '22023';
  end if;

  v_user_id := private.get_current_user_id();
  v_company_id := private.get_user_company_id();
  if v_user_id is null or v_company_id is null then
    raise exception 'Authenticated OPS user context is required'
      using errcode = '42501';
  end if;
  if v_command_company_id <> v_company_id or v_command_submitted_by <> v_user_id then
    raise exception 'Expense company or submitter does not match the authenticated user'
      using errcode = '42501';
  end if;

  -- One company-scoped transaction lock gives every atomic expense save the
  -- same lock order before it can touch an envelope. This prevents opposite
  -- source/destination moves from deadlocking each other.
  perform pg_advisory_xact_lock(
    hashtextextended('save_expense_atomic:' || v_company_id::text, 0)
  );

  delete from private.expense_save_requests
   where company_id = v_company_id
     and completed_at < clock_timestamp() - interval '90 days';

  v_command_hash := encode(extensions.digest(p_command::text, 'sha256'), 'hex');

  insert into private.expense_save_requests (
    request_id, company_id, submitted_by, expense_id, command_hash
  ) values (
    v_request_id, v_company_id, v_user_id, v_expense_id, v_command_hash
  ) on conflict (request_id) do nothing;
  get diagnostics v_request_inserted = row_count;

  select * into strict v_request
    from private.expense_save_requests
   where request_id = v_request_id
   for update;

  if v_request.company_id <> v_company_id
     or v_request.submitted_by <> v_user_id
     or v_request.expense_id <> v_expense_id
     or v_request.command_hash <> v_command_hash then
    raise exception 'Expense save request identifier was reused with different content'
      using errcode = '22023';
  end if;
  if v_request_inserted = 0 and v_request.completed_at is null then
    raise exception 'Expense save request did not complete'
      using errcode = 'P0001';
  end if;

  v_expected_status := nullif(p_command ->> 'expected_status', '');
  v_merchant_name := p_command ->> 'merchant_name';
  v_description := p_command ->> 'description';
  v_currency := nullif(p_command ->> 'currency', '');
  v_payment_method := nullif(p_command ->> 'payment_method', '');
  v_receipt_image_url := nullif(btrim(p_command ->> 'receipt_image_url'), '');
  v_receipt_thumbnail_url := nullif(btrim(p_command ->> 'receipt_thumbnail_url'), '');
  v_receipt_missing_reason := nullif(p_command ->> 'receipt_missing_reason', '');
  v_receipt_missing_note := nullif(p_command ->> 'receipt_missing_note', '');
  v_project_missing_reason := nullif(p_command ->> 'project_missing_reason', '');
  v_project_missing_note := nullif(p_command ->> 'project_missing_note', '');
  v_ocr_raw_data := p_command -> 'ocr_raw_data';
  if jsonb_typeof(v_ocr_raw_data) = 'null' then v_ocr_raw_data := null; end if;
  v_allocations := p_command -> 'allocations';

  if v_expected_status is not null
     and v_expected_status not in ('draft', 'rejected', 'submitted') then
    raise exception 'Expense expected status is invalid'
      using errcode = '22023';
  end if;

  if v_merchant_name is null or btrim(v_merchant_name) = '' then
    raise exception 'Expense merchant name is required'
      using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 10000 or v_amount <> round(v_amount, 2) then
    raise exception 'Expense amount must be between 0.01 and 10000 with at most two decimal places'
      using errcode = '22023';
  end if;
  if v_tax_amount is not null and (
    v_tax_amount < 0
    or v_tax_amount <> round(v_tax_amount, 2)
    or v_tax_amount > v_amount * 0.20
  ) then
    raise exception 'Expense tax amount is invalid'
      using errcode = '22023';
  end if;
  if v_currency is null or v_expense_date is null or v_payment_method is null then
    raise exception 'Expense currency, date, and payment method are required'
      using errcode = '22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Expense currency must be a three-letter ISO code'
      using errcode = '22023';
  end if;
  if v_payment_method not in ('cash', 'personal_card', 'company_card') then
    raise exception 'Expense payment method is invalid'
      using errcode = '22023';
  end if;
  select tz.name
    into v_company_timezone
    from public.companies c
    left join pg_catalog.pg_timezone_names tz on tz.name = c.timezone
   where c.id = v_company_id;
  v_company_today := (clock_timestamp() at time zone coalesce(v_company_timezone, 'UTC'))::date;

  if v_expense_date > v_company_today then
    raise exception 'Expense date cannot be in the future'
      using errcode = '22023';
  end if;
  if v_expense_date < (v_company_today - interval '5 years')::date then
    raise exception 'Expense date cannot be more than five years old'
      using errcode = '22023';
  end if;
  if v_ocr_confidence is not null and (v_ocr_confidence < 0 or v_ocr_confidence > 1) then
    raise exception 'Expense OCR confidence must be between zero and one'
      using errcode = '22023';
  end if;
  if v_receipt_image_url is not null and (
    v_receipt_image_url !~ '^https://'
    or length(v_receipt_image_url) > 2048
  ) then
    raise exception 'Expense receipt URL is invalid'
      using errcode = '22023';
  end if;
  if v_receipt_thumbnail_url is not null and (
    v_receipt_thumbnail_url !~ '^https://'
    or length(v_receipt_thumbnail_url) > 2048
  ) then
    raise exception 'Expense receipt thumbnail URL is invalid'
      using errcode = '22023';
  end if;

  -- A real artifact always wins over its exception metadata. Notes cannot
  -- exist without a reason. These rules are duplicated client-side for UX and
  -- enforced here so a malformed new-client payload cannot persist both.
  if v_receipt_image_url is not null then
    v_receipt_missing_reason := null;
    v_receipt_missing_note := null;
  else
    v_receipt_thumbnail_url := null;
    if v_receipt_missing_reason is null then v_receipt_missing_note := null; end if;
  end if;

  begin
    select count(*), coalesce(sum(a.percentage), 0)
      into v_allocation_count, v_allocation_total
      from jsonb_to_recordset(v_allocations)
        as a(project_id text, percentage numeric, amount numeric);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Expense allocation contains an invalid typed value'
      using errcode = '22023';
  end;

  if v_allocation_count <> jsonb_array_length(v_allocations) then
    raise exception 'Every expense allocation must be an object'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(v_allocations)
        as a(project_id text, percentage numeric, amount numeric)
     where nullif(a.project_id, '') is null
        or a.percentage is null
        or a.percentage <= 0
        or a.percentage > 100
        or a.percentage <> round(a.percentage, 2)
        or a.amount is not null
  ) then
    raise exception 'Expense allocation values are invalid'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(v_allocations)
        as a(project_id text, percentage numeric, amount numeric)
     group by a.project_id
    having count(*) > 1
  ) then
    raise exception 'An expense cannot allocate the same project twice'
      using errcode = '22023';
  end if;
  if v_allocation_count > 0 and v_allocation_total <> 100 then
    raise exception 'Expense allocation percentages must total 100'
      using errcode = '22023';
  end if;

  if v_allocation_count > 0 then
    v_project_missing_reason := null;
    v_project_missing_note := null;
  elsif v_project_missing_reason is null then
    v_project_missing_note := null;
  end if;

  if v_receipt_missing_reason is not null
     and v_receipt_missing_reason not in ('lost', 'cash', 'digital', 'other') then
    raise exception 'Expense receipt exception reason is invalid'
      using errcode = '22023';
  end if;
  if v_project_missing_reason is not null
     and v_project_missing_reason not in ('overhead', 'general', 'other') then
    raise exception 'Expense project exception reason is invalid'
      using errcode = '22023';
  end if;

  -- Shipped clients replace allocations directly. Their DELETE/UPDATE locks an
  -- allocation row before the AFTER trigger touches the parent expense, so the
  -- atomic path must use that same allocation -> parent lock order. The owned
  -- parent join prevents a caller from locking another tenant's rows, and
  -- `FOR UPDATE OF a` deliberately avoids taking the parent lock early.
  perform 1
    from public.expense_project_allocations a
    join public.expenses owned_expense
      on owned_expense.id = a.expense_id
     and owned_expense.company_id = v_company_id
     and owned_expense.submitted_by = v_user_id
     and owned_expense.deleted_at is null
   where a.expense_id = v_expense_id
   order by a.id
   for update of a;

  select * into v_exp
    from public.expenses
   where id = v_expense_id
     and company_id = v_company_id
     and submitted_by = v_user_id
     and deleted_at is null
   for update;
  v_existing := found;

  -- A completed create request must never recreate an expense that was later
  -- deleted. Both hard- and soft-delete replays terminate here before the
  -- create branch, even though create commands legitimately have null CAS
  -- fields.
  if not v_existing and v_request.completed_at is not null then
    raise exception 'Expense save request already completed and the expense is no longer available'
      using errcode = 'P0001';
  end if;

  if not v_existing
     and (v_expected_status is not null or v_expected_updated_at is not null) then
    raise exception 'Expense is unavailable or changed; reload before saving'
      using errcode = 'P0001';
  end if;

  v_is_admin := coalesce(private.current_user_is_admin(), false);
  v_view_scope := private.current_user_scope_for('expenses.view');
  v_edit_scope := private.current_user_scope_for('expenses.edit');
  v_approve_scope := private.current_user_scope_for('expenses.approve');

  -- Mirror the live view policy before returning any current or replayed data.
  -- Every command is submitter-owned, so `own` and `all` are the only scopes
  -- that can see this row under the existing RLS contract.
  if not coalesce(v_is_admin or v_view_scope in ('all', 'own'), false) then
    raise exception 'Expense view permission is required'
      using errcode = '42501';
  end if;

  if not v_existing and not coalesce(
    private.current_user_has_permission('expenses.create', 'all'),
    false
  ) then
    raise exception 'Expense creation permission is required'
      using errcode = '42501';
  end if;
  if v_existing and not coalesce((
    v_is_admin
    or v_approve_scope = 'all'
    or v_edit_scope = 'all'
    or v_edit_scope = 'own'
  ), false) then
    raise exception 'Expense edit permission is required'
      using errcode = '42501';
  end if;

  if v_category_id is not null and not exists (
    select 1
      from public.expense_categories c
     where c.id = v_category_id
       and c.company_id = v_company_id
       and (
         coalesce(c.is_active, false)
         or (v_existing and v_exp.category_id = c.id)
       )
  ) then
    raise exception 'Expense category is not available to this company'
      using errcode = '23503';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(v_allocations)
        as a(project_id text, percentage numeric, amount numeric)
      left join public.projects p
        on p.id::text = a.project_id
       and p.company_id = v_company_id
       and p.deleted_at is null
     where p.id is null
  ) then
    raise exception 'Expense allocation project is not available to this company'
      using errcode = '23503';
  end if;

  v_require_receipt := coalesce((
    select es.require_receipt_photo
      from public.expense_settings es
     where es.company_id = v_company_id
  ), true);
  v_require_project := coalesce((
    select es.require_project_assignment
      from public.expense_settings es
     where es.company_id = v_company_id
  ), false);
  v_review_frequency := coalesce((
    select es.review_frequency
      from public.expense_settings es
     where es.company_id = v_company_id
  ), 'monthly');

  if v_review_frequency = 'per_job' and v_allocation_count > 1 then
    raise exception 'Per-job companies allow one project per expense'
      using errcode = '22023';
  end if;

  -- Canonicalize desired allocations once for idempotent lost-response
  -- reconciliation. JSONB numeric equality treats 100 and 100.00 alike.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'project_id', a.project_id,
        'percentage', a.percentage,
        'amount', a.amount
      ) order by a.project_id, a.percentage, a.amount nulls first
    ),
    '[]'::jsonb
  ) into v_desired_allocations
  from jsonb_to_recordset(v_allocations)
    as a(project_id text, percentage numeric, amount numeric);

  if v_existing then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'project_id', a.project_id,
          'percentage', a.percentage,
          'amount', a.amount
        ) order by a.project_id, a.percentage, a.amount nulls first
      ),
      '[]'::jsonb
    ) into v_current_allocations
    from public.expense_project_allocations a
    where a.expense_id = v_expense_id;

    v_content_matches :=
         v_exp.category_id is not distinct from v_category_id
     and v_exp.merchant_name is not distinct from v_merchant_name
     and v_exp.description is not distinct from v_description
     and v_exp.amount is not distinct from v_amount
     and v_exp.tax_amount is not distinct from v_tax_amount
     and v_exp.currency is not distinct from v_currency
     and v_exp.expense_date is not distinct from v_expense_date
     and v_exp.payment_method is not distinct from v_payment_method
     and v_exp.receipt_image_url is not distinct from v_receipt_image_url
     and v_exp.receipt_thumbnail_url is not distinct from v_receipt_thumbnail_url
     and v_exp.receipt_missing_reason is not distinct from v_receipt_missing_reason
     and v_exp.receipt_missing_note is not distinct from v_receipt_missing_note
     and v_exp.project_missing_reason is not distinct from v_project_missing_reason
     and v_exp.project_missing_note is not distinct from v_project_missing_note
     and v_exp.ocr_raw_data is not distinct from v_ocr_raw_data
     and v_exp.ocr_confidence is not distinct from v_ocr_confidence
     and v_current_allocations = v_desired_allocations;

    if v_submit then
      v_status_matches := v_exp.status in ('submitted', 'approved', 'reimbursed')
        and v_exp.batch_id is not null;
    else
      v_status_matches := v_exp.status = coalesce(v_expected_status, 'draft')
        and (v_exp.status not in ('submitted', 'approved', 'reimbursed') or v_exp.batch_id is not null);
    end if;

    -- A matching live snapshot proves the complete transaction committed. This
    -- check intentionally precedes CAS so a lost response remains idempotent
    -- after placement or under-threshold approval advanced status/updated_at.
    if v_content_matches and v_status_matches then
      update private.expense_save_requests
         set completed_at = coalesce(completed_at, clock_timestamp())
       where request_id = v_request_id;
      return private.expense_atomic_response(v_expense_id);
    end if;

    if v_request.completed_at is not null then
      raise exception 'Expense save request already completed and the expense has since changed'
        using errcode = 'P0001';
    end if;
    if v_expected_status is null
       or v_expected_updated_at is null
       or v_exp.status <> v_expected_status
       or v_exp.updated_at is distinct from v_expected_updated_at then
      raise exception 'Expense changed while it was open; reload before saving'
        using errcode = 'P0001';
    end if;
    if v_exp.status not in ('draft', 'rejected', 'submitted') then
      raise exception 'Approved or paid expenses cannot be edited'
        using errcode = '42501';
    end if;
  end if;

  if v_submit and v_require_receipt
     and v_receipt_image_url is null and v_receipt_missing_reason is null then
    raise exception 'A receipt photo or no-receipt reason is required before submission'
      using errcode = '23514';
  end if;
  if v_submit and v_require_project
     and v_allocation_count = 0 and v_project_missing_reason is null then
    raise exception 'A project or no-project reason is required before submission'
      using errcode = '23514';
  end if;

  if not v_existing then
    insert into public.expenses (
      id, company_id, submitted_by, status, category_id, merchant_name,
      description, amount, tax_amount, currency, expense_date, payment_method,
      receipt_image_url, receipt_thumbnail_url, receipt_missing_reason,
      receipt_missing_note, project_missing_reason, project_missing_note,
      ocr_raw_data, ocr_confidence
    ) values (
      v_expense_id, v_company_id, v_user_id, 'draft', v_category_id,
      v_merchant_name, v_description, v_amount, v_tax_amount, v_currency,
      v_expense_date, v_payment_method, v_receipt_image_url,
      v_receipt_thumbnail_url, v_receipt_missing_reason,
      v_receipt_missing_note, v_project_missing_reason,
      v_project_missing_note, v_ocr_raw_data, v_ocr_confidence
    ) returning * into v_exp;
    v_old_batch_id := null;
  else
    v_old_batch_id := v_exp.batch_id;
    delete from public.expense_project_allocations
     where expense_id = v_expense_id;
  end if;

  insert into public.expense_project_allocations (
    expense_id, project_id, percentage, amount
  )
  select v_expense_id, a.project_id, a.percentage, a.amount
    from jsonb_to_recordset(v_allocations)
      as a(project_id text, percentage numeric, amount numeric);

  if v_existing then
    v_target_status := case when v_submit then 'submitted' else v_exp.status end;
    v_should_refile := v_exp.status = 'submitted'
      or (v_submit and v_exp.status in ('draft', 'rejected'));

    update public.expenses
       set category_id = v_category_id,
           merchant_name = v_merchant_name,
           description = v_description,
           amount = v_amount,
           tax_amount = v_tax_amount,
           currency = v_currency,
           expense_date = v_expense_date,
           payment_method = v_payment_method,
           receipt_image_url = v_receipt_image_url,
           receipt_thumbnail_url = v_receipt_thumbnail_url,
           receipt_missing_reason = v_receipt_missing_reason,
           receipt_missing_note = v_receipt_missing_note,
           project_missing_reason = v_project_missing_reason,
           project_missing_note = v_project_missing_note,
           ocr_raw_data = v_ocr_raw_data,
           ocr_confidence = v_ocr_confidence,
           status = v_target_status,
           batch_id = case when v_should_refile then null else v_exp.batch_id end,
           updated_at = now()
     where id = v_expense_id;
  elsif v_submit then
    update public.expenses
       set status = 'submitted',
           batch_id = null,
           updated_at = now()
     where id = v_expense_id;
  end if;

  -- The AFTER trigger has completed before this statement. Its placement uses
  -- the new allocations because they were replaced first inside this same
  -- transaction, and it has recalculated the destination envelope.
  select * into strict v_saved
    from public.expenses
   where id = v_expense_id;

  if v_saved.status in ('submitted', 'approved', 'reimbursed')
     and v_saved.batch_id is null then
    raise exception 'Expense placement did not produce a batch'
      using errcode = 'P0001';
  end if;

  -- Placement owns the destination total. Always recompute the prior envelope
  -- as well; doing this even when source = destination is harmless and closes
  -- the old stale-total failure without swallowing any error.
  if v_old_batch_id is not null then
    perform public.recalculate_expense_batch_total(v_old_batch_id);
  end if;

  update private.expense_save_requests
     set completed_at = clock_timestamp()
   where request_id = v_request_id;

  return private.expense_atomic_response(v_expense_id);
end;
$function$;

revoke execute on function public.save_expense_atomic(jsonb) from public, anon, service_role;
grant execute on function public.save_expense_atomic(jsonb) to authenticated;

comment on function public.save_expense_atomic(jsonb) is
  'Atomically creates or updates one submitter-owned expense, replaces allocations, applies exception metadata, submits/refiles it, and recalculates affected envelope totals.';
