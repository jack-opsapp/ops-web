-- PostgreSQL identifiers are limited to 63 bytes. Rename the initially
-- deployed outbound-adoption RPC to a stable name that PostgREST and
-- supabase-js can address without server-side truncation.

begin;

do $shorten_guarded_outbound_adoption_prerequisite$
begin
  if to_regprocedure(
    'public.adopt_orphan_outbound_email_activity_with_payload_guard_as_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,boolean,text,timestamptz,text,text,text[],text[],text,text,text)'
  ) is null
  then
    raise exception
      'guarded_orphan_outbound_email_activity_adoption_function_missing'
      using errcode = '55000';
  end if;
end;
$shorten_guarded_outbound_adoption_prerequisite$;

alter function public.adopt_orphan_outbound_email_activity_with_payload_guard_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) rename to adopt_orphan_outbound_email_activity_guarded_as_system;

revoke all on function public.adopt_orphan_outbound_email_activity_guarded_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.adopt_orphan_outbound_email_activity_guarded_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) to service_role;

comment on function public.adopt_orphan_outbound_email_activity_guarded_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) is
  'Lease-, thread-owner-, and payload-bound adoption of one exact outbound '
  'NULL-owner email activity. Token-gates the child CAS and atomically records '
  'canonical outbound correspondence without changing stage or assignment.';

commit;
