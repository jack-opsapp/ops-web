-- project_table_rows: resolve the financial-column gate through the
-- current-user permission wrapper instead of the actor-parameterised primitive.
--
-- 20260807204914 (agent_control_plane_actor_authority) deliberately made
-- public.has_permission(uuid, text, text) executable by postgres and
-- service_role only, and introduced private.current_user_has_permission_scoped
-- (text, text) as the client-safe form. This view is security_invoker, so its
-- `perm` CTE evaluates as the calling API role: every browser SELECT that
-- touches a financial column has failed with 42501 "permission denied for
-- function has_permission" since that hardening reached production. The
-- Projects table (bug 0ed95e91) renders "Couldn't load projects" on every load.
--
-- Only the `perm` CTE changes. Column list, joins, filters and the
-- security_invoker option are restated verbatim so existing grants carry over.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
begin
  -- Refuse to run against a view that drifted from the reviewed definition.
  if md5(pg_get_viewdef('public.project_table_rows'::regclass, true))
     <> '58b6ee38bdce6132713e7edcc0176edb' then
    raise exception 'PROJECT_TABLE_ROWS_DEFINITION_DRIFT';
  end if;
  -- The wrapper must exist and be executable by the API roles the view runs as.
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'current_user_has_permission_scoped'
      and pg_get_function_identity_arguments(p.oid) = 'p_permission text, p_required_scope text'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception 'PROJECT_TABLE_ROWS_PERMISSION_WRAPPER_MISSING';
  end if;
end $$;

