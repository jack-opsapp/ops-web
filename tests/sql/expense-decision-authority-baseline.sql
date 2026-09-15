\set ON_ERROR_STOP on
-- Synthetic disposable PostgreSQL 17 fixture. Never apply to an OPS database.
-- Relevant function bodies below are exact read-only production snapshots from
-- 2026-09-11, including downstream authorization and expense-placement triggers.
-- All live expense/batch revision triggers are included for lock-order fidelity.
create schema auth;
create schema private;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create table public.companies (
 id uuid primary key, deleted_at timestamptz, account_holder_id text, admin_ids text[]
);
create table public.users (
 id uuid primary key, company_id uuid, auth_id text, firebase_uid text,
 is_active boolean default true, is_company_admin boolean default false, deleted_at timestamptz
);
create table public.expense_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  batch_number text,
  period_start date,
  period_end date,
  status text,
  submitted_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  total_amount numeric,
  approved_amount numeric,
  created_at timestamptz default now(),
  parent_batch_id uuid,
  amendment_number int4,
  review_notes text,
  scope_project_id uuid,
  paid_at timestamptz,
  paid_by uuid
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  submitted_by uuid,
  status text,
  category_id uuid,
  merchant_name text,
  description text,
  amount numeric,
  tax_amount numeric,
  currency text,
  expense_date date,
  payment_method text,
  receipt_image_url text,
  receipt_thumbnail_url text,
  ocr_raw_data jsonb,
  ocr_confidence float4,
  batch_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  accounting_sync_status text,
  accounting_sync_id text,
  accounting_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  flag_comment text,
  flagged_by uuid,
  flagged_at timestamptz,
  receipt_missing_reason text,
  receipt_missing_note text,
  project_missing_reason text,
  project_missing_note text
);
create table public.expense_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  review_frequency text,
  auto_approve_threshold numeric,
  admin_approval_threshold numeric,
  require_receipt_photo bool,
  require_project_assignment bool,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  forecast_low_water_threshold numeric,
  forecast_current_balance numeric,
  forecast_balance_updated_at timestamptz,
  auto_submit_grace_days int4,
  forecast_obligations_confirmed_through date,
  forecast_obligations_confirmed_at timestamptz
);
create table public.expense_project_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid,
  project_id text,
  percentage numeric,
  amount numeric
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  company_id text,
  type text,
  title text,
  body text,
  project_id text,
  note_id text,
  is_read bool,
  created_at timestamptz default now(),
  expense_id text,
  batch_id text,
  deep_link_type text,
  persistent bool,
  action_url text,
  action_label text,
  dedupe_key text,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_reason text,
  incident_version int8
);
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text,
  hierarchy int4,
  created_at timestamptz default now(),
  description text,
  is_preset bool,
  company_id uuid,
  updated_at timestamptz default now()
);
create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid,
  permission text,
  scope text,
  created_at timestamptz default now()
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  role_id uuid,
  created_at timestamptz default now()
);
create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  company_id uuid,
  permission text,
  scope text,
  granted bool,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.expenses add foreign key (batch_id) references public.expense_batches(id);
create unique index on public.notifications(dedupe_key);

