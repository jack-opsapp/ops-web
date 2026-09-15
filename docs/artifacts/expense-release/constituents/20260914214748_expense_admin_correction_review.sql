-- Pending. Requires the P5 expense decision, accounting lifecycle and payroll migrations.
-- A correction returns a crew expense for review. It never approves or pays it.
begin;

-- Fail closed if a parallel release changed the functions this narrow patch
-- extends. The second hash is this exact implementation (safe reapplication).
do $$
begin
  if to_regprocedure('private.lock_expense_approver_context()') is null
    or to_regclass('public.expense_accounting_events') is null
    or to_regclass('private.expense_accounting_state') is null
    or not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='expense_batches' and column_name='reimbursement_amount') then
    raise exception 'Install the P5 expense decision and accounting migrations first';
  end if;
  if to_regprocedure('public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamptz,date,integer,integer,integer,integer)') is null
    or md5(pg_get_functiondef('public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamptz,date,integer,integer,integer,integer)'::regprocedure))<>'f2e32a360886d5fed5040c5eb99b76c6' then
    raise exception 'Install and review the P5 expense payroll compatibility migration first';
  end if;
  if md5(pg_get_functiondef('private.enforce_expense_edit_authority()'::regprocedure)) not in
      ('a489f4f6506516e5934ff08f8fba69ad','d342596cd9e55adf458239a7025dfeaa')
    or md5(pg_get_functiondef('public.tg_place_expense()'::regprocedure)) not in
      ('2a9d3575dd23507040a31cb49dc69825','258dc02efee98372f6205e731ac0251f')
    or md5(pg_get_functiondef('public.place_expense(uuid)'::regprocedure)) not in
      ('69ae7eaa26297db59646c704ea454712','5d3a1254421fc4378f9b9a32d4cc3bd5') then
    raise exception 'Expense authority or placement changed; review the correction migration before applying';
  end if;
end; $$;

create table if not exists private.expense_correction_requests (
  request_id uuid primary key,
  company_id uuid not null,
  actor_id uuid not null,
  submitted_by uuid not null,
  expense_id uuid not null,
  command_hash text not null,
  correction jsonb not null check (jsonb_typeof(correction)='object'),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists expense_correction_history_idx
  on private.expense_correction_requests(company_id,expense_id,created_at desc,request_id);
alter table private.expense_correction_requests enable row level security;
revoke all on private.expense_correction_requests from public,anon,authenticated,service_role;

-- Unresolved correction custody also protects the scheduled envelope sweep.
create table if not exists private.expense_correction_pending (
  expense_id uuid primary key, request_id uuid not null, company_id uuid not null,
  actor_id uuid not null, marked_at timestamptz not null, feedback text not null
);
alter table private.expense_correction_pending enable row level security;
revoke all on private.expense_correction_pending from public,anon,authenticated,service_role;

-- Short-lived, unforgeable transaction capability. No client can write this
-- table or widen ordinary uploader-only saves by setting a custom GUC.
create table if not exists private.expense_correction_scope (
  transaction_id xid8 not null,
  expense_id uuid not null,
  company_id uuid not null,
  actor_id uuid not null,
  before_content jsonb not null,
  after_content jsonb not null,
  primary key(transaction_id,expense_id)
);
alter table private.expense_correction_scope enable row level security;
revoke all on private.expense_correction_scope from public,anon,authenticated,service_role;

create or replace function private.expense_correction_content(p_expense public.expenses)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'category_id',p_expense.category_id,'merchant_name',p_expense.merchant_name,
    'description',p_expense.description,'amount',p_expense.amount,'tax_amount',p_expense.tax_amount,
    'currency',p_expense.currency,'expense_date',p_expense.expense_date,
    'payment_method',p_expense.payment_method,'project_missing_reason',p_expense.project_missing_reason,
    'project_missing_note',p_expense.project_missing_note);
$$;
revoke all on function private.expense_correction_content(public.expenses) from public,anon,authenticated,service_role;

