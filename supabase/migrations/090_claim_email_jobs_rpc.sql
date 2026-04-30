-- 090_claim_email_jobs_rpc.sql
-- Atomic FOR UPDATE SKIP LOCKED claim of pending jobs. Returns claimed rows
-- after transitioning them to 'dispatching' so a parallel worker invocation
-- skips them.

CREATE OR REPLACE FUNCTION public.claim_email_jobs(
  p_limit int DEFAULT 200
) RETURNS TABLE(
  id uuid,
  campaign_id uuid,
  recipient_email text,
  recipient_user_id uuid,
  template_payload jsonb,
  retry_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT j.id
    FROM public.email_jobs j
    JOIN public.email_campaigns c ON c.id = j.campaign_id
    WHERE j.status = 'pending'
      AND c.send_status = 'in_flight'
    ORDER BY j.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.email_jobs j
  SET status = 'dispatching', updated_at = now()
  FROM claimed
  WHERE j.id = claimed.id
  RETURNING j.id, j.campaign_id, j.recipient_email, j.recipient_user_id,
            j.template_payload, j.retry_count;
END $$;

REVOKE ALL ON FUNCTION public.claim_email_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_email_jobs(int) TO service_role;

COMMENT ON FUNCTION public.claim_email_jobs IS
  'Atomically claims up to p_limit pending jobs from in-flight campaigns by transitioning to dispatching. SKIP LOCKED ensures parallel workers do not double-dispatch.';
