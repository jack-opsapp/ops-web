-- ============================================================================
-- PERMISSION OVERRIDES ENGINE — BUG BURNDOWN W5 (2026-07-03)
-- Bugs: 2984e137 (URGENT, per-member permission exceptions)
--       18d0d6a3 (HIGH, Team tab reconstruction)
--
-- WHAT THIS DOES
--   1. Folds user_permission_overrides into the server permission truth:
--      public.has_permission() and private.current_user_scope_for() (and, by
--      composition, private.current_user_has_permission()) now honor per-user
--      overrides. Semantics match the shipped iOS PermissionService and the
--      web resolver (src/lib/permissions/resolve.ts):
--        granted=false               → permission DENIED (revokes role grant)
--        granted=true, scope <> null → that scope is authoritative (widen/narrow)
--        granted=true, scope IS null → inert, falls through to the role
--      Overrides only count when their company_id matches the user's current
--      company (stale rows from a previous company are ignored).
--   2. Adds company-scoped READ policies so the Team surface can actually
--      render: user_roles (roster role tags) and role_permissions (role
--      matrix for presets + own-company roles) become readable to same-company
--      members. Both tables keep their existing anon SELECT grants; writes
--      remain server-route-only (service role) — NO new write grants.
--   3. Extends the user_permission_overrides admin policies to holders of
--      team.assign_roles at scope 'all' (the bible's stated write contract).
--   4. Tightens public.roles write policies: previously ANY member could
--      insert/update/delete ANY company's custom roles (cross-tenant hole).
--      Now: non-preset + same-company + (admin OR team.assign_roles).
--
-- BLAST RADIUS (verified before writing):
--   * All 18 live override rows are granted=true grants that were previously
--     IGNORED server-side → this strictly widens access for their holders.
--     Zero granted=false rows exist, so nothing newly denies.
--   * roles tightening rejects only cross-tenant writes (illegitimate) and
--     non-admin/non-assign_roles writers (the UI already gates on
--     team.assign_roles; iOS custom-role creation was already broken by its
--     own missing company_id).
--   * SECURITY DEFINER functions read tables as owner → policies referencing
--     private.current_user_has_permission() cannot recurse.
-- ============================================================================

-- ─── 1a. public.has_permission — override-aware ────────────────────────────

CREATE OR REPLACE FUNCTION public.has_permission(
  p_user_id        uuid,
  p_permission     text,
  p_required_scope text DEFAULT 'all'::text
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin         boolean;
  v_scope            text;
  v_override_granted boolean;
  v_override_scope   text;
  v_override_found   boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_permission IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Admin / account-holder / company-admin bypass (unchanged).
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    LEFT JOIN public.companies c ON c.id = u.company_id
    WHERE u.id = p_user_id
      AND u.deleted_at IS NULL
      AND (
        COALESCE(u.is_company_admin, false)
        OR u.id::text = c.account_holder_id
        OR u.id::text = ANY(COALESCE(c.admin_ids, ARRAY[]::text[]))
      )
  ) INTO v_is_admin;

  IF v_is_admin THEN
    RETURN true;
  END IF;

  -- 2. Per-user override — authoritative when present. Only rows matching the
  --    user's CURRENT company count.
  SELECT upo.granted, upo.scope, true
  INTO v_override_granted, v_override_scope, v_override_found
  FROM public.user_permission_overrides upo
  JOIN public.users u ON u.id = upo.user_id
  WHERE upo.user_id = p_user_id
    AND upo.permission = p_permission
    AND u.deleted_at IS NULL
    AND upo.company_id = u.company_id
  LIMIT 1;

  IF v_override_found THEN
    IF NOT v_override_granted THEN
      RETURN false;                                   -- explicit revoke
    END IF;
    IF v_override_scope IS NOT NULL THEN              -- explicit grant at scope
      IF v_override_scope = 'all' THEN RETURN true; END IF;
      IF v_override_scope = 'assigned' THEN
        RETURN p_required_scope IN ('assigned', 'own');
      END IF;
      IF v_override_scope = 'own' THEN
        RETURN p_required_scope = 'own';
      END IF;
      RETURN false;
    END IF;
    -- granted=true with NULL scope: inert → fall through to the role.
  END IF;

  -- 3. Role-based scope lookup (unchanged; widest scope wins).
  SELECT rp.scope
  INTO v_scope
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = p_user_id::text
    AND rp.permission = p_permission
  ORDER BY CASE rp.scope
    WHEN 'all'      THEN 1
    WHEN 'assigned' THEN 2
    WHEN 'own'      THEN 3
    ELSE                 4
  END
  LIMIT 1;

  IF v_scope IS NULL THEN
    RETURN false;
  END IF;

  IF v_scope = 'all' THEN
    RETURN true;
  END IF;
  IF v_scope = 'assigned' THEN
    RETURN p_required_scope IN ('assigned', 'own');
  END IF;
  IF v_scope = 'own' THEN
    RETURN p_required_scope = 'own';
  END IF;

  RETURN false;
END;
$function$;

-- ─── 1b. private.current_user_scope_for — override-aware ───────────────────
-- private.current_user_has_permission() composes this and needs no change.

CREATE OR REPLACE FUNCTION private.current_user_scope_for(p_permission text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT private.get_current_user_id() AS id,
           private.get_user_company_id() AS company_id
  ),
  o AS (
    SELECT upo.granted, upo.scope
    FROM me
    JOIN public.user_permission_overrides upo
      ON upo.user_id = me.id
     AND upo.permission = p_permission
     AND upo.company_id = me.company_id
    LIMIT 1
  ),
  r AS (
    SELECT rp.scope
    FROM me
    JOIN public.user_roles ur ON ur.user_id = me.id::text
    JOIN public.role_permissions rp
      ON rp.role_id = ur.role_id
     AND rp.permission = p_permission
    ORDER BY CASE rp.scope
      WHEN 'all'      THEN 1
      WHEN 'assigned' THEN 2
      WHEN 'own'      THEN 3
      ELSE                 4
    END
    LIMIT 1
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM o WHERE NOT granted)                    THEN NULL
    WHEN EXISTS (SELECT 1 FROM o WHERE granted AND scope IS NOT NULL)  THEN (SELECT scope FROM o)
    ELSE                                                                    (SELECT scope FROM r)
  END;
$function$;

-- ─── 2. Company-scoped READ policies (permissive, additive) ────────────────

DROP POLICY IF EXISTS "company members read company role assignments" ON public.user_roles;
CREATE POLICY "company members read company role assignments"
ON public.user_roles
FOR SELECT
TO public
USING (
  user_id IN (
    SELECT u.id::text
    FROM public.users u
    WHERE u.company_id = (SELECT private.get_user_company_id())
      AND u.deleted_at IS NULL
  )
);

DROP POLICY IF EXISTS "company members read visible role permissions" ON public.role_permissions;
CREATE POLICY "company members read visible role permissions"
ON public.role_permissions
FOR SELECT
TO public
USING (
  role_id IN (
    SELECT r.id
    FROM public.roles r
    WHERE r.is_preset = true
       OR r.company_id = (SELECT private.get_user_company_id())
  )
);

-- ─── 3. Override management extends to team.assign_roles holders ───────────

DROP POLICY IF EXISTS "Admins can read company overrides" ON public.user_permission_overrides;
CREATE POLICY "Access managers read company overrides"
ON public.user_permission_overrides
FOR SELECT
TO public
USING (
  (private.current_user_is_admin()
    OR private.current_user_has_permission('team.assign_roles', 'all'))
  AND company_id = (SELECT private.get_user_company_id())
);

DROP POLICY IF EXISTS "Admins can insert company overrides" ON public.user_permission_overrides;
CREATE POLICY "Access managers insert company overrides"
ON public.user_permission_overrides
FOR INSERT
TO public
WITH CHECK (
  (private.current_user_is_admin()
    OR private.current_user_has_permission('team.assign_roles', 'all'))
  AND company_id = (SELECT private.get_user_company_id())
);

DROP POLICY IF EXISTS "Admins can update company overrides" ON public.user_permission_overrides;
CREATE POLICY "Access managers update company overrides"
ON public.user_permission_overrides
FOR UPDATE
TO public
USING (
  (private.current_user_is_admin()
    OR private.current_user_has_permission('team.assign_roles', 'all'))
  AND company_id = (SELECT private.get_user_company_id())
)
WITH CHECK (
  (private.current_user_is_admin()
    OR private.current_user_has_permission('team.assign_roles', 'all'))
  AND company_id = (SELECT private.get_user_company_id())
);

DROP POLICY IF EXISTS "Admins can delete company overrides" ON public.user_permission_overrides;
CREATE POLICY "Access managers delete company overrides"
ON public.user_permission_overrides
FOR DELETE
TO public
USING (
  (private.current_user_is_admin()
    OR private.current_user_has_permission('team.assign_roles', 'all'))
  AND company_id = (SELECT private.get_user_company_id())
);

-- ─── 4. roles: close the cross-tenant write hole ───────────────────────────

DROP POLICY IF EXISTS roles_select ON public.roles;
CREATE POLICY roles_select
ON public.roles
FOR SELECT
TO public
USING (
  is_preset = true
  OR company_id = (SELECT private.get_user_company_id())
);

DROP POLICY IF EXISTS roles_insert ON public.roles;
CREATE POLICY roles_insert
ON public.roles
FOR INSERT
TO public
WITH CHECK (
  is_preset = false
  AND company_id = (SELECT private.get_user_company_id())
  AND (private.current_user_is_admin()
    OR private.current_user_has_permission('team.assign_roles', 'all'))
);

DROP POLICY IF EXISTS roles_update ON public.roles;
CREATE POLICY roles_update
ON public.roles
FOR UPDATE
TO public
USING (
  is_preset = false
  AND company_id = (SELECT private.get_user_company_id())
  AND (private.current_user_is_admin()
    OR private.current_user_has_permission('team.assign_roles', 'all'))
)
WITH CHECK (
  is_preset = false
  AND company_id = (SELECT private.get_user_company_id())
);

DROP POLICY IF EXISTS roles_delete ON public.roles;
CREATE POLICY roles_delete
ON public.roles
FOR DELETE
TO public
USING (
  is_preset = false
  AND company_id = (SELECT private.get_user_company_id())
  AND (private.current_user_is_admin()
    OR private.current_user_has_permission('team.assign_roles', 'all'))
);

-- ============================================================================
-- SENTINELS (run after applying; none mutate lasting state)
--
-- S1. Override grant flips has_permission for a crew user (pick a real crew
--     user id + their company id; use a registered permission their role
--     lacks, e.g. estimates.view for Crew):
--       select public.has_permission('<crew-user>', 'estimates.view', 'all');  -- false
--       insert into user_permission_overrides (user_id, company_id, permission, scope, granted)
--         values ('<crew-user>', '<their-company>', 'estimates.view', 'all', true);
--       select public.has_permission('<crew-user>', 'estimates.view', 'all');  -- true
--       update user_permission_overrides set granted = false, scope = null
--         where user_id = '<crew-user>' and permission = 'estimates.view';
--       select public.has_permission('<crew-user>', 'estimates.view', 'own');  -- false (revoke)
--       delete from user_permission_overrides
--         where user_id = '<crew-user>' and permission = 'estimates.view';
--
-- S2. Admins unaffected: has_permission('<account-holder>', anything) → true.
--
-- S3. RLS reads as a simulated same-company member:
--       set local role anon;
--       set local request.jwt.claims to '{"sub":"<firebase-uid-of-member>"}';
--       select count(*) from user_roles;         -- > 0 (company rows)
--       select count(*) from role_permissions;   -- > 0 (preset rows)
--
-- S4. Cross-tenant roles write as simulated member of company A against a
--     company-B custom role → 0 rows updated.
-- ============================================================================
