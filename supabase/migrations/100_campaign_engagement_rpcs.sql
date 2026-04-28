-- 100_campaign_engagement_rpcs.sql
-- Engagement aggregation. campaign_engagement_stats returns a denormalized
-- JSONB blob; campaign_funnel_stages returns one row per Sankey stage.

CREATE INDEX IF NOT EXISTS idx_email_events_sg_event
  ON public.email_events (sg_message_id, event)
  WHERE sg_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_jobs_campaign_status
  ON public.email_jobs (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_email_log_campaign_id
  ON public.email_log (campaign_id)
  WHERE campaign_id IS NOT NULL;

-- ============================================================================
-- campaign_engagement_stats(campaign_id uuid) RETURNS jsonb
-- ============================================================================
CREATE OR REPLACE FUNCTION public.campaign_engagement_stats(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_camp record;
  v_unique_opens int;
  v_unique_clicks int;
  v_per_domain jsonb;
  v_first_event timestamptz;
  v_last_event timestamptz;
  v_in_flight int;
  v_failed int;
  v_open_rate numeric;
  v_click_rate numeric;
  v_bounce_rate numeric;
  v_ctor numeric;
  v_spam_count int;
  v_unsubscribe_count int;
BEGIN
  SELECT * INTO v_camp FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_camp IS NULL THEN RETURN NULL; END IF;

  -- Unique opens / clicks via JOIN of jobs↔events
  SELECT count(DISTINCT j.recipient_email)
    INTO v_unique_opens
    FROM public.email_jobs j
    JOIN public.email_events e ON e.sg_message_id = j.sg_message_id
   WHERE j.campaign_id = p_campaign_id AND e.event = 'open';

  SELECT count(DISTINCT j.recipient_email)
    INTO v_unique_clicks
    FROM public.email_jobs j
    JOIN public.email_events e ON e.sg_message_id = j.sg_message_id
   WHERE j.campaign_id = p_campaign_id AND e.event = 'click';

  SELECT count(*) INTO v_in_flight
    FROM public.email_jobs WHERE campaign_id = p_campaign_id AND status = 'pending';
  SELECT count(*) INTO v_failed
    FROM public.email_jobs WHERE campaign_id = p_campaign_id AND status = 'failed';

  SELECT min(e."timestamp"), max(e."timestamp")
    INTO v_first_event, v_last_event
    FROM public.email_jobs j
    JOIN public.email_events e ON e.sg_message_id = j.sg_message_id
   WHERE j.campaign_id = p_campaign_id;

  -- Per-domain bounce summary, top 10
  SELECT coalesce(jsonb_agg(d ORDER BY d.bounces DESC), '[]'::jsonb)
    INTO v_per_domain
    FROM (
      SELECT
        lower(split_part(j.recipient_email, '@', 2)) AS domain,
        count(*) FILTER (WHERE e.event = 'bounce') AS bounces,
        count(*) FILTER (WHERE e.event = 'delivered') AS delivered,
        count(*) FILTER (WHERE e.event = 'dropped') AS dropped
      FROM public.email_jobs j
      LEFT JOIN public.email_events e ON e.sg_message_id = j.sg_message_id
      WHERE j.campaign_id = p_campaign_id
      GROUP BY 1
      ORDER BY 2 DESC NULLS LAST
      LIMIT 10
    ) d;

  -- Spam / unsubscribe events (table has no campaign counter columns for these)
  SELECT count(*) INTO v_spam_count
    FROM public.email_jobs j
    JOIN public.email_events e ON e.sg_message_id = j.sg_message_id
   WHERE j.campaign_id = p_campaign_id AND e.event = 'spamreport';

  SELECT count(*) INTO v_unsubscribe_count
    FROM public.email_jobs j
    JOIN public.email_events e ON e.sg_message_id = j.sg_message_id
   WHERE j.campaign_id = p_campaign_id AND e.event = 'unsubscribe';

  v_open_rate := CASE WHEN v_camp.delivered_count > 0
                      THEN round(v_unique_opens::numeric / v_camp.delivered_count * 100, 1)
                      ELSE 0 END;
  v_click_rate := CASE WHEN v_camp.delivered_count > 0
                       THEN round(v_unique_clicks::numeric / v_camp.delivered_count * 100, 1)
                       ELSE 0 END;
  v_bounce_rate := CASE WHEN (v_camp.sent_count + v_camp.bounced_count) > 0
                        THEN round(v_camp.bounced_count::numeric / (v_camp.sent_count + v_camp.bounced_count) * 100, 1)
                        ELSE 0 END;
  v_ctor := CASE WHEN v_unique_opens > 0
                 THEN round(v_unique_clicks::numeric / v_unique_opens * 100, 1)
                 ELSE 0 END;

  RETURN jsonb_build_object(
    'campaign_id', p_campaign_id,
    'sent', v_camp.sent_count,
    'delivered', v_camp.delivered_count,
    'bounced', v_camp.bounced_count,
    'opened', v_unique_opens,
    'clicked', v_unique_clicks,
    'spam_reports', v_spam_count,
    'unsubscribes', v_unsubscribe_count,
    'suppressed_skipped', v_camp.suppressed_skipped_count,
    'failed', v_failed,
    'in_flight', v_in_flight,
    'open_rate', v_open_rate,
    'click_rate', v_click_rate,
    'bounce_rate', v_bounce_rate,
    'ctor', v_ctor,
    'per_domain_bounce_summary', v_per_domain,
    'first_event_at', v_first_event,
    'last_event_at', v_last_event
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.campaign_engagement_stats(uuid) FROM anon, authenticated;

-- ============================================================================
-- campaign_funnel_stages(campaign_id uuid) RETURNS TABLE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.campaign_funnel_stages(p_campaign_id uuid)
RETURNS TABLE(stage text, value bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_camp record;
  v_dispatched bigint;
  v_unique_opens bigint;
  v_unique_clicks bigint;
BEGIN
  SELECT * INTO v_camp FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_camp IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_dispatched
    FROM public.email_jobs WHERE campaign_id = p_campaign_id AND status IN ('sent', 'bounced');

  SELECT count(DISTINCT j.recipient_email)
    INTO v_unique_opens
    FROM public.email_jobs j
    JOIN public.email_events e ON e.sg_message_id = j.sg_message_id
   WHERE j.campaign_id = p_campaign_id AND e.event = 'open';

  SELECT count(DISTINCT j.recipient_email)
    INTO v_unique_clicks
    FROM public.email_jobs j
    JOIN public.email_events e ON e.sg_message_id = j.sg_message_id
   WHERE j.campaign_id = p_campaign_id AND e.event = 'click';

  stage := 'enqueued'; value := v_camp.recipient_count_actual; RETURN NEXT;
  stage := 'dispatched'; value := v_dispatched; RETURN NEXT;
  stage := 'delivered'; value := v_camp.delivered_count; RETURN NEXT;
  stage := 'opened'; value := v_unique_opens; RETURN NEXT;
  stage := 'clicked'; value := v_unique_clicks; RETURN NEXT;
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.campaign_funnel_stages(uuid) FROM anon, authenticated;
