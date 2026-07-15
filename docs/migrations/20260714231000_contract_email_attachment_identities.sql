-- Contract the legacy mailbox-agnostic attachment identities.
--
-- IMPORTANT: this reviewed SQL artifact is deliberately held outside
-- `supabase/migrations`. Apply it only after the compatible application is
-- deployed and read-only verification confirms every new writer supplies
-- connection_id and email_attachment_id.

begin;

do $$
begin
  if exists (select 1 from public.email_attachments where connection_id is null) then
    raise exception 'email_attachments still contains rows without connection_id';
  end if;
  if exists (
    select 1
      from public.attachment_inspections
     where connection_id is null or email_attachment_id is null
  ) then
    raise exception 'attachment_inspections backfill is incomplete';
  end if;
end;
$$;

alter table public.email_attachments
  drop constraint if exists email_attachments_company_id_message_id_attachment_id_key;

alter table public.attachment_inspections
  drop constraint if exists attachment_inspections_company_id_message_id_attachment_id_key,
  alter column connection_id set not null,
  alter column email_attachment_id set not null;

commit;
