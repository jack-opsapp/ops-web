-- 101_template_version_compare_rpc.sql
-- Side-by-side metrics for two template versions of the same email_type.
-- Source of truth: email_jobs (carries template_version, sg_message_id, status,
-- created_at). email_campaigns.template_id maps to the template registry key
-- (which equals email_type semantically). email_events joined via sg_message_id.

CREATE OR REPLACE FUNCTION public.template_version_compare(
  p_email_type text,
  p_version_a text,
  p_version_b text,
  p_since timestamptz DEFAULT now() - interval '30 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_versions jsonb;
BEGIN
  WITH scoped_jobs AS (
    SELECT j.id,
           j.sg_message_id,
           j.recipient_email,
           j.template_version,
           j.status
    FROM public.email_jobs j
    JOIN public.email_campaigns c ON c.id = j.campaign_id
    WHERE c.template_id = p_email_type
      AND j.template_version IN (p_version_a, p_version_b)
      AND j.created_at >= p_since
  ),
  per_version AS (
    SELECT
      sj.template_version AS version,
      count(*) FILTER (WHERE sj.status IN ('sent', 'bounced')) AS sent,
      count(DISTINCT sj.recipient_email) FILTER (WHERE e.event = 'open') AS opens,
      count(DISTINCT sj.recipient_email) FILTER (WHERE e.event = 'click') AS clicks,
      count(*) FILTER (WHERE e.event = 'bounce') AS bounces
    FROM scoped_jobs sj
    LEFT JOIN public.email_events e ON e.sg_message_id = sj.sg_message_id
    GROUP BY 1
  )
  SELECT jsonb_object_agg(version, jsonb_build_object(
    'sent', sent,
    'opens', opens,
    'clicks', clicks,
    'bounces', bounces,
    'open_rate', CASE WHEN sent > 0 THEN round(opens::numeric / sent * 100, 1) ELSE 0 END,
    'click_rate', CASE WHEN sent > 0 THEN round(clicks::numeric / sent * 100, 1) ELSE 0 END,
    'bounce_rate', CASE WHEN sent > 0 THEN round(bounces::numeric / sent * 100, 1) ELSE 0 END
  ))
  INTO v_versions
  FROM per_version;

  RETURN jsonb_build_object(
    'email_type', p_email_type,
    'since', p_since,
    'versions', coalesce(v_versions, '{}'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.template_version_compare(text, text, text, timestamptz) FROM anon, authenticated;
