-- Fix the table alias used by the hardened expense-batch recalculation RPC.
--
-- The atomic-save migration qualified the selected columns with `b` but did
-- not declare that alias in the FROM clause. PostgreSQL compiles PL/pgSQL
-- bodies lazily, so the defect appeared only when live rollback verification
-- exercised expense placement. Replacing the function is additive and leaves
-- the authorization and locking contract unchanged.

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
    from public.expense_batches b
   where b.id = p_batch_id
   for update;

  if not found then
    return 0;
  end if;

  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );

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

  update public.expense_batches b
     set total_amount = v_total
   where b.id = p_batch_id;

  return v_total;
end;
$function$;

revoke execute on function public.recalculate_expense_batch_total(uuid)
  from public, anon;
grant execute on function public.recalculate_expense_batch_total(uuid)
  to authenticated, service_role;

comment on function public.recalculate_expense_batch_total(uuid) is
  'Recalculates one expense batch total under tenant, permission, and final-status authorization checks.';
