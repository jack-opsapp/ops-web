-- Account closure: expense authority triggers honour internal maintenance.
--
-- public.purge_company_data runs account closure inside the API's own session:
-- PostgREST logs in as authenticator, sets role service_role, and the function
-- clears request.jwt.claims for its transaction. Its contract, written into
-- that function, is that expense authority triggers treat empty claims as an
-- internal maintenance operation; private.enforce_expense_edit_authority does.
--
-- Three authority triggers recognise maintenance only through service_role
-- claims or a postgres login:
--   private.enforce_expense_accounting_authority          expense release, 2026-09-15
--   private.enforce_expense_accounting_related_authority  expense release, 2026-09-15
--   private.enforce_expense_recurring_line_authority      recurring reimbursements, 2026-09-17
-- PostgREST 12 and later never set the legacy request.jwt.claim.role setting,
-- and API sessions never log in as postgres. Closing any company that has an
-- expense allocation, a live expense or a live recurring reimbursement line
-- therefore raises 42501 and rolls the whole closure back.
--
-- Each function is replaced by its exact production body with one change:
-- empty claims also count as maintenance. Inside an API session only
-- purge_company_data, executable by service_role alone, clears the claims.
-- Every check that follows the maintenance test is unchanged.

begin;

-- Fail closed unless each function is the released body or this repair.
do $expense_authority_closure_baseline$
declare
  v_mismatch text;
begin
  if current_user <> 'postgres' then
    raise exception 'Expense authority closure repair requires the postgres migration owner';
  end if;

  select expected.signature into v_mismatch
  from (values
    ('private.enforce_expense_accounting_authority()', '15919972aa7bced567a0ae3dfff5a807', '78a83536fed8e07cd68f2ab06fc9b9c6'),
    ('private.enforce_expense_accounting_related_authority()', '2385c486b3afbadff7144d40b7c670f5', '3877ccc6e2eeaf301a8c034c5f5ec39d'),
    ('private.enforce_expense_recurring_line_authority()', '770938427ea5240134ea97e82968dae6', 'dd60236cf95314a46902076b130e3aec')
  ) as expected(signature, released_md5, repaired_md5)
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(expected.signature)
  where p.oid is null
     or pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) not in (expected.released_md5, expected.repaired_md5)
  limit 1;

  if v_mismatch is not null then
    raise exception 'Expense authority changed after 2026-09-17 (%); review this repair before applying', v_mismatch;
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger t
    join (values
      ('public.expenses', 'enforce_expense_accounting_authority', 'private.enforce_expense_accounting_authority()'),
      ('public.expenses', 'enforce_expense_accounting_delete_authority', 'private.enforce_expense_accounting_related_authority()'),
      ('public.expense_batches', 'enforce_expense_batch_payment_authority', 'private.enforce_expense_accounting_related_authority()'),
      ('public.expense_project_allocations', 'enforce_expense_allocation_accounting_authority', 'private.enforce_expense_accounting_related_authority()'),
      ('public.expenses', 'enforce_expense_recurring_line_authority', 'private.enforce_expense_recurring_line_authority()')
    ) as expected(table_name, trigger_name, signature)
      on t.tgrelid = pg_catalog.to_regclass(expected.table_name)
     and t.tgname = expected.trigger_name
     and t.tgfoid = pg_catalog.to_regprocedure(expected.signature)
    where not t.tgisinternal and t.tgenabled = 'O'
  ) <> 5 then
    raise exception 'Expense authority triggers changed after 2026-09-17; review this repair before applying';
  end if;
end;
$expense_authority_closure_baseline$;

