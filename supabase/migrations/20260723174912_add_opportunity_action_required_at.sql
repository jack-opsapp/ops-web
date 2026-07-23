ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS operator_action_required_at timestamptz NULL;

COMMENT ON COLUMN public.opportunities.operator_action_required_at IS
  'Latest manual correction declaring that the operator must act next. Ownership engines compare this with inbound, outbound, and handled timestamps; later signals supersede it.';

CREATE TABLE IF NOT EXISTS private.opportunity_quick_touch_undo (
  request_id uuid PRIMARY KEY,
  activity_id uuid UNIQUE NOT NULL,
  opportunity_id uuid NOT NULL
    REFERENCES public.opportunities(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  handled_at timestamptz NOT NULL,
  prior_handled_at timestamptz NULL,
  undone_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE INDEX IF NOT EXISTS opportunity_quick_touch_undo_opportunity_idx
  ON private.opportunity_quick_touch_undo (opportunity_id);

REVOKE ALL ON TABLE private.opportunity_quick_touch_undo
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.opportunity_quick_touch_undo IS
  'Server-only compare-and-swap receipts for atomic lead quick touches. Consumed receipts retain the request and activity IDs for idempotent undo and replay rejection until the opportunity is deleted.';

CREATE OR REPLACE FUNCTION private.current_user_can_mutate_unprotected_activity(
  p_activity_id uuid,
  p_company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.get_user_company_id() = p_company_id
    AND NOT EXISTS (
      SELECT 1
      FROM private.opportunity_quick_touch_undo AS undo
      WHERE undo.activity_id = p_activity_id
        AND undo.company_id = p_company_id
        AND undo.undone_at IS NULL
    )
$$;

REVOKE ALL ON FUNCTION
  private.current_user_can_mutate_unprotected_activity(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  private.current_user_can_mutate_unprotected_activity(uuid, uuid)
  TO anon, authenticated;

DROP POLICY IF EXISTS quick_touch_activity_update_guard
  ON public.activities;

CREATE POLICY quick_touch_activity_update_guard
  ON public.activities
  AS RESTRICTIVE
  FOR UPDATE
  TO anon, authenticated
  USING (
    private.current_user_can_mutate_unprotected_activity(id, company_id)
  )
  WITH CHECK (
    private.current_user_can_mutate_unprotected_activity(id, company_id)
  );

DROP POLICY IF EXISTS quick_touch_activity_delete_guard
  ON public.activities;

CREATE POLICY quick_touch_activity_delete_guard
  ON public.activities
  AS RESTRICTIVE
  FOR DELETE
  TO anon, authenticated
  USING (
    private.current_user_can_mutate_unprotected_activity(id, company_id)
  );

CREATE OR REPLACE FUNCTION private.invalidate_quick_touch_undo_on_reparent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE private.opportunity_quick_touch_undo
  SET undone_at = coalesce(undone_at, statement_timestamp())
  WHERE activity_id = NEW.id
    AND undone_at IS NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.invalidate_quick_touch_undo_on_reparent()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_activities_invalidate_quick_touch_undo_on_reparent
  ON public.activities;

CREATE TRIGGER trg_activities_invalidate_quick_touch_undo_on_reparent
BEFORE UPDATE OF opportunity_id, company_id
ON public.activities
FOR EACH ROW
WHEN (
  OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id
  OR OLD.company_id IS DISTINCT FROM NEW.company_id
)
EXECUTE FUNCTION private.invalidate_quick_touch_undo_on_reparent();

CREATE OR REPLACE FUNCTION private.consume_quick_touch_undo_on_activity_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE private.opportunity_quick_touch_undo
  SET undone_at = coalesce(undone_at, statement_timestamp())
  WHERE activity_id = OLD.id
    AND undone_at IS NULL;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION
  private.consume_quick_touch_undo_on_activity_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_activities_consume_quick_touch_undo_on_delete
  ON public.activities;

CREATE TRIGGER trg_activities_consume_quick_touch_undo_on_delete
BEFORE DELETE
ON public.activities
FOR EACH ROW
EXECUTE FUNCTION private.consume_quick_touch_undo_on_activity_delete();

CREATE OR REPLACE FUNCTION private.stamp_opportunity_chase_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_latest_existing timestamptz;
  v_server_now timestamptz :=
    date_trunc('milliseconds', statement_timestamp());
BEGIN
  IF current_setting('ops.restore_chase_state', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.handled_at IS DISTINCT FROM OLD.handled_at
     AND NEW.handled_at IS NOT NULL THEN
    SELECT max(signal)
    INTO v_latest_existing
    FROM unnest(ARRAY[
      NEW.last_inbound_at,
      NEW.last_outbound_at,
      OLD.handled_at,
      OLD.operator_action_required_at
    ]) AS chase_signals(signal);

    NEW.handled_at := greatest(
      v_server_now,
      date_trunc('milliseconds', v_latest_existing) + interval '1 millisecond'
    );
  END IF;

  IF NEW.operator_action_required_at IS DISTINCT FROM OLD.operator_action_required_at
     AND NEW.operator_action_required_at IS NOT NULL THEN
    SELECT max(signal)
    INTO v_latest_existing
    FROM unnest(ARRAY[
      NEW.last_inbound_at,
      NEW.last_outbound_at,
      NEW.handled_at,
      OLD.operator_action_required_at
    ]) AS chase_signals(signal);

    NEW.operator_action_required_at := greatest(
      v_server_now,
      date_trunc('milliseconds', v_latest_existing) + interval '1 millisecond'
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_opportunity_chase_events() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_opportunities_stamp_chase_events
  ON public.opportunities;

CREATE TRIGGER trg_opportunities_stamp_chase_events
BEFORE UPDATE OF handled_at, operator_action_required_at
ON public.opportunities
FOR EACH ROW
EXECUTE FUNCTION private.stamp_opportunity_chase_events();

COMMENT ON FUNCTION private.stamp_opportunity_chase_events() IS
  'Server-stamps manual lead ownership events strictly after the newest existing signal so device clock skew and millisecond ties cannot corrupt cross-client ordering.';

COMMENT ON COLUMN public.opportunities.handled_at IS
  'Operator declared the latest inbound handled (their move). Server-stamped on update; newer ownership signals supersede it.';

CREATE OR REPLACE FUNCTION public.log_opportunity_quick_touch(
  p_request_id uuid,
  p_opportunity_id uuid,
  p_type text,
  p_subject text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_activity public.activities%ROWTYPE;
  v_activity_found boolean;
  v_existing_undo private.opportunity_quick_touch_undo%ROWTYPE;
  v_opportunity public.opportunities%ROWTYPE;
  v_prior_handled_at timestamptz;
BEGIN
  IF v_actor_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'authenticated operator required'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'quick-touch request id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_type IS NULL
     OR p_type NOT IN ('text_message', 'email_compose') THEN
    RAISE EXCEPTION 'unsupported quick-touch activity type'
      USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(p_subject), '') IS NULL THEN
    RAISE EXCEPTION 'quick-touch subject is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.lock_lead_assignment_company(v_company_id);

  SELECT opportunity.*
  INTO v_opportunity
  FROM public.opportunities AS opportunity
  WHERE opportunity.id = p_opportunity_id
    AND opportunity.company_id = v_company_id
  FOR UPDATE;

  IF v_opportunity.id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.users AS actor
  WHERE actor.id = v_actor_user_id
    AND actor.company_id = v_company_id
    AND actor.deleted_at IS NULL
    AND coalesce(actor.is_active, false)
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.user_can_edit_opportunity(
    v_actor_user_id,
    p_opportunity_id
  ) THEN
    RAISE EXCEPTION 'opportunity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT undo.*
  INTO v_existing_undo
  FROM private.opportunity_quick_touch_undo AS undo
  WHERE undo.request_id = p_request_id;

  IF v_existing_undo.request_id IS NOT NULL THEN
    IF v_existing_undo.opportunity_id IS DISTINCT FROM p_opportunity_id
       OR v_existing_undo.company_id IS DISTINCT FROM v_company_id
       OR v_existing_undo.actor_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing_undo.undone_at IS NOT NULL THEN
      RAISE EXCEPTION 'quick-touch request is invalid or already consumed'
        USING ERRCODE = '22023';
    END IF;

    SELECT activity.*
    INTO v_activity
    FROM public.activities AS activity
    WHERE activity.id = v_existing_undo.activity_id
    FOR UPDATE;

    v_activity_found := FOUND;

    SELECT undo.*
    INTO v_existing_undo
    FROM private.opportunity_quick_touch_undo AS undo
    WHERE undo.request_id = p_request_id
    FOR UPDATE;

    IF v_existing_undo.request_id IS NULL
       OR v_existing_undo.opportunity_id IS DISTINCT FROM p_opportunity_id
       OR v_existing_undo.company_id IS DISTINCT FROM v_company_id
       OR v_existing_undo.actor_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing_undo.undone_at IS NOT NULL THEN
      RAISE EXCEPTION 'quick-touch request is invalid or already consumed'
        USING ERRCODE = '22023';
    END IF;

    IF NOT v_activity_found
       OR v_activity.opportunity_id IS DISTINCT FROM p_opportunity_id
       OR v_activity.company_id IS DISTINCT FROM v_company_id
       OR v_activity.created_by IS DISTINCT FROM v_actor_user_id
       OR v_activity.type IS DISTINCT FROM p_type
       OR v_activity.subject IS DISTINCT FROM btrim(p_subject)
       OR v_activity.direction IS DISTINCT FROM 'outbound' THEN
      RAISE EXCEPTION 'quick-touch replay token is invalid'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'activity', to_jsonb(v_activity),
      'opportunity', to_jsonb(v_opportunity)
    );
  END IF;

  v_prior_handled_at := v_opportunity.handled_at;

  UPDATE public.opportunities
  SET handled_at = statement_timestamp()
  WHERE id = p_opportunity_id
  RETURNING * INTO v_opportunity;

  IF v_opportunity.id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.activities (
    opportunity_id,
    company_id,
    type,
    subject,
    direction,
    created_by
  )
  VALUES (
    v_opportunity.id,
    v_opportunity.company_id,
    p_type,
    btrim(p_subject),
    'outbound',
    v_actor_user_id
  )
  RETURNING * INTO v_activity;

  INSERT INTO private.opportunity_quick_touch_undo (
    request_id,
    activity_id,
    opportunity_id,
    company_id,
    actor_user_id,
    handled_at,
    prior_handled_at
  )
  VALUES (
    p_request_id,
    v_activity.id,
    v_opportunity.id,
    v_company_id,
    v_actor_user_id,
    v_opportunity.handled_at,
    v_prior_handled_at
  );

  RETURN jsonb_build_object(
    'activity', to_jsonb(v_activity),
    'opportunity', to_jsonb(v_opportunity)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_opportunity_quick_touch(
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.log_opportunity_quick_touch(
  uuid,
  uuid,
  text,
  text
) TO authenticated;

COMMENT ON FUNCTION public.log_opportunity_quick_touch(
  uuid,
  uuid,
  text,
  text
) IS
  'Idempotently logs an outbound TEXT or local email-compose quick touch, stores a private exact undo token, and advances the opportunity to THEIR MOVE after explicit company/edit authorization.';

DROP FUNCTION IF EXISTS public.undo_opportunity_quick_touch(
  uuid,
  uuid,
  timestamptz,
  boolean
);

CREATE OR REPLACE FUNCTION public.undo_opportunity_quick_touch(
  p_activity_id uuid,
  p_opportunity_id uuid
)
RETURNS SETOF public.opportunities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_deleted_count integer;
  v_opportunity public.opportunities%ROWTYPE;
  v_activity public.activities%ROWTYPE;
  v_activity_found boolean;
  v_undo private.opportunity_quick_touch_undo%ROWTYPE;
BEGIN
  IF v_actor_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'authenticated operator required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM private.lock_lead_assignment_company(v_company_id);

  SELECT opportunity.*
  INTO v_opportunity
  FROM public.opportunities AS opportunity
  WHERE opportunity.id = p_opportunity_id
    AND opportunity.company_id = v_company_id
  FOR UPDATE;

  IF v_opportunity.id IS NULL THEN
    RAISE EXCEPTION 'opportunity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.users AS actor
  WHERE actor.id = v_actor_user_id
    AND actor.company_id = v_company_id
    AND actor.deleted_at IS NULL
    AND coalesce(actor.is_active, false)
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.user_can_edit_opportunity(
    v_actor_user_id,
    p_opportunity_id
  ) THEN
    RAISE EXCEPTION 'opportunity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT undo.*
  INTO v_undo
  FROM private.opportunity_quick_touch_undo AS undo
  WHERE undo.activity_id = p_activity_id
    AND undo.opportunity_id = p_opportunity_id
    AND undo.company_id = v_company_id
    AND undo.actor_user_id = v_actor_user_id;

  IF v_undo.activity_id IS NULL THEN
    RAISE EXCEPTION 'quick-touch activity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_undo.undone_at IS NOT NULL THEN
    RETURN NEXT v_opportunity;
    RETURN;
  END IF;

  SELECT activity.*
  INTO v_activity
  FROM public.activities AS activity
  WHERE activity.id = v_undo.activity_id
  FOR UPDATE;

  v_activity_found := FOUND;

  SELECT undo.*
  INTO v_undo
  FROM private.opportunity_quick_touch_undo AS undo
  WHERE undo.activity_id = p_activity_id
    AND undo.opportunity_id = p_opportunity_id
    AND undo.company_id = v_company_id
    AND undo.actor_user_id = v_actor_user_id
  FOR UPDATE;

  IF v_undo.activity_id IS NULL THEN
    RAISE EXCEPTION 'quick-touch activity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_undo.undone_at IS NOT NULL THEN
    RETURN NEXT v_opportunity;
    RETURN;
  END IF;

  IF NOT v_activity_found
     OR v_activity.opportunity_id IS DISTINCT FROM p_opportunity_id
     OR v_activity.company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'quick-touch activity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_opportunity.handled_at IS DISTINCT FROM v_undo.handled_at THEN
    RAISE EXCEPTION
      'quick-touch has been superseded and cannot be undone out of order'
      USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.activities
  WHERE id = v_undo.activity_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'quick-touch activity not found or unauthorized'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE private.opportunity_quick_touch_undo
  SET undone_at = coalesce(undone_at, statement_timestamp())
  WHERE activity_id = v_undo.activity_id;

  PERFORM set_config('ops.restore_chase_state', 'on', true);

  UPDATE public.opportunities
  SET handled_at = v_undo.prior_handled_at
  WHERE id = p_opportunity_id
  RETURNING * INTO v_opportunity;

  PERFORM set_config('ops.restore_chase_state', 'off', true);

  RETURN NEXT v_opportunity;
END;
$$;

REVOKE ALL ON FUNCTION public.undo_opportunity_quick_touch(
  uuid,
  uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.undo_opportunity_quick_touch(
  uuid,
  uuid
) TO authenticated;

COMMENT ON FUNCTION public.undo_opportunity_quick_touch(
  uuid,
  uuid
) IS
  'Idempotently locks company, parent, activity, then receipt; rejects out-of-order handled lineage; removes one atomic quick-touch activity; restores its exact pre-touch handled marker; and preserves newer correspondence or operator signals.';
