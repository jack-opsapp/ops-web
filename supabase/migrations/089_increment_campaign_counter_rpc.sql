-- 089_increment_campaign_counter_rpc.sql
-- Atomic counter increment. Avoids read-modify-write race when two worker
-- batches finalize jobs for the same campaign concurrently.

CREATE OR REPLACE FUNCTION public.increment_campaign_counter(
  p_campaign_id uuid,
  p_field text,
  p_delta int DEFAULT 1
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_field NOT IN (
    'sent_count','delivered_count','bounced_count','opened_count',
    'clicked_count','suppressed_skipped_count','failed_count'
  ) THEN
    RAISE EXCEPTION 'increment_campaign_counter: invalid field %', p_field;
  END IF;

  EXECUTE format(
    'UPDATE public.email_campaigns SET %I = COALESCE(%I,0) + $1 WHERE id = $2',
    p_field, p_field
  ) USING p_delta, p_campaign_id;
END $$;

REVOKE ALL ON FUNCTION public.increment_campaign_counter(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_campaign_counter(uuid, text, int) TO service_role;

COMMENT ON FUNCTION public.increment_campaign_counter IS
  'Atomic counter increment for email_campaigns. Field allowlist prevents SQL injection. Service-role only.';
