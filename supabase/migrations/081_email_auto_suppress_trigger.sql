-- 081_email_auto_suppress_trigger.sql
-- After inserting into email_events, fan terminal events into email_suppressions.
-- Hard bounces, spam reports, unsubscribes, and group unsubscribes are
-- permanent suppressions. Soft bounces and dropped events are NOT auto-
-- suppressed (SendGrid handles soft retry; dropped is usually a transient
-- queue event we want to see in analytics but not act on).

CREATE OR REPLACE FUNCTION public.fn_email_events_auto_suppress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_list text := 'global';
  v_bounce_type text;
BEGIN
  -- Map SendGrid event type → suppression reason. Skip events that don't suppress.
  IF NEW.event = 'bounce' THEN
    -- SendGrid puts the bounce category in raw.type ('bounce' = hard, 'blocked' = blocked).
    v_bounce_type := COALESCE(NEW.raw->>'type', 'bounce');
    IF v_bounce_type IN ('bounce', 'blocked') THEN
      v_reason := 'hard_bounce';
    ELSE
      RETURN NEW;  -- soft bounce, do not suppress
    END IF;

  ELSIF NEW.event = 'spamreport' THEN
    v_reason := 'spam_report';

  ELSIF NEW.event = 'unsubscribe' THEN
    v_reason := 'unsubscribe';

  ELSIF NEW.event = 'group_unsubscribe' THEN
    v_reason := 'group_unsubscribe';
    -- Group-level unsubscribe targets a specific list. SendGrid puts the
    -- ASM group id in raw.asm_group_id; map it to a friendly list name
    -- if known, otherwise use the numeric id.
    v_list := COALESCE(NEW.raw->>'asm_group_id', 'group_unknown');

  ELSE
    RETURN NEW;  -- not a suppressing event
  END IF;

  -- Upsert into email_suppressions. Re-suppressing updates source_event_id
  -- and metadata; we keep the earliest created_at by leaving it on conflict.
  INSERT INTO public.email_suppressions (
    email, list, reason, source, source_event_id, metadata
  )
  VALUES (
    lower(NEW.email),
    v_list,
    v_reason,
    'webhook',
    NEW.id,
    jsonb_build_object(
      'sg_message_id', NEW.sg_message_id,
      'event_timestamp', NEW.timestamp,
      'reason_text', NEW.reason
    )
  )
  ON CONFLICT (lower(email), list) DO UPDATE SET
    source_event_id = EXCLUDED.source_event_id,
    metadata = EXCLUDED.metadata,
    -- Keep the most severe reason. spam_report > hard_bounce > unsubscribe.
    reason = CASE
      WHEN public.email_suppressions.reason = 'spam_report' THEN public.email_suppressions.reason
      WHEN EXCLUDED.reason = 'spam_report' THEN EXCLUDED.reason
      WHEN public.email_suppressions.reason = 'hard_bounce' THEN public.email_suppressions.reason
      WHEN EXCLUDED.reason = 'hard_bounce' THEN EXCLUDED.reason
      ELSE EXCLUDED.reason
    END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_events_auto_suppress ON public.email_events;

CREATE TRIGGER trg_email_events_auto_suppress
  AFTER INSERT ON public.email_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_email_events_auto_suppress();

COMMENT ON FUNCTION public.fn_email_events_auto_suppress IS
  'Fans bounce/spamreport/unsubscribe/group_unsubscribe events from email_events into email_suppressions. Soft bounces and dropped events are intentionally not suppressed. Severity ordering: spam_report > hard_bounce > unsubscribe — re-suppress preserves higher severity.';
