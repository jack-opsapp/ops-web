-- #4 (effective lockdown): the prior REVOKE ... FROM anon was a no-op for functions whose EXECUTE
-- is granted via PUBLIC (Postgres grants EXECUTE to PUBLIC by default). These 17 SECURITY DEFINER
-- functions are verified server-only -- every caller uses getServiceRoleClient()/getAdminSupabase()
-- (SUPABASE_SERVICE_ROLE_KEY) or is a trigger function with no call site; zero browser/iOS callers.
-- Revoke EXECUTE from PUBLIC + anon + authenticated and grant only service_role, clearing both the
-- anon_ and authenticated_security_definer_function_executable findings for these functions.
-- (fire_due_task_reminders is intentionally excluded -- iOS invokes it as the app role.)

REVOKE EXECUTE ON FUNCTION public.auto_resolve_commitments_on_archive() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_resolve_commitments_on_archive() TO service_role;
REVOKE EXECUTE ON FUNCTION public.campaign_engagement_stats(p_campaign_id uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.campaign_engagement_stats(p_campaign_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.campaign_funnel_stages(p_campaign_id uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.campaign_funnel_stages(p_campaign_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_email_jobs(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_email_jobs(p_limit integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.email_audience_count(p_filter jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_audience_count(p_filter jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.email_audience_filter(p_filter jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_audience_filter(p_filter jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.email_event_metrics(p_minutes_back integer, p_bucket text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_event_metrics(p_minutes_back integer, p_bucket text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.email_funnel_counts() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_funnel_counts() TO service_role;
REVOKE EXECUTE ON FUNCTION public.email_segment_counts() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_segment_counts() TO service_role;
REVOKE EXECUTE ON FUNCTION public.email_top_bounce_domains(p_minutes_back integer, p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_top_bounce_domains(p_minutes_back integer, p_limit integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_email_events_auto_suppress() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_email_events_auto_suppress() TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_email_cron_status() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_email_cron_status() TO service_role;
REVOKE EXECUTE ON FUNCTION public.increment_audience_template_usage(p_template_id uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_audience_template_usage(p_template_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.increment_campaign_counter(p_campaign_id uuid, p_field text, p_delta integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_campaign_counter(p_campaign_id uuid, p_field text, p_delta integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.recompute_thread_commitments() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_thread_commitments() TO service_role;
REVOKE EXECUTE ON FUNCTION public.template_version_compare(p_email_type text, p_version_a text, p_version_b text, p_since timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.template_version_compare(p_email_type text, p_version_a text, p_version_b text, p_since timestamp with time zone) TO service_role;
REVOKE EXECUTE ON FUNCTION public.toggle_email_cron(p_jobname text, p_active boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.toggle_email_cron(p_jobname text, p_active boolean) TO service_role;