create or replace function private.expense_correction_snapshot(p_expense public.expenses)
returns jsonb language sql stable set search_path='' as $$
  select private.expense_correction_content(p_expense) || jsonb_build_object(
    'status',p_expense.status,
    'updated_at',to_char(p_expense.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'category_name',(select name from public.expense_categories where id=p_expense.category_id and company_id=p_expense.company_id),
    'allocations',coalesce((select jsonb_agg(jsonb_build_object(
      'project_id',a.project_id,'project_title',p.title,'percentage',a.percentage,'amount',a.amount)
      order by a.project_id) from public.expense_project_allocations a
      left join public.projects p on p.id::text=a.project_id and p.company_id=p_expense.company_id
      where a.expense_id=p_expense.id),'[]'::jsonb));
$$;
revoke all on function private.expense_correction_snapshot(public.expenses) from public,anon,authenticated,service_role;

create or replace function private.immutable_expense_correction()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Expense correction history is immutable' using errcode='42501'; end; $$;
drop trigger if exists immutable_expense_correction on private.expense_correction_requests;
create trigger immutable_expense_correction before update or delete on private.expense_correction_requests
  for each row execute function private.immutable_expense_correction();
revoke all on function private.immutable_expense_correction() from public,anon,authenticated,service_role;

-- Preserve the released uploader-only boundary; the exception is exactly one
-- authorized business-content update returning this expense to its submitter.
create or replace function private.enforce_expense_edit_authority()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_is_admin boolean; v_correction boolean;
  v_pending private.expense_correction_pending;
begin
  if coalesce(current_setting('request.jwt.claims',true),'')='' then return new; end if;
  v_uid:=private.get_current_user_id();
  v_is_admin:=private.current_user_is_admin();
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
end; $$;

-- An unbatched return must not be automatically approved by place_expense.
-- Only this private transaction scope suppresses placement; crew resubmission
-- continues through the existing atomic save/refile operation after it closes.
create or replace function public.tg_place_expense()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.expense_correction_scope s
    where s.transaction_id=pg_current_xact_id() and s.expense_id=new.id
      and s.company_id=new.company_id and s.actor_id=private.get_current_user_id()) then
    return new;
  end if;
  if new.deleted_at is null and new.status<>'draft' and new.batch_id is null then
    perform public.place_expense(new.id);
  end if;
  return new;
end; $$;

