-- =================================================================
-- Migration 033: get_company_join_details RPC
--
-- Security-definer function that fetches branded company details
-- for the onboarding confirmation screen. Looks up company by code
-- (case-insensitive) with UUID fallback. Returns company info plus
-- first 8 team members for avatar display.
-- Used during iOS onboarding before the user has a company (no RLS access).
-- =================================================================

CREATE OR REPLACE FUNCTION public.get_company_join_details(
  p_code TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company RECORD;
  v_team_members jsonb;
  v_team_size INT;
BEGIN
  -- ─── Validate input ───────────────────────────────────────────────
  IF p_code IS NULL OR TRIM(p_code) = '' THEN
    RETURN NULL;
  END IF;

  -- ─── Look up company by company_code (case-insensitive) ───────────
  SELECT
    c.id,
    c.name,
    c.company_code,
    c.logo_url,
    c.industries,
    c.seated_employee_ids
  INTO v_company
  FROM companies c
  WHERE LOWER(TRIM(c.company_code)) = LOWER(TRIM(p_code))
    AND c.deleted_at IS NULL
  LIMIT 1;

  -- ─── Fallback: try UUID lookup ────────────────────────────────────
  IF v_company IS NULL THEN
    BEGIN
      SELECT
        c.id,
        c.name,
        c.company_code,
        c.logo_url,
        c.industries,
        c.seated_employee_ids
      INTO v_company
      FROM companies c
      WHERE c.id = p_code::uuid
        AND c.deleted_at IS NULL
      LIMIT 1;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END IF;

  IF v_company IS NULL THEN
    RETURN NULL;
  END IF;

  -- ─── Count total team size ────────────────────────────────────────
  v_team_size := COALESCE(
    array_length(v_company.seated_employee_ids, 1), 0
  );

  -- ─── Fetch first 8 team members ──────────────────────────────────
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

  RETURN jsonb_build_object(
    'company_id', v_company.id,
    'company_name', v_company.name,
    'company_code', v_company.company_code,
    'company_logo_url', v_company.logo_url,
    'industries', to_jsonb(COALESCE(v_company.industries, ARRAY[]::text[])),
    'team_members', v_team_members,
    'team_size', v_team_size
  );
END;
$$;
