-- Expense batch paid-out lifecycle
--
-- Adds the "paid out" stage to expense envelopes: after office approval, the
-- operator records that the crew member has been settled up (reimbursed /
-- covered). Additive + iOS-cross-release safe:
--   * two nullable columns on expense_batches (shipped iOS decodes unknown
--     columns as absent),
--   * line status moves approved -> 'reimbursed', which shipped iOS already
--     renders as "paid" (FinancialEnums.ExpenseStatus.reimbursed, terminal).
--
-- Mirrors the approve_expense_batch permission pattern: SECURITY DEFINER,
-- caller from private.get_current_user_id(), gated on expenses.approve.

alter table public.expense_batches
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid;

comment on column public.expense_batches.paid_at is
  'When the operator recorded this envelope as paid out to the submitter. NULL = approved money not yet settled.';
comment on column public.expense_batches.paid_by is
  'User who recorded the payout (expenses.approve holder).';

create or replace function public.mark_expense_batch_paid(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := private.get_current_user_id();
  v_batch public.expense_batches;
begin
  if v_uid is null or not public.has_permission(v_uid, 'expenses.approve', 'all') then
    raise exception 'mark_expense_batch_paid: caller lacks expenses.approve';
  end if;

  select * into v_batch from public.expense_batches where id = p_batch_id for update;
  if v_batch.id is null then
    raise exception 'mark_expense_batch_paid: batch % not found', p_batch_id;
  end if;
  if v_batch.status not in ('approved', 'partially_approved', 'auto_approved') then
    raise exception 'mark_expense_batch_paid: batch % is %, only approved envelopes can be paid out', p_batch_id, v_batch.status;
  end if;
  if v_batch.paid_at is not null then
    raise exception 'mark_expense_batch_paid: batch % is already paid out', p_batch_id;
  end if;

  update public.expenses
     set status = 'reimbursed', updated_at = now()
   where batch_id = p_batch_id
     and deleted_at is null
     and status = 'approved';

  update public.expense_batches
     set paid_at = now(), paid_by = v_uid
   where id = p_batch_id;
end;
$function$;

create or replace function public.unmark_expense_batch_paid(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := private.get_current_user_id();
  v_batch public.expense_batches;
begin
  if v_uid is null or not public.has_permission(v_uid, 'expenses.approve', 'all') then
    raise exception 'unmark_expense_batch_paid: caller lacks expenses.approve';
  end if;

  select * into v_batch from public.expense_batches where id = p_batch_id for update;
  if v_batch.id is null then
    raise exception 'unmark_expense_batch_paid: batch % not found', p_batch_id;
  end if;
  if v_batch.paid_at is null then
    raise exception 'unmark_expense_batch_paid: batch % is not paid out', p_batch_id;
  end if;

  update public.expenses
     set status = 'approved', updated_at = now()
   where batch_id = p_batch_id
     and deleted_at is null
     and status = 'reimbursed';

  update public.expense_batches
     set paid_at = null, paid_by = null
   where id = p_batch_id;
end;
$function$;
