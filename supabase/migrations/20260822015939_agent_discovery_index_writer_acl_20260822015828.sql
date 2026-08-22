-- Allow every current source-table DML role to maintain the immutable
-- expression and partial indexes introduced by agent discovery reads.
--
-- These helpers are pure scalar transforms in the non-exposed private schema.
-- PostgreSQL evaluates them as the writing role during index maintenance, so
-- revoking EXECUTE from a role that may write the table rejects valid DML.

begin;

do $prerequisites$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.agent_trim_discovery_display_text(text)',
    'private.agent_discovery_unicode15_text_is_supported(text)',
    'private.agent_normalize_discovery_text(text)',
    'private.agent_normalize_discovery_email(text)',
    'private.agent_normalize_discovery_phone(text)',
    'private.agent_discovery_opportunity_source_is_invalid(uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'private.agent_discovery_project_source_is_invalid(text,uuid,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'private.agent_uuid_from_legacy_text(text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'agent_discovery_index_writer_acl_prerequisite_missing: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

revoke execute on function private.agent_trim_discovery_display_text(text)
  from public;
revoke execute on function private.agent_discovery_unicode15_text_is_supported(text)
  from public;
revoke execute on function private.agent_normalize_discovery_text(text)
  from public;
revoke execute on function private.agent_normalize_discovery_email(text)
  from public;
revoke execute on function private.agent_normalize_discovery_phone(text)
  from public;
revoke execute on function private.agent_discovery_opportunity_source_is_invalid(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  timestamptz
) from public;
revoke execute on function private.agent_discovery_project_source_is_invalid(
  text, uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz
) from public;
revoke execute on function private.agent_uuid_from_legacy_text(text)
  from public;

grant execute on function private.agent_trim_discovery_display_text(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_discovery_unicode15_text_is_supported(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_normalize_discovery_text(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_normalize_discovery_email(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_normalize_discovery_phone(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_discovery_opportunity_source_is_invalid(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  timestamptz
) to anon, authenticated, service_role;
grant execute on function private.agent_discovery_project_source_is_invalid(
  text, uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz
) to anon, authenticated, service_role;
grant execute on function private.agent_uuid_from_legacy_text(text)
  to anon, authenticated, service_role;

commit;
