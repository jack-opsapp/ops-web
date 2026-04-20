-- =================================================================
-- Migration 075: has_permission(uuid, text, text) RPC
--
-- Context
-- -------
-- Server-side API routes call supabase.rpc("has_permission", { p_user_id,
-- p_permission }) via the service-role client to gate access. That function
-- was defined by an earlier draft (local 015_permissions_system.sql) but
-- never shipped — the migration that actually ran in prod
-- (20260303054857 create_roles_and_permissions) used a different shape and
-- exposed only private.current_user_has_permission(text, text), which relies
-- on auth.jwt() and is therefore useless for service-role callers.
--
-- The result: every API endpoint protected by checkPermissionById /
-- checkPermission has been returning 403 whenever called, because the RPC
-- threw `function has_permission(uuid, unknown) does not exist` and
-- check-permission.ts treats RPC errors as a deny (fail-closed). The /inbox
-- rebuild surfaced this because it is the first endpoint many users hit
-- after login.
--
-- This migration creates the missing function and mirrors the exact
-- semantics the client permission store and the RLS helpers already use, so
-- server and client decisions stay in lock-step:
--
--   1. Admin/account-holder bypass:
--        - users.is_company_admin = true
--        - OR user.id::text = companies.account_holder_id
--        - OR user.id::text = ANY(companies.admin_ids)
--      (matches private.current_user_is_admin.)
--
--   2. Role-based scope lookup:
--        user_roles -> role_permissions, preferring the widest granted
--        scope (all > assigned > own) when duplicate rows exist.
--
--   3. Scope hierarchy:
--        all       → satisfies any request
--        assigned  → satisfies 'assigned' or 'own'
--        own       → satisfies 'own'
--      (matches private.current_user_has_permission.)
--
-- Type notes
-- ----------
-- - users.id is uuid, user_roles.user_id is text (historical), and
--   role_permissions.permission is text (not an enum). The function casts
--   at the join boundary and uses text comparisons for permission names.
-- - p_required_scope defaults to 'all' to match how the server currently
--   calls the RPC (no scope argument → treat as a full-privilege check).
-- - SECURITY DEFINER + locked search_path so the function remains callable
--   under RLS and can't be hijacked by a schema-shadow attack.
-- =================================================================

CREATE OR REPLACE FUNCTION public.has_permission(
  p_user_id        uuid,
  p_permission     text,
  p_required_scope text DEFAULT 'all'
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_is_admin boolean;
  v_scope    text;
BEGIN
  IF p_user_id IS NULL OR p_permission IS NULL THEN
    RETURN false;
  END IF;

  -- ── 1. Admin / account-holder / company-admin bypass ──────────────────
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

  -- ── 2. Role-based scope lookup (widest scope wins) ────────────────────
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

  -- ── 3. Scope hierarchy check ──────────────────────────────────────────
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
$$;

-- The service-role key does not use the SQL role system; grants are here to
-- match how the rest of the schema is provisioned and to keep this callable
-- from authenticated contexts in the future without another migration.
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_permission(uuid, text, text) IS
  'Server-side permission check. Mirrors client-side permission store + private.current_user_has_permission. Returns true if the user is a company admin / account holder, or holds a role that grants the permission at a scope satisfying p_required_scope.';
