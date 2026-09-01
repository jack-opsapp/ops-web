-- Repair related email-attachment reconciliation after the deployed helper
-- reused its loop record name as a table alias. PostgreSQL resolves the record
-- first and raises before attachment discovery can finish.

create or replace function private.reconcile_related_email_conversion_photo_sources(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_content_sha256 text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_related_attachment_id uuid;
begin
  if p_company_id is null
    or p_content_sha256 is null
    or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or (
      p_opportunity_id is null
      and (p_connection_id is null or p_provider_thread_id is null)
    )
  then
    return;
  end if;

  for v_related_attachment_id in
    select attachment.id
      from public.email_attachments as attachment
     where attachment.company_id = p_company_id
       and attachment.content_sha256 is not distinct from p_content_sha256
       and (
         (
           p_opportunity_id is not null
           and attachment.opportunity_id is not distinct from p_opportunity_id
         )
         or (
           p_connection_id is not null
           and p_provider_thread_id is not null
           and attachment.connection_id = p_connection_id
           and attachment.provider_thread_id is not distinct from p_provider_thread_id
         )
       )
     order by attachment.occurred_at, attachment.id
  loop
    perform private.reconcile_email_attachment_conversion_photo(
      v_related_attachment_id
    );
  end loop;
end;
$function$;

revoke all on function private.reconcile_related_email_conversion_photo_sources(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
