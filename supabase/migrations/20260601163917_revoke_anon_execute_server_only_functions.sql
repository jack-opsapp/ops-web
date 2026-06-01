-- #4 anon_security_definer_function_executable (WARN): the OPS app calls most RPCs as the anon
-- role, so broad anon EXECUTE is intentional and was left in place. These 17 SECURITY DEFINER
-- functions are the exception -- verified server-only (admin email routes, email cron workers,
-- server-side lib/admin + lib/email, or trigger functions with no rpc call site) with zero browser
-- or iOS call sites. anon never legitimately invokes them, and anon EXECUTE was a real risk (e.g.
-- toggle_email_cron could let an unauthenticated caller disable the email system; email_audience_filter
-- could enumerate every user's email). Revoke anon EXECUTE only; authenticated is left intact because
-- some admin routes may run via the authenticated server client (gated in-route). service_role retains
-- EXECUTE. fire_due_task_reminders is intentionally excluded (iOS references it).
--
-- NOTE: where EXECUTE is granted via PUBLIC (Postgres default), REVOKE ... FROM anon is a no-op;
-- the effective lockdown is completed in 20260601164310_lock_server_only_functions_to_service_role.sql,
-- which revokes from PUBLIC and re-grants service_role. This migration is kept as the applied record.
REVOKE EXECUTE ON FUNCTION public.auto_resolve_commitments_on_archive() FROM anon;
REVOKE EXECUTE ON FUNCTION public.campaign_engagement_stats(p_campaign_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.campaign_funnel_stages(p_campaign_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_email_jobs(p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_audience_count(p_filter jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_audience_filter(p_filter jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_event_metrics(p_minutes_back integer, p_bucket text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_funnel_counts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_segment_counts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_top_bounce_domains(p_minutes_back integer, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_email_events_auto_suppress() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_email_cron_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_audience_template_usage(p_template_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_campaign_counter(p_campaign_id uuid, p_field text, p_delta integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_thread_commitments() FROM anon;
REVOKE EXECUTE ON FUNCTION public.template_version_compare(p_email_type text, p_version_a text, p_version_b text, p_since timestamp with time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.toggle_email_cron(p_jobname text, p_active boolean) FROM anon;
