-- Actual deployed attachment-state helper, verified read-only 2026-09-14.
CREATE OR REPLACE FUNCTION private.exact_message_recovery_attachment_state(p_company_id uuid, p_connection_id uuid, p_provider_thread_id text, p_provider_message_id text, p_activity_id uuid, p_target_opportunity_id uuid, p_expected_scan_generation bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_scan_generation bigint;
  v_scan_status text;
begin
  perform 1
  from public.email_attachments attachment
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_activity_id
  order by attachment.id
  for update;

  if exists (
    select 1
    from public.email_attachments attachment
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and attachment.attribution_status = 'needs_review'
  ) then
    raise exception 'exact_recovery_attachment_needs_review'
      using errcode = '55000';
  end if;

  select scan.status, scan.generation
  into v_scan_status, v_scan_generation
  from public.email_attachment_scans scan
  where scan.company_id = p_company_id
    and scan.connection_id = p_connection_id
    and scan.provider_thread_id = p_provider_thread_id
    and scan.message_id = p_provider_message_id
    and scan.activity_id = p_activity_id
  for update;
  if not found then
    raise exception 'exact_recovery_attachment_scan_missing'
      using errcode = '55000';
  end if;
  if v_scan_generation is distinct from p_expected_scan_generation then
    raise exception 'exact_recovery_attachment_scan_generation_changed'
      using errcode = '40001';
  end if;
  if v_scan_status in ('failed', 'paused') then
    raise exception 'exact_recovery_attachment_scan_failed'
      using errcode = '55000';
  end if;
  if v_scan_status <> 'complete' or exists (
    select 1
    from public.email_attachments attachment
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and (
        attachment.attribution_status = 'pending'
        or attachment.opportunity_id is distinct from p_target_opportunity_id
      )
  ) then
    return 'pending';
  end if;

  perform 1
  from public.email_attachment_inspection_jobs inspection_job
  join public.email_attachments attachment
    on attachment.id = inspection_job.email_attachment_id
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_activity_id
  order by inspection_job.id
  for update of inspection_job;

  if exists (
    select 1
    from public.email_attachments attachment
    left join public.email_attachment_inspection_jobs inspection_job
      on inspection_job.email_attachment_id = attachment.id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and attachment.ingest_status = 'stored'
      and inspection_job.id is null
  ) then
    return 'pending';
  end if;
  if exists (
    select 1
    from public.email_attachment_inspection_jobs inspection_job
    join public.email_attachments attachment
      on attachment.id = inspection_job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and inspection_job.status = 'failed'
  ) then
    raise exception 'exact_recovery_attachment_inspection_failed'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.email_attachment_inspection_jobs inspection_job
    join public.email_attachments attachment
      on attachment.id = inspection_job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and inspection_job.status not in ('complete', 'skipped')
  ) then
    return 'pending';
  end if;

  perform 1
  from public.email_conversion_photo_jobs job
  join public.email_attachments attachment
    on attachment.id = job.email_attachment_id
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_activity_id
  order by job.id
  for update of job;

  if exists (
    select 1
    from public.email_conversion_photo_jobs job
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and job.status = 'failed'
  ) then
    raise exception 'exact_recovery_attachment_materialization_failed'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.email_conversion_photo_jobs job
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and job.status in ('pending', 'processing', 'retrying')
  ) or exists (
    select 1
    from public.email_conversion_photo_objects object_row
    join public.email_conversion_photo_jobs job on job.id = object_row.job_id
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and job.operation = 'revoke'
      and object_row.state <> 'deleted'
  ) then
    return 'pending';
  end if;

  return 'complete';
end;
$function$;
