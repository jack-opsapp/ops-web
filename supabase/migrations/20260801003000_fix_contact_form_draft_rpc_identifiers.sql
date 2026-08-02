-- PostgreSQL truncates identifiers to 63 bytes. The original provider-create
-- and reconciliation RPC declarations exceeded that limit, so PostgREST
-- exposed their truncated catalog names while the worker called names that
-- could never resolve. Preserve the audited implementations behind stable,
-- service-only entry points whose names are within PostgreSQL's limit.

begin;

do $prerequisites$
begin
  if to_regprocedure(
    'public.begin_email_assignment_contact_form_draft_provider_create_as_sy(uuid,text)'
  ) is null
    or to_regprocedure(
      'public.mark_email_assignment_contact_form_draft_reconciliation_require(uuid,text,uuid,text,text,text)'
    ) is null
  then
    raise exception 'contact_form_draft_truncated_rpc_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function public.begin_assignment_contact_draft_provider_create_as_system(
  p_queue_id uuid,
  p_holder text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return public.begin_email_assignment_contact_form_draft_provider_create_as_sy(
    p_queue_id,
    p_holder
  );
end;
$function$;

create or replace function public.mark_assignment_contact_draft_reconciliation_as_system(
  p_queue_id uuid,
  p_holder text,
  p_provider_create_attempt_id uuid,
  p_mailbox_draft_id text,
  p_provider_thread_id text,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return public.mark_email_assignment_contact_form_draft_reconciliation_require(
    p_queue_id,
    p_holder,
    p_provider_create_attempt_id,
    p_mailbox_draft_id,
    p_provider_thread_id,
    p_error
  );
end;
$function$;

revoke all on function public.begin_assignment_contact_draft_provider_create_as_system(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.begin_assignment_contact_draft_provider_create_as_system(
  uuid, text
) to service_role;

revoke all on function public.mark_assignment_contact_draft_reconciliation_as_system(
  uuid, text, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.mark_assignment_contact_draft_reconciliation_as_system(
  uuid, text, uuid, text, text, text
) to service_role;

comment on function public.begin_assignment_contact_draft_provider_create_as_system(
  uuid, text
) is
  'Stable service-only provider-create reservation RPC; delegates to the legacy implementation whose identifier was truncated by PostgreSQL.';
comment on function public.mark_assignment_contact_draft_reconciliation_as_system(
  uuid, text, uuid, text, text, text
) is
  'Stable service-only uncertain-provider-outcome reconciliation RPC; delegates to the legacy implementation whose identifier was truncated by PostgreSQL.';

commit;
