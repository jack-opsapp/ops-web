-- MEDIUM-2: let iOS accumulate burst counts when the client-side debounce
-- suppresses individual RPC calls. The RPC now accepts an optional
-- p_fire_count and adds it to times_reported instead of always +1.
-- Backward compatible: p_fire_count defaults to 1 so the existing iOS
-- call (no p_fire_count param) keeps working until the iOS update ships.
--
-- LOW-2: mirror the EXECUTE grants on the sibling current_user_can_edit_project
-- so anon explicitly carries the same grant. Behaviorally identical (both
-- are reachable via PUBLIC) but consistent.

CREATE OR REPLACE FUNCTION public.record_auto_bug(
  p_category text,
  p_priority text,
  p_screen text,
  p_suspected_file text,
  p_error_code text,
  p_summary text,
  p_metadata jsonb,
  p_app_version text,
  p_build_number text,
  p_os_version text,
  p_device_model text,
  p_network_type text,
  p_fire_count integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_company_id uuid;
  v_user_email text;
  v_dedupe_key text;
  v_existing_id uuid;
  v_new_count integer;
  v_inserted_id uuid;
  v_safe_count integer;
BEGIN
  v_user_id := private.get_current_user_id();
  v_company_id := private.get_user_company_id();
  IF v_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Defensive floor on caller-supplied fire count. NULL or <1 collapses to 1
  -- so the function always represents at least one occurrence per call.
  v_safe_count := GREATEST(COALESCE(p_fire_count, 1), 1);

  SELECT email INTO v_user_email FROM public.users WHERE id = v_user_id;

  v_dedupe_key := 'auto:' || encode(
    digest(
      COALESCE(p_category, '_') || ':' ||
      COALESCE(p_screen, '_') || ':' ||
      COALESCE(p_suspected_file, '_') || ':' ||
      COALESCE(p_error_code, '_'),
      'sha256'
    ),
    'hex'
  );

  SELECT id INTO v_existing_id
  FROM public.bug_reports
  WHERE company_id = v_company_id
    AND dedupe_key = v_dedupe_key
    AND status IN ('new', 'triaged', 'in_progress')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.bug_reports
    SET times_reported  = times_reported + v_safe_count,
        last_reported_at = now(),
        updated_at       = now()
    WHERE id = v_existing_id
    RETURNING times_reported INTO v_new_count;

    RETURN jsonb_build_object(
      'id', v_existing_id,
      'created', false,
      'times_reported', v_new_count,
      'fire_count_applied', v_safe_count
    );
  END IF;

  BEGIN
    INSERT INTO public.bug_reports (
      company_id, reporter_id, reporter_email, reporter_name,
      description, category, priority, platform, screen_name,
      app_version, build_number, os_version, device_model, network_type,
      custom_metadata, status, dedupe_key, times_reported, last_reported_at
    ) VALUES (
      v_company_id, v_user_id, v_user_email, 'OPS iOS (auto-filed)',
      p_summary, p_category, p_priority, 'ios', p_screen,
      p_app_version, p_build_number, p_os_version, p_device_model, p_network_type,
      p_metadata, 'new', v_dedupe_key, v_safe_count, now()
    )
    RETURNING id INTO v_inserted_id;

    RETURN jsonb_build_object(
      'id', v_inserted_id,
      'created', true,
      'times_reported', v_safe_count,
      'fire_count_applied', v_safe_count
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- Race: a sibling device inserted the same dedupe_key between our
      -- SELECT and INSERT. Fall through to UPDATE on the existing row so
      -- neither caller loses their count.
      UPDATE public.bug_reports
      SET times_reported  = times_reported + v_safe_count,
          last_reported_at = now(),
          updated_at       = now()
      WHERE company_id = v_company_id
        AND dedupe_key = v_dedupe_key
        AND status IN ('new', 'triaged', 'in_progress')
      RETURNING id, times_reported INTO v_existing_id, v_new_count;

      RETURN jsonb_build_object(
        'id', v_existing_id,
        'created', false,
        'times_reported', v_new_count,
        'fire_count_applied', v_safe_count
      );
  END;
END;
$$;

-- Re-grant. The function signature changed (added p_fire_count) so the old
-- grant doesn't carry over automatically.
REVOKE ALL ON FUNCTION public.record_auto_bug(text, text, text, text, text, text, jsonb, text, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_auto_bug(text, text, text, text, text, text, jsonb, text, text, text, text, text, integer) TO authenticated, service_role;

-- LOW-2: explicit anon GRANT on the view-helper to match its sibling.
GRANT EXECUTE ON FUNCTION private.current_user_can_view_project(uuid) TO anon;