CREATE OR REPLACE FUNCTION private.get_current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id FROM public.users
  WHERE (auth_id = (auth.jwt() ->> 'sub') OR firebase_uid = (auth.jwt() ->> 'sub'))
    AND deleted_at IS NULL
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION private.get_user_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT company_id FROM public.users
  WHERE (auth_id = (auth.jwt() ->> 'sub') OR firebase_uid = (auth.jwt() ->> 'sub'))
    AND company_id IS NOT NULL
    AND deleted_at IS NULL
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION private.current_user_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    LEFT JOIN public.companies c ON c.id = u.company_id
    WHERE (u.auth_id = (auth.jwt() ->> 'sub') OR u.firebase_uid = (auth.jwt() ->> 'sub'))
      AND u.deleted_at IS NULL
      AND (
        COALESCE(u.is_company_admin, false)
        OR u.id::text = c.account_holder_id
        OR u.id::text = ANY(COALESCE(c.admin_ids, ARRAY[]::text[]))
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.user_is_company_admin(p_actor_user_id uuid, p_actor_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
      and (
        coalesce(actor.is_company_admin, false)
        or actor.id::text = company.account_holder_id
        or actor.id::text = any(
          coalesce(company.admin_ids, array[]::text[])
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.raw_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_override_granted boolean;
  v_override_scope text;
  v_scope text;
begin
  if p_actor_user_id is null
     or p_actor_company_id is null
     or nullif(btrim(p_permission), '') is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return null;
  end if;

  select override.granted, override.scope
  into v_override_granted, v_override_scope
  from public.user_permission_overrides override
  where override.user_id = p_actor_user_id
    and override.company_id = p_actor_company_id
    and override.permission = p_permission
  limit 1;

  if found then
    if not v_override_granted then
      return null;
    end if;
    if v_override_scope is not null then
      if v_override_scope in ('all', 'assigned', 'own') then
        return v_override_scope;
      end if;
      return null;
    end if;
  end if;

  select permission.scope
  into v_scope
  from public.user_roles assignment
  join public.roles role
    on role.id = assignment.role_id
   and (role.is_preset or role.company_id = p_actor_company_id)
  join public.role_permissions permission
    on permission.role_id = assignment.role_id
   and permission.permission = p_permission
   and permission.scope in ('all', 'assigned', 'own')
  where assignment.user_id = p_actor_user_id::text
  order by case permission.scope
    when 'all' then 1
    when 'assigned' then 2
    when 'own' then 3
    else 4
  end
  limit 1;

  return v_scope;
end;
$function$;

CREATE OR REPLACE FUNCTION private.effective_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_permission in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  ) then
    return private.effective_pipeline_scope_for_user(
      p_actor_user_id,
      p_actor_company_id,
      p_permission
    );
  end if;

  if p_permission in ('inbox.view', 'inbox.send') then
    return private.effective_inbox_scope_for_user(
      p_actor_user_id,
      p_actor_company_id,
      p_permission
    );
  end if;

  return private.raw_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    p_permission
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.current_user_scope_for(p_permission text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select private.effective_permission_scope_for_user(
    private.get_current_user_id(),
    private.get_user_company_id(),
    p_permission
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission text, p_required_scope text DEFAULT 'all'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_company_id uuid;
  v_scope text;
begin
  if p_user_id is null or p_permission is null then
    return false;
  end if;

  select actor.company_id
  into v_company_id
  from public.users actor
  join public.companies company
    on company.id = actor.company_id
   and company.deleted_at is null
  where actor.id = p_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);

  if not found then
    return false;
  end if;

  if private.user_is_company_admin(p_user_id, v_company_id) then
    return true;
  end if;

  v_scope := private.raw_permission_scope_for_user(
    p_user_id,
    v_company_id,
    p_permission
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned' then
    return p_required_scope in ('assigned', 'own');
  end if;
  if v_scope = 'own' then
    return p_required_scope = 'own';
  end if;
  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_expense_batch_total(p_batch_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION public.expense_envelope_period(p_expense_date date, p_review_frequency text)
 RETURNS TABLE(period_start date, period_end date)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    case coalesce(p_review_frequency,'monthly')
      when 'per_job'   then p_expense_date
      when 'weekly'    then date_trunc('week', p_expense_date)::date            -- Postgres week starts Monday
      when 'biweekly'  then case when extract(day from p_expense_date) <= 14
                                 then date_trunc('month', p_expense_date)::date
                                 else (date_trunc('month', p_expense_date) + interval '14 days')::date end
      when 'quarterly' then date_trunc('quarter', p_expense_date)::date
      else date_trunc('month', p_expense_date)::date                            -- monthly + unknown
    end as period_start,
    case coalesce(p_review_frequency,'monthly')
      when 'per_job'   then p_expense_date
      when 'weekly'    then (date_trunc('week', p_expense_date) + interval '6 days')::date
      when 'biweekly'  then case when extract(day from p_expense_date) <= 14
                                 then (date_trunc('month', p_expense_date) + interval '13 days')::date
                                 else (date_trunc('month', p_expense_date) + interval '1 month - 1 day')::date end
      when 'quarterly' then (date_trunc('quarter', p_expense_date) + interval '3 months - 1 day')::date
      else (date_trunc('month', p_expense_date) + interval '1 month - 1 day')::date
    end as period_end;
$function$;

CREATE OR REPLACE FUNCTION public.get_next_expense_batch_number(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    next_num int;
    result   text;
begin
    select coalesce(max(
        cast(replace(batch_number, 'EXP-BATCH-', '') as int)
    ), 0) + 1
    into next_num
    from expense_batches
    where company_id = p_company_id
      and batch_number ~ '^EXP-BATCH-[0-9]+$';

    result := 'EXP-BATCH-' || lpad(next_num::text, 4, '0');
    return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_open_batch(p_company_id uuid, p_submitted_by uuid, p_period_start date, p_period_end date, p_scope_project_id uuid DEFAULT NULL::uuid)
 RETURNS expense_batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_batch public.expense_batches;
begin
  if p_company_id is null or p_submitted_by is null then
    raise exception 'get_or_create_open_batch: company_id and submitted_by are required';
  end if;

  -- Match a not-yet-approved envelope (filling OR already-sent) for the scope.
  select * into v_batch
  from public.expense_batches
  where company_id = p_company_id
    and submitted_by = p_submitted_by
    and status in ('open','pending_review')
    and amendment_number = 0
    and coalesce(period_start,     '1970-01-01'::date) = coalesce(p_period_start,     '1970-01-01'::date)
    and coalesce(period_end,       '1970-01-01'::date) = coalesce(p_period_end,       '1970-01-01'::date)
    and coalesce(scope_project_id, '00000000-0000-0000-0000-000000000000'::uuid) =
        coalesce(p_scope_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by created_at desc
  limit 1;

  if v_batch.id is not null then
    return v_batch;
  end if;

  begin
    insert into public.expense_batches (
      company_id, batch_number, period_start, period_end,
      status, submitted_by, total_amount, amendment_number, scope_project_id
    ) values (
      p_company_id, public.get_next_expense_batch_number(p_company_id),
      p_period_start, p_period_end, 'open', p_submitted_by, 0, 0, p_scope_project_id)
    returning * into v_batch;
  exception when unique_violation then
    select * into v_batch
    from public.expense_batches
    where company_id = p_company_id
      and submitted_by = p_submitted_by
      and status in ('open','pending_review')
      and amendment_number = 0
      and coalesce(period_start,     '1970-01-01'::date) = coalesce(p_period_start,     '1970-01-01'::date)
      and coalesce(period_end,       '1970-01-01'::date) = coalesce(p_period_end,       '1970-01-01'::date)
      and coalesce(scope_project_id, '00000000-0000-0000-0000-000000000000'::uuid) =
          coalesce(p_scope_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
    order by created_at desc
    limit 1;
  end;

  return v_batch;
end;
$function$;

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

CREATE OR REPLACE FUNCTION private.enforce_expense_edit_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid;
  v_is_admin boolean;
begin
  -- Trusted backend context (no API JWT) -> skip; only authenticated app
  -- requests are subject to the uploader-only rule.
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then
    return new;
  end if;

  v_uid := private.get_current_user_id();
  v_is_admin := private.current_user_is_admin();

  -- Content edits -> submitter only.
  if ( new.merchant_name         is distinct from old.merchant_name
    or new.description           is distinct from old.description
    or new.amount                is distinct from old.amount
    or new.tax_amount            is distinct from old.tax_amount
    or new.currency              is distinct from old.currency
    or new.expense_date          is distinct from old.expense_date
    or new.payment_method        is distinct from old.payment_method
    or new.category_id           is distinct from old.category_id
    or new.receipt_image_url     is distinct from old.receipt_image_url
    or new.receipt_thumbnail_url is distinct from old.receipt_thumbnail_url
    or new.ocr_raw_data          is distinct from old.ocr_raw_data
    or new.ocr_confidence        is distinct from old.ocr_confidence )
  then
    if v_uid is null or v_uid <> old.submitted_by then
      raise exception 'Only the expense submitter may edit its details'
        using errcode = '42501';
    end if;
  end if;

  -- Soft delete (setting deleted_at) -> submitter or company admin.
  if new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null then
    if not (v_is_admin or (v_uid is not null and v_uid = old.submitted_by)) then
      raise exception 'Only the submitter or a company admin may delete this expense'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;
CREATE TRIGGER trg_enforce_expense_edit_authority BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_edit_authority();

CREATE OR REPLACE FUNCTION public.tg_place_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if NEW.deleted_at is null and NEW.status <> 'draft' and NEW.batch_id is null then
    perform public.place_expense(NEW.id);
  end if;
  return NEW;
end;
$function$;
CREATE TRIGGER trg_place_expense AFTER INSERT OR UPDATE OF status, expense_date, batch_id ON public.expenses FOR EACH ROW EXECUTE FUNCTION tg_place_expense();

CREATE OR REPLACE FUNCTION private.set_expense_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
CREATE TRIGGER trg_set_expense_updated_at BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.set_expense_updated_at();

CREATE OR REPLACE FUNCTION public.approve_expense_batch(p_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := private.get_current_user_id(); v_batch public.expense_batches;
begin
  if v_uid is null or not public.has_permission(v_uid,'expenses.approve','all') then
    raise exception 'approve_expense_batch: caller lacks expenses.approve';
  end if;
  select * into v_batch from public.expense_batches where id = p_batch_id;
  if v_batch.id is null then raise exception 'approve_expense_batch: batch % not found', p_batch_id; end if;
  update public.expenses set status='approved', updated_at=now()
   where batch_id = p_batch_id and deleted_at is null and status not in ('rejected','approved','reimbursed');
  update public.expense_batches set status='approved', reviewed_by=v_uid, reviewed_at=now() where id = p_batch_id;
  perform public.recalculate_expense_batch_total(p_batch_id);
end; $function$;

CREATE OR REPLACE FUNCTION public.early_clear_expense_line(p_expense_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := private.get_current_user_id(); v_exp public.expenses;
begin
  if v_uid is null or not public.has_permission(v_uid,'expenses.approve','all') then
    raise exception 'early_clear_expense_line: caller lacks expenses.approve';
  end if;
  select * into v_exp from public.expenses where id = p_expense_id;
  if v_exp.id is null then raise exception 'early_clear_expense_line: expense % not found', p_expense_id; end if;
  update public.expenses set status='approved', updated_at=now() where id = p_expense_id;
  if v_exp.batch_id is not null then perform public.recalculate_expense_batch_total(v_exp.batch_id); end if;
  insert into public.notifications(user_id, company_id, type, title, body, expense_id, deep_link_type, action_url, action_label, dedupe_key)
  values (v_exp.submitted_by::text, v_exp.company_id::text, 'expense_approved', 'Expense approved',
          coalesce(v_exp.merchant_name,'Expense') || ' (' || to_char(v_exp.amount,'FM999G999G990D00') || ') was cleared',
          v_exp.id::text, 'expense', '/accounting?tab=expenses', 'VIEW', 'expense_cleared:' || v_exp.id)
  on conflict do nothing;
end; $function$;

CREATE OR REPLACE FUNCTION public.mark_expense_batch_paid(p_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public.unmark_expense_batch_paid(p_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

-- Exact effective public RPC grants observed in production on 2026-09-11.
grant execute on function public.approve_expense_batch(uuid) to public, anon, authenticated, service_role;
grant execute on function public.early_clear_expense_line(uuid) to public, anon, authenticated, service_role;
grant execute on function public.mark_expense_batch_paid(uuid) to public, anon, authenticated, service_role;
grant execute on function public.unmark_expense_batch_paid(uuid) to public, anon, authenticated, service_role;

-- Real revision-trigger lock graph, including company seeding and UPSERT locks.
create table private.agent_read_domains(domain text primary key);
insert into private.agent_read_domains values ('artifacts'),('expenses'),('payroll_readiness');
create table private.agent_read_domain_revisions (
  company_id uuid not null,
  domain text not null references private.agent_read_domains(domain),
  source_revision bigint not null default 0 check(source_revision between 0 and 9007199254740991),
  updated_at timestamptz not null default statement_timestamp(),
  primary key(company_id,domain)
);

CREATE OR REPLACE FUNCTION private.agent_read_domain_uuid_from_text(p_value text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then lower(p_value)::uuid
  end;
$function$;

CREATE OR REPLACE FUNCTION private.advance_agent_read_domain_revisions(p_company_ids uuid[], p_domain text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
declare
  v_expected_count integer;
  v_advanced_count integer;
begin
  if p_domain is null or not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = p_domain
  ) then
    raise exception 'agent_read_domain_revision_invalid_domain'
      using errcode = '22023';
  end if;

  select count(*)::integer
    into v_expected_count
  from (
    select distinct company_id
    from unnest(coalesce(p_company_ids, array[]::uuid[])) company_id
    where company_id is not null
  ) distinct_companies;

  if v_expected_count = 0 then
    return;
  end if;

  -- One ordered statement gives cross-tenant moves a consistent lock order.
  insert into private.agent_read_domain_revisions as revision (
    company_id,
    domain,
    source_revision,
    updated_at
  )
  select
    distinct_companies.company_id,
    p_domain,
    1,
    statement_timestamp()
  from (
    select distinct company_id
    from unnest(p_company_ids) company_id
    where company_id is not null
    order by company_id
  ) distinct_companies
  on conflict (company_id, domain) do update
  set source_revision = revision.source_revision + 1,
      updated_at = excluded.updated_at
  where revision.source_revision < 9007199254740991;

  get diagnostics v_advanced_count = row_count;
  if v_advanced_count is distinct from v_expected_count then
    raise exception 'agent_read_domain_revision_exhausted'
      using errcode = '22003';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.seed_agent_read_domain_revisions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
begin
  insert into private.agent_read_domain_revisions (
    company_id,
    domain,
    source_revision,
    updated_at
  )
  select
    new.id,
    domain.domain,
    0,
    statement_timestamp()
  from private.agent_read_domains domain
  on conflict (company_id, domain) do nothing;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.bump_agent_read_domain_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_nargs is distinct from 2
     or nullif(tg_argv[0], '') is null
     or nullif(tg_argv[1], '') is null
     or tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_read_domain_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := to_jsonb(old);
    if not (v_old_row ? tg_argv[1]) then
      raise exception 'agent_read_domain_revision_trigger_misconfigured'
        using errcode = '55000';
    end if;
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> tg_argv[1]
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := to_jsonb(new);
    if not (v_new_row ? tg_argv[1]) then
      raise exception 'agent_read_domain_revision_trigger_misconfigured'
        using errcode = '55000';
    end if;
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> tg_argv[1]
    );
  end if;

  perform private.advance_agent_read_domain_revisions(
    array[v_old_company_id, v_new_company_id],
    tg_argv[0]
  );

  -- AFTER row-trigger return values are ignored. NULL avoids polymorphic
  -- record coercion and makes that behavior explicit.
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.bump_agent_expense_source_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_relevant_fields text[];
  v_relevant_change boolean := true;
  v_company_ids uuid[] := array[]::uuid[];
  v_old_company_id uuid;
  v_new_company_id uuid;
  v_parent_company_id uuid;
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_nargs is distinct from 0
     or tg_table_schema is distinct from 'public'
     or tg_table_name not in (
       'expenses',
       'expense_project_allocations',
       'expense_categories',
       'expense_batches',
       'users',
       'projects',
       'project_tasks'
     )
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_expense_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := pg_catalog.to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := pg_catalog.to_jsonb(new);
  end if;

  v_relevant_fields := case tg_table_name
    when 'expenses' then array[
      'id', 'company_id', 'submitted_by', 'status', 'category_id',
      'merchant_name', 'amount', 'tax_amount', 'currency', 'expense_date',
      'batch_id', 'rejection_reason', 'flag_comment', 'flagged_at',
      'updated_at', 'deleted_at'
    ]
    when 'expense_project_allocations' then array[
      'id', 'expense_id', 'project_id', 'percentage', 'amount'
    ]
    when 'expense_categories' then array[
      'id', 'company_id', 'name'
    ]
    when 'expense_batches' then array[
      'id', 'company_id', 'batch_number', 'period_start', 'period_end',
      'status', 'submitted_by', 'total_amount', 'approved_amount',
      'paid_at'
    ]
    when 'users' then array[
      'id', 'company_id', 'first_name', 'last_name'
    ]
    when 'projects' then array[
      'id', 'company_id', 'deleted_at'
    ]
    else array[
      'id', 'company_id', 'project_id', 'team_member_ids', 'deleted_at'
    ]
  end;

  if tg_op = 'UPDATE' then
    select coalesce(pg_catalog.bool_or(
             v_old_row -> field.value is distinct from
               v_new_row -> field.value
           ), false)
      into v_relevant_change
    from pg_catalog.unnest(v_relevant_fields) field(value);
  end if;

  if not v_relevant_change then
    return null;
  end if;

  if tg_table_name = 'expense_project_allocations' then
    for v_parent_company_id in
      select distinct expense.company_id
      from public.expenses expense
      where expense.id in (
        private.agent_read_domain_uuid_from_text(v_old_row ->> 'expense_id'),
        private.agent_read_domain_uuid_from_text(v_new_row ->> 'expense_id')
      )
        and expense.company_id is not null
    loop
      v_company_ids := pg_catalog.array_append(
        v_company_ids,
        v_parent_company_id
      );
    end loop;
  else
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> 'company_id'
    );
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> 'company_id'
    );
    v_company_ids := array[v_old_company_id, v_new_company_id];
  end if;

  perform private.advance_agent_read_domain_revisions(
    v_company_ids,
    'expenses'
  );
  return null;
end;
$function$;
create trigger companies_seed_agent_read_domain_revisions after insert on public.companies
for each row execute function private.seed_agent_read_domain_revisions();
CREATE TRIGGER expense_batches_agent_payroll_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision('payroll_readiness', 'company_id');
CREATE TRIGGER expense_batches_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision();
CREATE TRIGGER expenses_agent_payroll_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision('payroll_readiness', 'company_id');
CREATE TRIGGER expenses_bump_agent_artifact_revision AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision('artifacts', 'company_id');
CREATE TRIGGER expenses_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision();
