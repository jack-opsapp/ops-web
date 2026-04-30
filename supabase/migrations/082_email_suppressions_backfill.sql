-- 082_email_suppressions_backfill.sql
-- One-time backfill: scan existing email_events for terminal events and
-- populate email_suppressions. Idempotent — safe to re-run.

INSERT INTO public.email_suppressions (
  email, list, reason, source, source_event_id, metadata, created_at
)
SELECT
  lower(e.email) AS email,
  CASE
    WHEN e.event = 'group_unsubscribe' THEN COALESCE(e.raw->>'asm_group_id', 'group_unknown')
    ELSE 'global'
  END AS list,
  CASE
    WHEN e.event = 'bounce' AND COALESCE(e.raw->>'type', 'bounce') IN ('bounce', 'blocked') THEN 'hard_bounce'
    WHEN e.event = 'spamreport' THEN 'spam_report'
    WHEN e.event = 'unsubscribe' THEN 'unsubscribe'
    WHEN e.event = 'group_unsubscribe' THEN 'group_unsubscribe'
  END AS reason,
  'backfill' AS source,
  e.id AS source_event_id,
  jsonb_build_object(
    'sg_message_id', e.sg_message_id,
    'event_timestamp', e.timestamp,
    'reason_text', e.reason
  ) AS metadata,
  e.timestamp AS created_at
FROM public.email_events e
WHERE
  (e.event = 'bounce' AND COALESCE(e.raw->>'type', 'bounce') IN ('bounce', 'blocked'))
  OR e.event IN ('spamreport', 'unsubscribe', 'group_unsubscribe')
ORDER BY e.timestamp ASC  -- earliest event becomes the suppression source
ON CONFLICT (lower(email), list) DO NOTHING;

-- Log how many were backfilled (visible in migration logs)
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.email_suppressions WHERE source = 'backfill';
  RAISE NOTICE 'email_suppressions backfill complete: % rows', v_count;
END $$;
