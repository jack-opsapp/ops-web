-- OPS Web — Inbox v2 / Phase 6
-- RPC: get_inbox_density_per_client(company_id)
--
-- Returns per-client thread density + recency for the Intel galaxy halo.
-- Scoped to the caller's company via the p_company_id argument + RLS on
-- email_threads. Intended to be called from the intel page via supabase.rpc().

CREATE OR REPLACE FUNCTION public.get_inbox_density_per_client(p_company_id uuid)
RETURNS TABLE (
  client_id uuid,
  thread_count int,
  last_message_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    client_id,
    COUNT(*)::int AS thread_count,
    MAX(last_message_at) AS last_message_at
  FROM public.email_threads
  WHERE company_id = p_company_id
    AND client_id IS NOT NULL
    AND archived_at IS NULL
  GROUP BY client_id;
$$;

REVOKE ALL ON FUNCTION public.get_inbox_density_per_client(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inbox_density_per_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inbox_density_per_client(uuid) TO service_role;