CREATE OR REPLACE FUNCTION public.place_expense(p_expense_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_exp     public.expenses;
  v_freq    text;
  v_ps      date; v_pe date;
  v_scope   uuid;
  v_batch   public.expense_batches;
  v_home_approved boolean;
  v_threshold numeric;
begin
  select * into v_exp from public.expenses where id = p_expense_id;
  if v_exp.id is null or v_exp.deleted_at is not null then return; end if;
  if v_exp.status = 'draft' or v_exp.batch_id is not null then return; end if;
  -- A correction stays with its submitter until an explicit resubmission.
  if v_exp.status='rejected' and exists(select 1 from private.expense_correction_pending p
    where p.expense_id=v_exp.id and p.company_id=v_exp.company_id) then return; end if;

  select coalesce(es.review_frequency,'monthly') into v_freq
  from public.expense_settings es where es.company_id = v_exp.company_id;
  v_freq := coalesce(v_freq,'monthly');

  select period_start, period_end into v_ps, v_pe
  from public.expense_envelope_period(v_exp.expense_date, v_freq);

  if v_freq = 'per_job' then
    select project_id into v_scope
    from public.expense_project_allocations
    where expense_id = v_exp.id order by id limit 1;   -- no created_at column on this table
  else
    v_scope := null;
  end if;

  -- Home-period envelope already approved? Then roll forward to the current period.
  select exists(
    select 1 from public.expense_batches b
    where b.company_id = v_exp.company_id and b.submitted_by = v_exp.submitted_by
      and b.amendment_number = 0 and b.status = 'approved'
      and coalesce(b.period_start,'1970-01-01'::date) = v_ps
      and coalesce(b.period_end,'1970-01-01'::date)   = v_pe
      and coalesce(b.scope_project_id,'00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_scope,'00000000-0000-0000-0000-000000000000'::uuid)
  ) into v_home_approved;

  if v_home_approved then
    select period_start, period_end into v_ps, v_pe
    from public.expense_envelope_period(current_date, v_freq);
  end if;

  v_batch := public.get_or_create_open_batch(
    v_exp.company_id, v_exp.submitted_by, v_ps, v_pe, v_scope);

  update public.expenses set batch_id = v_batch.id, updated_at = now()
  where id = v_exp.id;

  perform public.recalculate_expense_batch_total(v_batch.id);

  -- Under-threshold auto-clear: keep it in the envelope (books stay complete) but clear the line.
  select auto_approve_threshold into v_threshold
  from public.expense_settings es where es.company_id = v_exp.company_id;
  if coalesce(v_threshold, 0) > 0 and v_exp.amount is not null and v_exp.amount < v_threshold then
    update public.expenses set status = 'approved', updated_at = now()
    where id = v_exp.id and status <> 'approved';
  end if;
end;
$function$;

create or replace function private.correct_expense_for_review(p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare
  v_request uuid; v_id uuid; v_company uuid; v_actor uuid; v_submitter uuid;
  v_expected timestamptz; v_expected_status text; v_hash text; v_note text; v_context record;
  v_existing private.expense_correction_requests%rowtype;
  v_exp public.expenses; v_next public.expenses; v_batch public.expense_batches;
  v_before jsonb; v_after jsonb; v_record jsonb; v_allocations jsonb;
  v_count integer; v_total numeric; v_category uuid; v_today date; v_frequency text; v_marked_at timestamptz;
  v_keys text[]:=array['request_id','expense_id','company_id','actor_id','submitted_by',
    'expected_status','expected_updated_at','correction_note','category_id','merchant_name',
    'description','amount','tax_amount','currency','expense_date','payment_method',
    'project_missing_reason','project_missing_note','allocations'];
begin
  if p_command is null or jsonb_typeof(p_command)<>'object' then
    raise exception 'Expense correction must be an object' using errcode='22023';
  end if;
  if not p_command ?& v_keys or exists(select 1 from jsonb_object_keys(p_command) k where not k=any(v_keys)) then
    raise exception 'Expense correction contains missing or unsupported fields' using errcode='22023';
  end if;
  if exists(select 1 from unnest(array['request_id','expense_id','company_id','actor_id','submitted_by',
    'expected_status','expected_updated_at','correction_note','merchant_name','currency','expense_date','payment_method']) k
    where jsonb_typeof(p_command->k)<>'string')
    or exists(select 1 from unnest(array['category_id','description','project_missing_reason','project_missing_note']) k
      where jsonb_typeof(p_command->k) not in('string','null'))
    or jsonb_typeof(p_command->'amount')<>'number'
    or jsonb_typeof(p_command->'tax_amount') not in('number','null')
    or jsonb_typeof(p_command->'allocations')<>'array' then
    raise exception 'Expense correction contains an invalid field type' using errcode='22023';
  end if;
  begin
    v_request:=(p_command->>'request_id')::uuid; v_id:=(p_command->>'expense_id')::uuid;
    v_company:=(p_command->>'company_id')::uuid; v_actor:=(p_command->>'actor_id')::uuid;
    v_submitter:=(p_command->>'submitted_by')::uuid;
    v_expected:=(p_command->>'expected_updated_at')::timestamptz;
    v_category:=(p_command->>'category_id')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Expense correction contains an invalid identifier or revision' using errcode='22023';
  end;
  if v_actor is distinct from private.get_current_user_id() or not exists(
    select 1 from public.users u join public.companies c on c.id=u.company_id
      where u.id=v_actor and u.company_id=v_company and u.is_active and u.deleted_at is null and c.deleted_at is null)
    or v_submitter=v_actor or not coalesce(private.current_user_is_admin() or
      (private.current_user_scope_for('expenses.approve')='all' and private.current_user_scope_for('expenses.view')='all'),false) then
    raise exception 'Expense correction access denied' using errcode='42501';
  end if;
  -- Same serialization namespace as normal saves and P5 financial decisions.
  perform pg_advisory_xact_lock(hashtextextended('save_expense_atomic:'||v_company::text,0));
  select * into v_context from private.lock_expense_approver_context();
  if v_context.actor_id is distinct from v_actor or v_context.company_id is distinct from v_company then
    raise exception 'Expense correction identity changed' using errcode='42501';
  end if;
  perform 1 from public.users where id=v_submitter and company_id=v_company
    and is_active and deleted_at is null for share nowait;
  if not found or not coalesce(private.current_user_is_admin() or
    (private.current_user_scope_for('expenses.approve')='all' and private.current_user_scope_for('expenses.view')='all'),false) then
    raise exception 'Expense correction access denied' using errcode='42501';
  end if;
  v_hash:=encode(extensions.digest(p_command::text,'sha256'),'hex');
  select * into v_existing from private.expense_correction_requests where request_id=v_request;
  if found then
    if row(v_existing.company_id,v_existing.actor_id,v_existing.submitted_by,v_existing.expense_id,v_existing.command_hash)
      is distinct from row(v_company,v_actor,v_submitter,v_id,v_hash) then
      raise exception 'Expense correction request was reused with different content' using errcode='22023';
    end if;
    if not exists(select 1 from public.expenses where id=v_id and company_id=v_company
      and submitted_by=v_submitter and deleted_at is null) then
      raise exception 'Expense is no longer available' using errcode='42501';
    end if;
    return jsonb_build_object('request_id',v_request,'expense_id',v_id,'company_id',v_company,
      'actor_id',v_actor,'submitted_by',v_submitter,'replayed',true,'correction',v_existing.correction);
  end if;

  v_note:=btrim(p_command->>'correction_note');
  v_expected_status:=p_command->>'expected_status';
  if length(v_note)>2000 or v_expected_status not in('submitted','rejected')
    or v_expected is null or not isfinite(v_expected) then
    raise exception 'Reload the current expense and shorten the correction note' using errcode='22023';
  end if;
  -- Respect allocation -> parent ordering of older clients. NOWAIT makes
  -- opposite direct-write lock orders fail with a retryable conflict.
  perform 1 from public.expense_project_allocations a join public.expenses e on e.id=a.expense_id
    where e.id=v_id and e.company_id=v_company and e.submitted_by=v_submitter and e.deleted_at is null
    order by a.id for update of a nowait;
  select * into v_exp from public.expenses where id=v_id and company_id=v_company
    and submitted_by=v_submitter and deleted_at is null for update nowait;
  if not found then raise exception 'Expense correction access denied' using errcode='42501'; end if;
  if v_exp.updated_at<>v_expected or v_exp.status<>v_expected_status then
    raise exception 'Expense changed; reload it before returning a correction' using errcode='P0001';
  end if;
  if v_exp.status not in('submitted','rejected') or v_exp.approved_at is not null or v_exp.approved_by is not null
    or v_exp.accounting_sync_id is not null or v_exp.accounting_synced_at is not null
    or coalesce(v_exp.accounting_sync_status,'pending')<>'pending'
    or exists(select 1 from public.expense_accounting_events where company_id=v_company and expense_id=v_id)
    or exists(select 1 from private.expense_accounting_state where expense_id=v_id and
      (active_accrual_id is not null or active_payment_id is not null or legacy_review_required)) then
    raise exception 'Approved or exported expenses cannot use crew corrections' using errcode='55000';
  end if;
  if not exists(select 1 from public.users where id=v_submitter and company_id=v_company
    and is_active and deleted_at is null) then
    raise exception 'Expense submitter is no longer active' using errcode='42501';
  end if;
  if v_exp.batch_id is not null then
    select * into v_batch from public.expense_batches where id=v_exp.batch_id for update nowait;
    if not found or v_batch.company_id is distinct from v_company or v_batch.submitted_by is distinct from v_submitter then
      raise exception 'Expense envelope identity does not match' using errcode='42501';
    end if;
    if v_batch.paid_at is not null or v_batch.paid_by is not null
      or coalesce(v_batch.status,'') not in('open','pending_review','submitted','rejected')
      or v_batch.reviewed_by is not null or v_batch.reviewed_at is not null then
      raise exception 'Reviewed or paid envelopes cannot use crew corrections' using errcode='55000';
    end if;
    if exists(select 1 from public.expenses e where e.batch_id=v_batch.id and e.company_id is distinct from v_company) then
      raise exception 'Expense envelope contains a foreign expense' using errcode='42501';
    end if;
  end if;

  v_next:=v_exp;
  v_next.category_id:=v_category; v_next.merchant_name:=btrim(p_command->>'merchant_name');
  v_next.description:=p_command->>'description'; v_next.amount:=(p_command->>'amount')::numeric;
  v_next.tax_amount:=(p_command->>'tax_amount')::numeric; v_next.currency:=p_command->>'currency';
  begin v_next.expense_date:=(p_command->>'expense_date')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Expense date is invalid' using errcode='22023'; end;
  v_next.payment_method:=p_command->>'payment_method';
  v_next.project_missing_reason:=nullif(p_command->>'project_missing_reason','');
  v_next.project_missing_note:=nullif(p_command->>'project_missing_note','');
  if length(v_next.merchant_name) not between 1 and 500 or length(v_next.description)>10000
    or length(v_next.project_missing_note)>2000 or v_next.amount<=0 or v_next.amount>10000
    or v_next.amount<>round(v_next.amount,2)
    or (v_next.tax_amount is not null and (v_next.tax_amount<0 or v_next.tax_amount>v_next.amount*0.20
      or v_next.tax_amount<>round(v_next.tax_amount,2)))
    or v_next.currency!~'^[A-Z]{3}$' or v_next.payment_method not in('cash','personal_card','company_card') then
    raise exception 'Expense correction contains invalid expense details' using errcode='22023';
  end if;
  select (clock_timestamp() at time zone coalesce(tz.name,'UTC'))::date into v_today
    from public.companies c left join pg_catalog.pg_timezone_names tz on tz.name=c.timezone where c.id=v_company;
  if not isfinite(v_next.expense_date) or v_next.expense_date>v_today
    or v_next.expense_date<(v_today-interval '5 years')::date then
    raise exception 'Expense date is outside the allowed range' using errcode='22023';
  end if;
  v_allocations:=p_command->'allocations';
  if jsonb_array_length(v_allocations)>100 then
    raise exception 'Too many expense allocations' using errcode='22023';
  end if;
  for v_after in select value from jsonb_array_elements(v_allocations) loop
    if jsonb_typeof(v_after)<>'object' then
      raise exception 'Expense allocation must be an object' using errcode='22023';
    end if;
    if not v_after ?& array['project_id','percentage','amount']
      or exists(select 1 from jsonb_object_keys(v_after) k where k not in('project_id','percentage','amount'))
      or jsonb_typeof(v_after->'project_id')<>'string' or jsonb_typeof(v_after->'percentage')<>'number'
      or jsonb_typeof(v_after->'amount')<>'null' then
      raise exception 'Expense allocation has invalid fields' using errcode='22023';
    end if;
  end loop;
  select count(*),coalesce(sum(a.percentage),0) into v_count,v_total
    from jsonb_to_recordset(v_allocations) a(project_id text,percentage numeric,amount numeric);
  if (v_count>0 and v_total<>100) or exists(select 1 from jsonb_to_recordset(v_allocations)
    a(project_id text,percentage numeric,amount numeric) where a.percentage<=0 or a.percentage>100
      or a.percentage<>round(a.percentage,2)) or exists(select 1 from jsonb_to_recordset(v_allocations)
    a(project_id text,percentage numeric,amount numeric) group by a.project_id having count(*)>1) then
    raise exception 'Expense allocations must be unique and total 100 percent' using errcode='22023';
  end if;
  select coalesce(review_frequency,'monthly') into v_frequency from public.expense_settings where company_id=v_company;
  if v_frequency='per_job' and v_count>1 then
    raise exception 'Per-job expenses allow one project' using errcode='22023';
  end if;
  if v_count>0 then v_next.project_missing_reason:=null; v_next.project_missing_note:=null;
  elsif v_next.project_missing_reason is null then v_next.project_missing_note:=null; end if;
  if v_next.project_missing_reason is not null and v_next.project_missing_reason not in('overhead','general','other') then
    raise exception 'Expense project exception is invalid' using errcode='22023';
  end if;
  -- Freeze the identities/labels used by this correction. A concurrent
  -- category removal or project tenant change cannot invalidate validation.
  perform 1 from public.expense_categories where id in(v_exp.category_id,v_category)
    and company_id=v_company order by id for share nowait;
  perform 1 from public.projects p where p.company_id=v_company and (p.id::text in(
    select a.project_id from jsonb_to_recordset(v_allocations) a(project_id text,percentage numeric,amount numeric))
    or p.id::text in(select project_id from public.expense_project_allocations where expense_id=v_id))
    order by p.id for share nowait;
  if v_category is not null and not exists(select 1 from public.expense_categories where id=v_category
    and company_id=v_company and (is_active or id=v_exp.category_id)) then
    raise exception 'Expense category is unavailable' using errcode='23503';
  end if;
  if exists(select 1 from jsonb_to_recordset(v_allocations) a(project_id text,percentage numeric,amount numeric)
    left join public.projects p on p.id::text=a.project_id and p.company_id=v_company and p.deleted_at is null
    where p.id is null) then
    raise exception 'Expense allocation project is unavailable' using errcode='23503';
  end if;
  v_before:=private.expense_correction_snapshot(v_exp);
  if private.expense_correction_content(v_exp)=private.expense_correction_content(v_next)
    and coalesce((select jsonb_agg(value-'project_title' order by value->>'project_id')
      from jsonb_array_elements(v_before->'allocations')),'[]'::jsonb)
      =coalesce((select jsonb_agg(value order by value->>'project_id') from jsonb_array_elements(v_allocations)),'[]'::jsonb) then
    raise exception 'Change an expense field or use Flag for a note' using errcode='22023';
  end if;
  -- Recheck revocable grants immediately before the first write.
  if not coalesce(private.current_user_is_admin() or
    (private.current_user_scope_for('expenses.approve')='all' and private.current_user_scope_for('expenses.view')='all'),false) then
    raise exception 'Expense correction access denied' using errcode='42501';
  end if;
  insert into private.expense_correction_scope values(pg_current_xact_id(),v_id,v_company,v_actor,
    private.expense_correction_content(v_exp),private.expense_correction_content(v_next));
  v_marked_at:=clock_timestamp();
  insert into private.expense_correction_pending(expense_id,request_id,company_id,actor_id,marked_at,feedback)
    values(v_id,v_request,v_company,v_actor,v_marked_at,coalesce(nullif(v_note,''),'Review corrected expense details.'))
    on conflict(expense_id) do update set request_id=excluded.request_id,company_id=excluded.company_id,
      actor_id=excluded.actor_id,marked_at=excluded.marked_at,feedback=excluded.feedback;
  update public.expenses set category_id=v_next.category_id,merchant_name=v_next.merchant_name,
    description=v_next.description,amount=v_next.amount,tax_amount=v_next.tax_amount,currency=v_next.currency,
    expense_date=v_next.expense_date,payment_method=v_next.payment_method,
    project_missing_reason=v_next.project_missing_reason,project_missing_note=v_next.project_missing_note,
    status='rejected',flag_comment=coalesce(nullif(v_note,''),'Review corrected expense details.'),flagged_by=v_actor,flagged_at=v_marked_at,
    rejection_reason=coalesce(nullif(v_note,''),'Review corrected expense details.'),rejected_by=v_actor,rejected_at=v_marked_at
    where id=v_id;
  delete from public.expense_project_allocations where expense_id=v_id;
  insert into public.expense_project_allocations(expense_id,project_id,percentage,amount)
    select v_id,a.project_id,a.percentage,a.amount from jsonb_to_recordset(v_allocations)
      a(project_id text,percentage numeric,amount numeric);
  if v_exp.batch_id is not null then perform public.recalculate_expense_batch_total(v_exp.batch_id); end if;
  select * into strict v_next from public.expenses where id=v_id;
  v_record:=jsonb_build_object('id',v_request,'request_id',v_request,'expense_id',v_id,'company_id',v_company,
    'actor_id',v_actor,'submitted_by',v_submitter,'corrected_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'correction_note',v_note,'before',v_before,'after',private.expense_correction_snapshot(v_next));
  insert into private.expense_correction_requests(request_id,company_id,actor_id,submitted_by,expense_id,command_hash,correction)
    values(v_request,v_company,v_actor,v_submitter,v_id,v_hash,v_record);
  insert into public.notifications(user_id,company_id,type,title,body,expense_id,batch_id,deep_link_type,
    is_read,persistent,action_url,action_label,dedupe_key)
    values(v_submitter::text,v_company::text,'expense_rejected','Expense corrected',
      'Review the changes, then resubmit your expense.',v_id::text,v_exp.batch_id::text,'expense',
      false,false,'/books?segment=expenses'||case when v_exp.batch_id is null then '' else '&batch='||v_exp.batch_id::text end,'Review expense','expense_correction:'||v_request::text);
  delete from private.expense_correction_scope where transaction_id=pg_current_xact_id() and expense_id=v_id;
  return jsonb_build_object('request_id',v_request,'expense_id',v_id,'company_id',v_company,
    'actor_id',v_actor,'submitted_by',v_submitter,'replayed',false,'correction',v_record);
exception when lock_not_available or deadlock_detected then
  raise exception 'Expense is busy; retry this correction' using errcode='40001';
end; $$;
revoke all on function private.correct_expense_for_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.correct_expense_for_review(jsonb) to authenticated;
create or replace function public.correct_expense_for_review(p_command jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.correct_expense_for_review(p_command);
$$;
revoke all on function public.correct_expense_for_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.correct_expense_for_review(jsonb) to authenticated;

create or replace function private.list_expense_corrections(p_expense_id uuid,p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid; v_submitter uuid;
begin
  v_actor:=private.get_current_user_id();
  if not exists(select 1 from public.users u join public.companies c on c.id=u.company_id
    where u.id=v_actor and u.company_id=p_company_id and u.is_active and u.deleted_at is null and c.deleted_at is null) then
    raise exception 'Expense correction history access denied' using errcode='42501';
  end if;
  select submitted_by into v_submitter from public.expenses where id=p_expense_id and company_id=p_company_id and deleted_at is null;
  if not found or not coalesce(private.current_user_is_admin()
    or (v_submitter=v_actor and private.current_user_scope_for('expenses.view') in('own','all'))
    or (private.current_user_scope_for('expenses.view')='all' and private.current_user_scope_for('expenses.approve')='all'),false) then
    raise exception 'Expense correction history access denied' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(correction order by created_at desc,request_id desc)
    from private.expense_correction_requests where company_id=p_company_id and expense_id=p_expense_id),'[]'::jsonb);
end; $$;
revoke all on function private.list_expense_corrections(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.list_expense_corrections(uuid,uuid) to authenticated;
create or replace function public.list_expense_corrections(p_expense_id uuid,p_company_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.list_expense_corrections(p_expense_id,p_company_id);
$$;
revoke all on function public.list_expense_corrections(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_expense_corrections(uuid,uuid) to authenticated;
commit;
