-- 106_email_event_metrics_rpc.sql
-- PR 8: Event Monitor + Anomaly Alerts
--
-- Aggregates email_events into a single JSONB blob for the Event Monitor
-- dashboard and the anomaly cron. SECURITY DEFINER + service-role only.

CREATE OR REPLACE FUNCTION public.email_event_metrics(
  p_minutes_back int DEFAULT 60,
  p_bucket text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window_start timestamptz := now() - (p_minutes_back || ' minutes')::interval;
  v_total_sent int; v_total_delivered int; v_total_bounced int;
  v_total_spam int; v_total_open int; v_total_click int;
  v_bounce_pct numeric; v_spam_pct numeric;
  v_open_pct numeric; v_click_pct numeric;
  v_error_events int;
  v_by_minute jsonb;
  v_bucket_seconds int;
BEGIN
  IF p_bucket = '1m' THEN v_bucket_seconds := 60;
  ELSIF p_bucket = '5m' THEN v_bucket_seconds := 300;
  ELSIF p_bucket = '15m' THEN v_bucket_seconds := 900;
  ELSE v_bucket_seconds := NULL;
  END IF;

  SELECT
    count(*) FILTER (WHERE event = 'processed'),
    count(*) FILTER (WHERE event = 'delivered'),
    count(*) FILTER (WHERE event = 'bounce'),
    count(*) FILTER (WHERE event = 'spamreport'),
    count(*) FILTER (WHERE event = 'open'),
    count(*) FILTER (WHERE event = 'click'),
    count(*) FILTER (WHERE event IN ('dropped','deferred','blocked'))
  INTO v_total_sent, v_total_delivered, v_total_bounced,
       v_total_spam, v_total_open, v_total_click, v_error_events
  FROM public.email_events
  WHERE timestamp >= v_window_start;

  v_bounce_pct := CASE WHEN v_total_sent > 0
    THEN round((v_total_bounced::numeric / v_total_sent::numeric) * 100, 3)
    ELSE 0 END;
  v_spam_pct := CASE WHEN v_total_delivered > 0
    THEN round((v_total_spam::numeric / v_total_delivered::numeric) * 100, 4)
    ELSE 0 END;
  v_open_pct := CASE WHEN v_total_delivered > 0
    THEN round((v_total_open::numeric / v_total_delivered::numeric) * 100, 2)
    ELSE 0 END;
  v_click_pct := CASE WHEN v_total_delivered > 0
    THEN round((v_total_click::numeric / v_total_delivered::numeric) * 100, 2)
    ELSE 0 END;

  IF v_bucket_seconds IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object(
      'bucket_at', to_char(bucket_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'sent', sent, 'delivered', delivered, 'bounced', bounced,
      'spam', spam, 'open', open_count, 'click', click_count
    ) ORDER BY bucket_at)
    INTO v_by_minute
    FROM (
      SELECT
        to_timestamp(floor(extract(epoch FROM timestamp) / v_bucket_seconds) * v_bucket_seconds) AS bucket_at,
        count(*) FILTER (WHERE event = 'processed') AS sent,
        count(*) FILTER (WHERE event = 'delivered') AS delivered,
        count(*) FILTER (WHERE event = 'bounce') AS bounced,
        count(*) FILTER (WHERE event = 'spamreport') AS spam,
        count(*) FILTER (WHERE event = 'open') AS open_count,
        count(*) FILTER (WHERE event = 'click') AS click_count
      FROM public.email_events
      WHERE timestamp >= v_window_start
      GROUP BY bucket_at
    ) sub;
  END IF;

  RETURN jsonb_build_object(
    'window_minutes', p_minutes_back,
    'total_sent', v_total_sent,
    'total_delivered', v_total_delivered,
    'total_bounced', v_total_bounced,
    'bounce_pct', v_bounce_pct,
    'total_spam', v_total_spam,
    'spam_pct', v_spam_pct,
    'total_open', v_total_open,
    'open_pct', v_open_pct,
    'total_click', v_total_click,
    'click_pct', v_click_pct,
    'error_events', v_error_events,
    'by_minute', COALESCE(v_by_minute, '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.email_top_bounce_domains(
  p_minutes_back int DEFAULT 60,
  p_limit int DEFAULT 10
) RETURNS TABLE(domain text, bounce_count int, bounce_pct numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH bounces AS (
    SELECT lower(split_part(email, '@', 2)) AS domain
    FROM public.email_events
    WHERE event = 'bounce' AND timestamp >= now() - (p_minutes_back || ' minutes')::interval
  ),
  agg AS (
    SELECT domain, count(*)::int AS bounce_count, sum(count(*)) OVER () AS total
    FROM bounces
    WHERE domain <> ''
    GROUP BY domain
  )
  SELECT domain, bounce_count,
    CASE WHEN total > 0
      THEN round((bounce_count::numeric / total::numeric) * 100, 2)
      ELSE 0 END AS bounce_pct
  FROM agg
  ORDER BY bounce_count DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.email_event_metrics(int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_top_bounce_domains(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_event_metrics(int, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_top_bounce_domains(int, int) TO service_role;
