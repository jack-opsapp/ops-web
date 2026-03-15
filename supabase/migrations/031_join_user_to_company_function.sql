-- =================================================================
-- Migration 031: join_user_to_company() function + role CHECK cleanup
--
-- Single source of truth for joining a user to a company.
-- Called by all platforms (web, iOS, Android) to ensure uniform behavior.
--
-- Handles:
--   1. Sets user's company_id
--   2. Looks up pending invitation (by email, then phone)
--   3. Assigns RBAC role (from invite > existing > unassigned)
--   4. Syncs users.role column with assigned role name
--   5. Assigns a seat if available (seated_employee_ids < max_seats)
--
-- Also removes deprecated office_crew/field_crew from users.role CHECK.
-- =================================================================

-- ─── Clean up deprecated role values ────────────────────────────────────────

UPDATE users SET role = 'office' WHERE role = 'office_crew';
UPDATE users SET role = 'crew' WHERE role = 'field_crew';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['admin', 'owner', 'office', 'operator', 'crew', 'unassigned']));

-- ─── Function ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.join_user_to_company(
  p_user_id UUID,
  p_company_id UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
  v_company RECORD;
  v_invitation RECORD;
  v_existing_role_id UUID;
  v_role_id UUID;
  v_role_name TEXT;
  v_seat_granted BOOLEAN := false;
  v_seated_count INT;
  v_user_id_text TEXT;
  v_unassigned_role_id UUID := '00000000-0000-0000-0000-000000000006';
BEGIN
  v_user_id_text := p_user_id::text;

  -- 1. Validate user exists
  SELECT id, email, phone, company_id
    INTO v_user
    FROM users
   WHERE id = p_user_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- 2. Validate company exists
  SELECT id, max_seats, seated_employee_ids
    INTO v_company
    FROM companies
   WHERE id = p_company_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Company not found');
  END IF;

  -- 3. Set user's company_id
  UPDATE users
     SET company_id = p_company_id,
         updated_at = NOW()
   WHERE id = p_user_id;

  -- 4. Look up pending invitation (email first, then phone)
  v_invitation := NULL;

  IF v_user.email IS NOT NULL THEN
    SELECT id, role_id
      INTO v_invitation
      FROM team_invitations
     WHERE company_id = p_company_id
       AND email = v_user.email
       AND status = 'pending'
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF v_invitation.id IS NULL AND v_user.phone IS NOT NULL THEN
    SELECT id, role_id
      INTO v_invitation
      FROM team_invitations
     WHERE company_id = p_company_id
       AND phone = v_user.phone
       AND status = 'pending'
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  -- 5. Determine role to assign
  --    Priority: invitation role > existing role > unassigned
  SELECT role_id INTO v_existing_role_id
    FROM user_roles
   WHERE user_id = v_user_id_text;

  IF v_invitation.id IS NOT NULL THEN
    UPDATE team_invitations
       SET status = 'accepted', updated_at = NOW()
     WHERE id = v_invitation.id;

    v_role_id := COALESCE(v_invitation.role_id, v_existing_role_id, v_unassigned_role_id);
  ELSIF v_existing_role_id IS NOT NULL THEN
    v_role_id := v_existing_role_id;
  ELSE
    v_role_id := v_unassigned_role_id;
  END IF;

  -- 6. Assign RBAC role (upsert — user_id is text in user_roles)
  INSERT INTO user_roles (user_id, role_id)
  VALUES (v_user_id_text, v_role_id)
  ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id;

  -- 7. Sync users.role column with assigned role name
  --    CHECK allows: admin, owner, office, operator, crew, unassigned
  --    Custom roles default to 'unassigned' in the legacy column
  SELECT lower(name) INTO v_role_name FROM roles WHERE id = v_role_id;

  IF v_role_name NOT IN ('admin', 'owner', 'office', 'operator', 'crew', 'unassigned') THEN
    v_role_name := 'unassigned';
  END IF;

  UPDATE users
     SET role = COALESCE(v_role_name, 'unassigned')
   WHERE id = p_user_id;

  -- 8. Assign seat if available
  v_seated_count := COALESCE(array_length(v_company.seated_employee_ids, 1), 0);

  IF v_seated_count < v_company.max_seats THEN
    IF NOT (v_user_id_text = ANY(COALESCE(v_company.seated_employee_ids, ARRAY[]::text[]))) THEN
      UPDATE companies
         SET seated_employee_ids = array_append(COALESCE(seated_employee_ids, ARRAY[]::text[]), v_user_id_text),
             updated_at = NOW()
       WHERE id = p_company_id;

      v_seat_granted := true;
    END IF;
  END IF;

  -- 9. Return result
  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'company_id', p_company_id,
    'role_id', v_role_id,
    'role_name', COALESCE(v_role_name, 'unassigned'),
    'seat_granted', v_seat_granted,
    'invitation_found', v_invitation.id IS NOT NULL
  );
END;
$$;
