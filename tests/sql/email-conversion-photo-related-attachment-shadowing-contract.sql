-- EMAIL CONVERSION PHOTO RELATED-ATTACHMENT RECONCILIATION — BEHAVIOR CONTRACT
--
-- ISOLATED DATABASE ONLY. This contract installs the previously deployed
-- implementation, applies the forward repair migration, and exercises the
-- function in PostgreSQL. Every schema and role change is rolled back.

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end;
$roles$;

create schema private;

create table public.email_attachments (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  connection_id uuid,
  provider_thread_id text,
  content_sha256 text,
  occurred_at timestamptz not null
);

create table private.reconciled_attachment_probe (
  call_order bigint generated always as identity primary key,
  attachment_id uuid not null
);

create function private.reconcile_email_attachment_conversion_photo(
  p_attachment_id uuid
)
returns void
language sql
as $function$
  insert into private.reconciled_attachment_probe (attachment_id)
  values (p_attachment_id);
$function$;

-- This is the exact deployed implementation that failed in production. The
-- forward migration included below must replace it before the assertions run.
create function private.reconcile_related_email_conversion_photo_sources(
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
  related_attachment record;
begin
  if p_company_id is null
    or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or (
      p_opportunity_id is null
      and (p_connection_id is null or p_provider_thread_id is null)
    )
  then
    return;
  end if;

  for related_attachment in
    select related_attachment.id
      from public.email_attachments as related_attachment
     where related_attachment.company_id = p_company_id
       and related_attachment.content_sha256 is not distinct from p_content_sha256
       and (
         (
           p_opportunity_id is not null
           and related_attachment.opportunity_id is not distinct from p_opportunity_id
         )
         or (
           p_connection_id is not null
           and p_provider_thread_id is not null
           and related_attachment.connection_id = p_connection_id
           and related_attachment.provider_thread_id is not distinct from p_provider_thread_id
         )
       )
     order by related_attachment.occurred_at, related_attachment.id
  loop
    perform private.reconcile_email_attachment_conversion_photo(related_attachment.id);
  end loop;
end;
$function$;

revoke all on function private.reconcile_related_email_conversion_photo_sources(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

\ir ../../supabase/migrations/20260820172857_fix_related_attachment_record_shadowing.sql

do $contract$
declare
  v_function regprocedure :=
    'private.reconcile_related_email_conversion_photo_sources(uuid,uuid,uuid,text,text)'::regprocedure;
begin
  if has_function_privilege('anon', v_function, 'execute')
    or has_function_privilege('authenticated', v_function, 'execute')
    or has_function_privilege('service_role', v_function, 'execute')
  then
    raise exception 'related attachment helper is executable by an API role';
  end if;
end;
$contract$;

insert into public.email_attachments (
  id,
  company_id,
  opportunity_id,
  connection_id,
  provider_thread_id,
  content_sha256,
  occurred_at
)
values
  -- Matches only the opportunity branch.
  (
    '4501a2dc-0000-4000-8000-000000000001',
    '4501a2dc-0000-4000-8000-000000000010',
    '4501a2dc-0000-4000-8000-000000000020',
    '4501a2dc-0000-4000-8000-000000000031',
    'other-provider-thread',
    repeat('a', 64),
    '2026-08-20 17:00:00+00'
  ),
  -- Matches only the connection/thread branch.
  (
    '4501a2dc-0000-4000-8000-000000000002',
    '4501a2dc-0000-4000-8000-000000000010',
    '4501a2dc-0000-4000-8000-000000000021',
    '4501a2dc-0000-4000-8000-000000000030',
    'provider-thread-4501a2dc',
    repeat('a', 64),
    '2026-08-20 17:01:00+00'
  ),
  -- Matches the company and hash but neither identity branch.
  (
    '4501a2dc-0000-4000-8000-000000000003',
    '4501a2dc-0000-4000-8000-000000000010',
    '4501a2dc-0000-4000-8000-000000000021',
    '4501a2dc-0000-4000-8000-000000000031',
    'other-provider-thread',
    repeat('a', 64),
    '2026-08-20 17:02:00+00'
  ),
  -- Matches the hash and both identities but belongs to another company.
  (
    '4501a2dc-0000-4000-8000-000000000004',
    '4501a2dc-0000-4000-8000-000000000011',
    '4501a2dc-0000-4000-8000-000000000020',
    '4501a2dc-0000-4000-8000-000000000030',
    'provider-thread-4501a2dc',
    repeat('a', 64),
    '2026-08-20 17:03:00+00'
  ),
  -- These three rows prove every invalid-hash call is a no-op.
  (
    '4501a2dc-0000-4000-8000-000000000005',
    '4501a2dc-0000-4000-8000-000000000010',
    '4501a2dc-0000-4000-8000-000000000020',
    '4501a2dc-0000-4000-8000-000000000030',
    'provider-thread-4501a2dc',
    null,
    '2026-08-20 17:04:00+00'
  ),
  (
    '4501a2dc-0000-4000-8000-000000000006',
    '4501a2dc-0000-4000-8000-000000000010',
    '4501a2dc-0000-4000-8000-000000000020',
    '4501a2dc-0000-4000-8000-000000000030',
    'provider-thread-4501a2dc',
    repeat('a', 63),
    '2026-08-20 17:05:00+00'
  ),
  (
    '4501a2dc-0000-4000-8000-000000000007',
    '4501a2dc-0000-4000-8000-000000000010',
    '4501a2dc-0000-4000-8000-000000000020',
    '4501a2dc-0000-4000-8000-000000000030',
    'provider-thread-4501a2dc',
    repeat('A', 64),
    '2026-08-20 17:06:00+00'
  );

select private.reconcile_related_email_conversion_photo_sources(
  '4501a2dc-0000-4000-8000-000000000010',
  '4501a2dc-0000-4000-8000-000000000020',
  '4501a2dc-0000-4000-8000-000000000030',
  'provider-thread-4501a2dc',
  repeat('a', 64)
);

do $contract$
declare
  v_reconciled_ids uuid[];
begin
  select array_agg(attachment_id order by call_order)
    into v_reconciled_ids
    from private.reconciled_attachment_probe;

  if v_reconciled_ids is distinct from array[
    '4501a2dc-0000-4000-8000-000000000001'::uuid,
    '4501a2dc-0000-4000-8000-000000000002'::uuid
  ] then
    raise exception 'valid related attachments were not reconciled in deterministic order: %',
      v_reconciled_ids;
  end if;
end;
$contract$;

truncate table private.reconciled_attachment_probe restart identity;

select private.reconcile_related_email_conversion_photo_sources(
  '4501a2dc-0000-4000-8000-000000000010',
  '4501a2dc-0000-4000-8000-000000000020',
  '4501a2dc-0000-4000-8000-000000000030',
  'provider-thread-4501a2dc',
  null
);

select private.reconcile_related_email_conversion_photo_sources(
  '4501a2dc-0000-4000-8000-000000000010',
  '4501a2dc-0000-4000-8000-000000000020',
  '4501a2dc-0000-4000-8000-000000000030',
  'provider-thread-4501a2dc',
  repeat('a', 63)
);

select private.reconcile_related_email_conversion_photo_sources(
  '4501a2dc-0000-4000-8000-000000000010',
  '4501a2dc-0000-4000-8000-000000000020',
  '4501a2dc-0000-4000-8000-000000000030',
  'provider-thread-4501a2dc',
  repeat('A', 64)
);

do $contract$
begin
  if exists (select 1 from private.reconciled_attachment_probe) then
    raise exception 'invalid content hash did not short-circuit reconciliation';
  end if;
end;
$contract$;

rollback;