create or replace view public.project_table_rows
with (security_invoker = true) as
 WITH perm AS (
         SELECT private.current_user_has_permission_scoped('projects.view_financials'::text, 'all'::text) AS can_view_financials
        )
 SELECT p.id,
    p.company_id,
    p.title,
    p.status,
    p.client_id,
    c.name AS client_name,
    c.email AS client_email,
    c.phone_number AS client_phone,
    p.address,
    p.trade,
    p.start_date,
    p.end_date,
    p.completed_at,
    p.duration,
    p.created_at,
    p.updated_at,
    p.notes,
    p.team_member_ids,
    ( SELECT count(*) AS count
           FROM project_tasks t
          WHERE t.project_id = p.id AND (t.status = ANY (ARRAY['active'::text, 'completed'::text])) AND t.deleted_at IS NULL) AS task_count,
    ( SELECT count(*) AS count
           FROM project_tasks t
          WHERE t.project_id = p.id AND t.status = 'completed'::text AND t.deleted_at IS NULL) AS task_completed_count,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM project_tasks t
              WHERE t.project_id = p.id AND (t.status = ANY (ARRAY['active'::text, 'completed'::text])) AND t.deleted_at IS NULL)) = 0 THEN 0::numeric
            ELSE (( SELECT count(*)::numeric AS count
               FROM project_tasks t
              WHERE t.project_id = p.id AND t.status = 'completed'::text AND t.deleted_at IS NULL)) / (( SELECT count(*) AS count
               FROM project_tasks t
              WHERE t.project_id = p.id AND (t.status = ANY (ARRAY['active'::text, 'completed'::text])) AND t.deleted_at IS NULL))::numeric
        END AS progress,
    ( SELECT COALESCE(t.custom_title, tt.display, 'Task'::text) AS "coalesce"
           FROM project_tasks t
             LEFT JOIN task_types tt ON tt.id = t.task_type_id
          WHERE t.project_id = p.id AND t.status = 'active'::text AND t.deleted_at IS NULL
          ORDER BY t.start_date, t.display_order, t.id
         LIMIT 1) AS next_task,
    EXTRACT(day FROM now() - COALESCE(( SELECT max(pn.created_at) AS max
           FROM project_notes pn
          WHERE pn.project_id = p.id::text AND pn.event_kind = 'status_change'::text), p.created_at))::integer AS days_in_status,
        CASE
            WHEN perm.can_view_financials THEN ( SELECT COALESCE(sum(e.total), 0::numeric) AS "coalesce"
               FROM estimates e
              WHERE e.project_id = p.id::text AND (e.status = ANY (ARRAY['approved'::text, 'converted'::text])) AND e.deleted_at IS NULL)
            ELSE NULL::numeric
        END AS estimate_total,
        CASE
            WHEN perm.can_view_financials THEN ( SELECT COALESCE(sum(i.total), 0::numeric) AS "coalesce"
               FROM invoices i
              WHERE i.project_id = p.id AND i.deleted_at IS NULL)
            ELSE NULL::numeric
        END AS invoice_total,
        CASE
            WHEN perm.can_view_financials THEN ( SELECT COALESCE(sum(i.amount_paid), 0::numeric) AS "coalesce"
               FROM invoices i
              WHERE i.project_id = p.id AND i.deleted_at IS NULL)
            ELSE NULL::numeric
        END AS paid_total,
        CASE
            WHEN perm.can_view_financials THEN GREATEST(COALESCE(( SELECT sum(e.total) AS sum
               FROM estimates e
              WHERE e.project_id = p.id::text AND (e.status = ANY (ARRAY['approved'::text, 'converted'::text])) AND e.deleted_at IS NULL), 0::numeric), COALESCE(( SELECT sum(i.total) AS sum
               FROM invoices i
              WHERE i.project_id = p.id AND i.deleted_at IS NULL), 0::numeric))
            ELSE NULL::numeric
        END AS value,
        CASE
            WHEN perm.can_view_financials THEN ( SELECT COALESCE(sum(COALESCE(epa.amount, e.amount * epa.percentage / 100.0)), 0::numeric) AS "coalesce"
               FROM expense_project_allocations epa
                 JOIN expenses e ON e.id = epa.expense_id
              WHERE epa.project_id = p.id::text AND e.status = 'approved'::text AND e.deleted_at IS NULL)
            ELSE NULL::numeric
        END AS project_cost,
        CASE
            WHEN perm.can_view_financials THEN
            CASE
                WHEN (( SELECT COALESCE(sum(i.total), 0::numeric) AS "coalesce"
                   FROM invoices i
                  WHERE i.project_id = p.id AND i.deleted_at IS NULL)) = 0::numeric THEN NULL::numeric
                ELSE ((( SELECT COALESCE(sum(i.total), 0::numeric) AS "coalesce"
                   FROM invoices i
                  WHERE i.project_id = p.id AND i.deleted_at IS NULL)) - (( SELECT COALESCE(sum(COALESCE(epa.amount, e.amount * epa.percentage / 100.0)), 0::numeric) AS "coalesce"
                   FROM expense_project_allocations epa
                     JOIN expenses e ON e.id = epa.expense_id
                  WHERE epa.project_id = p.id::text AND e.status = 'approved'::text AND e.deleted_at IS NULL))) / NULLIF(( SELECT sum(i.total) AS sum
                   FROM invoices i
                  WHERE i.project_id = p.id AND i.deleted_at IS NULL), 0::numeric)
            END
            ELSE NULL::numeric
        END AS margin,
    ( SELECT count(*) AS count
           FROM project_photos pp
          WHERE pp.project_id = p.id::text AND pp.deleted_at IS NULL) AS photo_count
   FROM projects p
     LEFT JOIN clients c ON c.id = p.client_id
     CROSS JOIN perm
  WHERE p.deleted_at IS NULL;

do $$
begin
  -- The rewritten view must deparse to the reviewed target and must no longer
  -- call the service-only primitive directly.
  if md5(pg_get_viewdef('public.project_table_rows'::regclass, true))
     <> '622f1dc7eaa2fff686e19803ecd1ee9b' then
    raise exception 'PROJECT_TABLE_ROWS_REWRITE_MISMATCH';
  end if;
  if pg_get_viewdef('public.project_table_rows'::regclass, true) ~ '\mhas_permission\(' then
    raise exception 'PROJECT_TABLE_ROWS_STILL_CALLS_HAS_PERMISSION';
  end if;
end $$;

commit;