CREATE OR REPLACE FUNCTION private.enforce_expense_accounting_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid; v_company uuid; v_role text; v_approver boolean; v_auto boolean;
begin
  v_role:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  if v_role='service_role' or (v_role is null and (session_user='postgres'
    or coalesce(current_setting('request.jwt.claims',true),'')='')) then return new; end if;
  v_uid:=private.get_current_user_id();
  select u.company_id into v_company from public.users u join public.companies c on c.id=u.company_id
    where u.id=v_uid and u.is_active and u.deleted_at is null and c.deleted_at is null;
  if v_company is null or new.company_id is distinct from v_company then
    raise exception 'Expense access denied' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or
    new.submitted_by is distinct from old.submitted_by) then
    raise exception 'Expense company and submitter cannot change' using errcode='42501';
  end if;
  v_approver:=public.has_permission(v_uid,'expenses.approve','all');
  if new.status in ('approved','reimbursed') and
    (tg_op='INSERT' or new.status is distinct from old.status) then
    v_auto:=new.status='approved' and coalesce(new.amount,0)>0 and exists(
      select 1 from public.expense_settings s where s.company_id=v_company
        and s.auto_approve_threshold>new.amount)
      and new.submitted_by=v_uid;
    if not v_approver and not v_auto then
      raise exception 'Expense approval is required' using errcode='42501';
    end if;
    if new.status='reimbursed' and new.payment_method='company_card' then
      raise exception 'Company-card expenses do not require reimbursement' using errcode='22023';
    end if;
  end if;
  if tg_op='UPDATE' and old.status='reimbursed' and not v_approver and
    row(new.status,new.deleted_at,new.amount,new.tax_amount,new.currency,new.payment_method,new.category_id,new.expense_date,new.merchant_name,new.description)
      is distinct from row(old.status,old.deleted_at,old.amount,old.tax_amount,old.currency,old.payment_method,old.category_id,old.expense_date,old.merchant_name,old.description) then
    raise exception 'An approver must correct a recorded reimbursement' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.status='approved' and new.status='approved' and not v_approver and
    row(new.amount,new.tax_amount,new.currency,new.expense_date,new.payment_method,new.category_id,new.merchant_name,new.description,new.deleted_at)
      is distinct from row(old.amount,old.tax_amount,old.currency,old.expense_date,old.payment_method,old.category_id,old.merchant_name,old.description,old.deleted_at) then
    raise exception 'Resubmit this expense before changing its approved amount or accounting details' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.status='approved' and not v_approver and
    (new.status not in ('approved','submitted') or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'An approver must reject or remove approved expense accounting' using errcode='42501';
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION private.enforce_expense_accounting_related_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_uid uuid; v_company uuid; v_exp public.expenses; v_id uuid;
begin
  v_role:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  if v_role='service_role' or (v_role is null and (session_user='postgres'
    or coalesce(current_setting('request.jwt.claims',true),'')='')) then
    if tg_op='DELETE' then return old; end if; return new;
  end if;
  v_uid:=private.get_current_user_id();
  select u.company_id into v_company from public.users u join public.companies c on c.id=u.company_id
    where u.id=v_uid and u.is_active and u.deleted_at is null and c.deleted_at is null;
  if v_company is null then raise exception 'Expense access denied' using errcode='42501'; end if;
  if tg_table_name='expense_batches' then
    if new.company_id is distinct from v_company or (tg_op='UPDATE' and
      row(new.company_id,new.submitted_by) is distinct from row(old.company_id,old.submitted_by)) then
      raise exception 'Expense batch identity cannot change' using errcode='42501';
    end if;
    if ((tg_op='INSERT' and (new.paid_at is not null or new.paid_by is not null)) or
        (tg_op='UPDATE' and row(new.paid_at,new.paid_by) is distinct from row(old.paid_at,old.paid_by)))
      and not public.has_permission(v_uid,'expenses.approve','all') then
      raise exception 'An approver must record or undo reimbursement' using errcode='42501';
    end if;
  else
    if tg_table_name='expenses' then
      v_exp:=old;
    else
      if tg_op='UPDATE' and new.expense_id is distinct from old.expense_id then
        raise exception 'Expense allocation cannot move between receipts' using errcode='42501';
      end if;
      v_id:=case when tg_op='DELETE' then old.expense_id else new.expense_id end;
      select * into v_exp from public.expenses where id=v_id for update;
      if not found then
        if tg_op='DELETE' then return old; end if;
        raise exception 'Expense unavailable' using errcode='42501';
      end if;
    end if;
    if v_exp.company_id is distinct from v_company or
      (v_exp.status in ('approved','reimbursed') and not public.has_permission(v_uid,'expenses.approve','all')
       and not (tg_table_name='expense_project_allocations' and v_exp.status='approved'
         and v_exp.submitted_by=v_uid and v_exp.amount>0 and exists(select 1 from public.expense_settings s
           where s.company_id=v_company and s.auto_approve_threshold>v_exp.amount))) then
      raise exception 'An approver must correct approved expense accounting' using errcode='42501';
    end if;
    if tg_table_name='expense_project_allocations' and not (
      public.has_permission(v_uid,'expenses.edit','all') or
      (v_exp.submitted_by=v_uid and public.has_permission(v_uid,'expenses.edit','own')) or
      public.has_permission(v_uid,'expenses.approve','all')) then
      raise exception 'Expense allocation access denied' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $function$
;

CREATE OR REPLACE FUNCTION private.enforce_expense_recurring_line_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_role='service_role' or (v_role is null and (session_user='postgres'
    or coalesce(current_setting('request.jwt.claims',true),'')='')) then
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
end $function$
;

revoke all on function private.enforce_expense_accounting_authority(),
  private.enforce_expense_accounting_related_authority(),
  private.enforce_expense_recurring_line_authority()
  from public, anon, authenticated, service_role;

do $expense_authority_closure_postcondition$
begin
  if exists (
    select 1
    from (values
      ('private.enforce_expense_accounting_authority()', '78a83536fed8e07cd68f2ab06fc9b9c6'),
      ('private.enforce_expense_accounting_related_authority()', '3877ccc6e2eeaf301a8c034c5f5ec39d'),
      ('private.enforce_expense_recurring_line_authority()', 'dd60236cf95314a46902076b130e3aec')
    ) as expected(signature, repaired_md5)
    where pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(expected.signature)))
      is distinct from expected.repaired_md5
       or pg_catalog.has_function_privilege('anon', expected.signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', expected.signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', expected.signature, 'EXECUTE')
  ) then
    raise exception 'Expense authority closure repair did not install exactly';
  end if;
end;
$expense_authority_closure_postcondition$;

commit;
