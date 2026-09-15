-- Keep the shipped void(uuid) decision APIs and existing approval/payout effects.
-- has_permission validates the actor's own company, not the target company.
-- Recalculation already rejects ordinary foreign approvals; payout has no such
-- dependency, and an id-only expense batch FK permits mixed-company children.
begin;

create or replace function private.lock_expense_approver_context()
returns table(actor_id uuid, company_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.get_current_user_id();
  v_company_id uuid;
begin
  -- Hold membership and company state stable until the decision commits.
  select actor.company_id into v_company_id
  from public.users actor
  join public.companies company on company.id = actor.company_id
  where actor.id = v_actor_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
    and company.deleted_at is null
  for share of actor, company;

  -- The row lock may have waited behind a login-identity or membership edit.
  -- Re-resolve this request's JWT after the wait before trusting the captured
  -- actor. The held actor/company locks keep this verified binding stable.
  if not found
     or v_actor_id is distinct from private.get_current_user_id()
     or v_company_id is distinct from private.get_user_company_id()
     or not public.has_permission(v_actor_id, 'expenses.approve', 'all') then
    raise exception 'You do not have permission to approve expenses.' using errcode = '42501';
  end if;
  return query select v_actor_id, v_company_id;
end;
$function$;

create or replace function private.lock_expense_batch_for_approval(p_batch_id uuid, p_company_id uuid)
returns public.expense_batches
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch public.expense_batches;
begin
  select batch.* into v_batch
  from public.expense_batches batch
  where batch.id = p_batch_id and batch.company_id = p_company_id
  for update nowait;
  if not found then
    raise exception 'This expense batch is not available.' using errcode = '42501';
  end if;
  -- Exclude new FK references and hold existing child membership stable.
  -- Child-first writers must never wait behind a blocking parent/child cycle.
  perform expense.id from public.expenses expense
  where expense.batch_id = p_batch_id order by expense.id
  for update nowait;
  if exists (
    select 1 from public.expenses expense
    where expense.batch_id = p_batch_id
      and expense.company_id is distinct from p_company_id
  ) then
    raise exception 'This expense batch contains expenses from another company.' using errcode = '42501';
  end if;
  return v_batch;
end;
$function$;

create or replace function private.execute_expense_decision(p_action text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '25ms'
as $function$
declare
  v_uid uuid;
  v_company_id uuid;
  v_lock_company_id uuid;
  v_batch_id uuid;
  v_batch public.expense_batches;
  v_exp public.expenses;
  v_attempt integer;
begin
  if p_action is null or p_action not in ('approve', 'early_clear', 'pay', 'unpay') then
    raise exception 'Unsupported expense decision' using errcode = '22023';
  end if;
  for v_attempt in 1..10 loop
    begin
      v_uid := private.get_current_user_id();
      v_lock_company_id := private.get_user_company_id();
      if v_uid is null or v_lock_company_id is null
         or not public.has_permission(v_uid, 'expenses.approve', 'all') then
        raise exception 'You do not have permission to approve expenses.' using errcode = '42501';
      end if;
      -- Same namespace and ordering as the deployed save_expense_atomic path.
      -- No actor, expense, batch, or revision row lock is held before this lock.
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('save_expense_atomic:' || v_lock_company_id::text, 0)
      );
      select context.actor_id, context.company_id into v_uid, v_company_id
      from private.lock_expense_approver_context() context;
      if v_company_id is distinct from v_lock_company_id then
        raise exception 'Expense company changed during authorization' using errcode = '40001';
      end if;

      if p_action = 'early_clear' then
        -- Discover the parent before taking an expense lock, then reread the
        -- locked row. A concurrent move restarts with its new company/parent.
        select expense.batch_id into v_batch_id from public.expenses expense
        where expense.id = p_target_id and expense.company_id = v_company_id;
        if not found then
          raise exception 'This expense is not available.' using errcode = '42501';
        end if;
        if v_batch_id is not null then
          perform private.lock_expense_batch_for_approval(v_batch_id, v_company_id);
        end if;
        select expense.* into v_exp from public.expenses expense
        where expense.id = p_target_id and expense.company_id = v_company_id
        for update nowait;
        if not found then
          raise exception 'This expense is not available.' using errcode = '42501';
        end if;
        if v_exp.batch_id is distinct from v_batch_id then
          raise exception 'This expense changed. Try again.' using errcode = '40001';
        end if;
        update public.expenses set status = 'approved', updated_at = now()
        where id = p_target_id and company_id = v_company_id;
        if v_exp.batch_id is not null then
          perform public.recalculate_expense_batch_total(v_exp.batch_id);
        end if;
        insert into public.notifications(user_id, company_id, type, title, body, expense_id, deep_link_type, action_url, action_label, dedupe_key)
        values (v_exp.submitted_by::text, v_exp.company_id::text, 'expense_approved', 'Expense approved',
          coalesce(v_exp.merchant_name, 'Expense') || ' (' || to_char(v_exp.amount, 'FM999G999G990D00') || ') was cleared',
          v_exp.id::text, 'expense', '/accounting?tab=expenses', 'VIEW', 'expense_cleared:' || v_exp.id)
        on conflict do nothing;
      else
        v_batch := private.lock_expense_batch_for_approval(p_target_id, v_company_id);
        if p_action = 'approve' then
          update public.expenses set status = 'approved', updated_at = now()
          where batch_id = p_target_id and company_id = v_company_id
            and deleted_at is null and status not in ('rejected', 'approved', 'reimbursed');
          update public.expense_batches set status = 'approved', reviewed_by = v_uid, reviewed_at = now()
          where id = p_target_id and company_id = v_company_id;
          perform public.recalculate_expense_batch_total(p_target_id);
        elsif p_action = 'pay' then
          if v_batch.status not in ('approved', 'partially_approved', 'auto_approved') then
            raise exception 'mark_expense_batch_paid: batch % is %, only approved envelopes can be paid out', p_target_id, v_batch.status;
          end if;
          if v_batch.paid_at is not null then
            raise exception 'mark_expense_batch_paid: batch % is already paid out', p_target_id;
          end if;
          update public.expenses set status = 'reimbursed', updated_at = now()
          where batch_id = p_target_id and company_id = v_company_id
            and deleted_at is null and status = 'approved';
          update public.expense_batches set paid_at = now(), paid_by = v_uid
          where id = p_target_id and company_id = v_company_id;
        else
          if v_batch.paid_at is null then
            raise exception 'unmark_expense_batch_paid: batch % is not paid out', p_target_id;
          end if;
          update public.expenses set status = 'approved', updated_at = now()
          where batch_id = p_target_id and company_id = v_company_id
            and deleted_at is null and status = 'reimbursed';
          update public.expense_batches set paid_at = null, paid_by = null
          where id = p_target_id and company_id = v_company_id;
        end if;
      end if;
      return;
    exception when lock_not_available or serialization_failure then
      -- Roll back the COMPLETE decision, including revision/placement triggers,
      -- notifications and advisory locks. Direct table writers do not take the
      -- save advisory lock and may hold a revision before seeking our parent.
      -- The function-local lock_timeout bounds those downstream waits too.
      null;
    end;
    -- Every attempt's locks and mutations are gone before this wait.
    if v_attempt < 10 then
      perform pg_catalog.pg_sleep(0.01 * v_attempt);
    end if;
  end loop;
  raise exception 'Expenses are being updated. Try again.' using errcode = '40001';
end;
$function$;

revoke all on function private.lock_expense_approver_context() from public, anon, authenticated, service_role;
revoke all on function private.lock_expense_batch_for_approval(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.execute_expense_decision(text, uuid) from public, anon, authenticated, service_role;

create or replace function public.approve_expense_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.execute_expense_decision('approve', p_batch_id);
end;
$function$;

create or replace function public.early_clear_expense_line(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.execute_expense_decision('early_clear', p_expense_id);
end;
$function$;

create or replace function public.mark_expense_batch_paid(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.execute_expense_decision('pay', p_batch_id);
end;
$function$;

create or replace function public.unmark_expense_batch_paid(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.execute_expense_decision('unpay', p_batch_id);
end;
$function$;

-- CREATE OR REPLACE preserves public RPC ACLs, including released anon lanes.
-- The private dispatcher's SET lock_timeout is restored automatically on return
-- or error, so the caller's remaining statements retain their original setting.
commit;
