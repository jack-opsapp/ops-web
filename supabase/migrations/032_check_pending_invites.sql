-- =================================================================
-- Migration 032: check_pending_invites RPC
--
-- Security-definer function that checks if an email has pending,
-- non-expired team invitations. Returns company details, team
-- members, prescribed role, and inviter name for each match.
-- Used during iOS onboarding before the user has a company (no RLS access).
-- =================================================================

CREATE OR REPLACE FUNCTION public.check_pending_invites(
  p_email TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invites jsonb := '[]'::jsonb;
  v_invite RECORD;
  v_team_members jsonb;
  v_team_size INT;
  v_inviter_name TEXT;
  v_role_name TEXT;
  v_company RECORD;
BEGIN
  -- ─── Validate input ───────────────────────────────────────────────
  IF p_email IS NULL OR TRIM(p_email) = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  -- ─── Find all pending, non-expired invitations for this email ─────
  FOR v_invite IN
    SELECT
      ti.id AS invitation_id,
      ti.company_id,
      ti.role_id,
      ti.invited_by,
      ti.expires_at,
      ti.created_at
    FROM team_invitations ti
    WHERE LOWER(TRIM(ti.email)) = LOWER(TRIM(p_email))
      AND ti.status = 'pending'
      AND ti.expires_at > NOW()
    ORDER BY ti.created_at DESC
  LOOP
    -- ─── Fetch company details ────────────────────────────────────
    SELECT
      c.id,
      c.name,
      c.company_code,
      c.logo_url,
      c.industries,
      c.seated_employee_ids
    INTO v_company
    FROM companies c
    WHERE c.id = v_invite.company_id
      AND c.deleted_at IS NULL;

    IF v_company IS NULL THEN
      CONTINUE;
    END IF;

    -- ─── Fetch inviter name ───────────────────────────────────────
    SELECT
      COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')
    INTO v_inviter_name
    FROM users u
    WHERE u.id::text = v_invite.invited_by::text
      AND u.deleted_at IS NULL;

    v_inviter_name := COALESCE(TRIM(v_inviter_name), 'Unknown');

    -- ─── Fetch role name (if prescribed) ──────────────────────────
    v_role_name := NULL;
    IF v_invite.role_id IS NOT NULL THEN
      SELECT r.name INTO v_role_name
      FROM roles r
      WHERE r.id = v_invite.role_id;

      IF v_role_name = 'Unassigned' THEN
        v_role_name := NULL;
      END IF;
    END IF;

    -- ─── Count total team size ────────────────────────────────────
    v_team_size := COALESCE(
      array_length(v_company.seated_employee_ids, 1), 0
    );

    -- ─── Fetch first 8 team members ──────────────────────────────
    SELECT COALESCE(jsonb_agg(member), '[]'::jsonb)
    INTO v_team_members
    FROM (
      SELECT jsonb_build_object(
        'first_name', COALESCE(u.first_name, ''),
        'last_name', COALESCE(u.last_name, ''),
        'profile_image_url', u.profile_image_url
      ) AS member
      FROM users u
      WHERE u.id::text = ANY(COALESCE(v_company.seated_employee_ids, ARRAY[]::text[]))
        AND u.deleted_at IS NULL
      ORDER BY u.created_at ASC
      LIMIT 8
    ) sub;

    -- ─── Build invite object and append ───────────────────────────
    v_invites := v_invites || jsonb_build_object(
      'invitation_id', v_invite.invitation_id,
      'company_id', v_invite.company_id,
      'company_name', v_company.name,
      'company_code', v_company.company_code,
      'company_logo_url', v_company.logo_url,
      'industries', to_jsonb(COALESCE(v_company.industries, ARRAY[]::text[])),
      'role_name', v_role_name,
      'invited_by_name', v_inviter_name,
      'team_members', v_team_members,
      'team_size', v_team_size,
      'expires_at', v_invite.expires_at
    );
  END LOOP;

  RETURN v_invites;
END;
$$;
