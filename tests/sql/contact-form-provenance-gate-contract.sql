-- CONTACT-FORM DRAFT PROVENANCE — BEHAVIOR CONTRACT
--
-- ISOLATED DATABASE ONLY. Applies the two forward migrations and exercises
-- (a) the structural marker mirror against the same fixtures the TypeScript
-- parser is asserted on in tests/unit/email/contact-form-provenance-gate.test.ts
-- and (b) the deterministic source-invalid skip in the failure RPC.
-- Every schema and role change is rolled back.

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
create schema auth;

create function auth.jwt()
returns jsonb
language sql
stable
as $function$
  select jsonb_build_object(
    'role',
    nullif(current_setting('contract.auth_role', true), '')
  );
$function$;

-- Column-faithful composite shells for every `%rowtype` declared by the first
-- migration. PostgreSQL resolves those composite types when CREATE FUNCTION
-- runs, not on first execution. Keeping the fixtures ahead of the migration
-- makes this contract match production compilation while still avoiding the
-- unrelated lead and mail schemas the function is never asked to execute on.
create table public.opportunities (
  id uuid primary key,
  company_id uuid not null,
  assigned_to uuid,
  assignment_version bigint not null default 1,
  deleted_at timestamptz,
  archived_at timestamptz,
  stage text,
  source text,
  source_thread_key text,
  client_ref uuid,
  client_id uuid,
  contact_name text
);

create table public.opportunity_assignment_events (
  id uuid primary key,
  opportunity_id uuid not null,
  company_id uuid not null,
  assignment_version bigint not null,
  new_assignee_id uuid
);

create table public.activities (
  id uuid primary key,
  company_id uuid,
  opportunity_id uuid,
  email_connection_id uuid,
  email_message_id text,
  type text,
  direction text,
  match_needs_review boolean,
  email_thread_id text,
  from_email text,
  body_text text,
  created_at timestamptz,
  subject text
);

create table public.email_connections (
  id uuid primary key,
  company_id text,
  provider text,
  status text,
  sync_enabled boolean,
  type text,
  user_id text
);

create table public.clients (
  id uuid primary key,
  company_id uuid,
  deleted_at timestamptz,
  name text
);

create table public.users (
  id uuid primary key,
  company_id uuid,
  deleted_at timestamptz,
  is_active boolean
);

-- ── Migration 1: marker mirror + gated enqueue ────────────────────────────
\ir ../../supabase/migrations/20260830113100_contact_form_enqueue_provenance_gate.sql

do $contract$
declare
  v_helper regprocedure :=
    'private.email_contact_form_source_markers_present(text,text)'::regprocedure;
  v_enqueue regprocedure :=
    'private.enqueue_email_assignment_contact_form_draft(uuid,uuid)'::regprocedure;
begin
  if has_function_privilege('anon', v_helper, 'execute')
    or has_function_privilege('authenticated', v_helper, 'execute')
    or has_function_privilege('service_role', v_helper, 'execute')
  then
    raise exception 'contact-form marker helper is executable by an API role';
  end if;
  if has_function_privilege('anon', v_enqueue, 'execute')
    or has_function_privilege('authenticated', v_enqueue, 'execute')
    or has_function_privilege('service_role', v_enqueue, 'execute')
  then
    raise exception 'contact-form enqueue is executable by an API role';
  end if;
end;
$contract$;

do $contract$
declare
  v_ordinary_forward_subject text := 'Fwd: Deck rebuild';
  v_ordinary_forward_body text :=
    E'Passing this along.\n' ||
    E'\n' ||
    E'---------- Forwarded message ---------\n' ||
    E'From: Jane Doe <jane.doe@example.com>\n' ||
    E'Date: Wed, 20 Aug 2026 at 09:12\n' ||
    E'Subject: Deck rebuild\n' ||
    E'To: Victoria <victoria@canprodeckandrail.com>\n' ||
    E'\n' ||
    E'Hi, we are hoping to rebuild our back deck this fall. Are you taking new\n' ||
    E'work in Langley? Thanks, Jane';
  v_platform_form_subject text := 'New contact form submission';
  v_platform_form_body text :=
    E'A site visitor just submitted your form.\n' ||
    E'\n' ||
    E'Submission Summary\n' ||
    E'Name: Jane Doe\n' ||
    E'Email: jane.doe@example.com\n' ||
    E'Phone: 604-555-0134\n' ||
    E'Message: Looking for a deck rebuild in Langley this fall.\n' ||
    E'\n' ||
    E'View Submissions';
  v_labeled_form_subject text := 'Quote request';
  v_labeled_form_body text :=
    E'Name: Bob Marsh\n' ||
    E'Email: bob.marsh@example.com\n' ||
    E'Message: Need a railing quote for a 24ft deck.';
begin
  -- The production defect: an ordinary forward carries no form marker at all.
  if private.email_contact_form_source_markers_present(
       v_ordinary_forward_subject,
       v_ordinary_forward_body
     ) then
    raise exception 'ordinary forward was accepted as a contact-form source';
  end if;

  -- A platform body marker alone is sufficient provenance.
  if not private.email_contact_form_source_markers_present(
       v_platform_form_subject,
       v_platform_form_body
     ) then
    raise exception 'platform contact-form notification was rejected';
  end if;

  -- A generic subject is accepted only alongside a labeled submitter email.
  if not private.email_contact_form_source_markers_present(
       v_labeled_form_subject,
       v_labeled_form_body
     ) then
    raise exception 'labeled contact-form submission was rejected';
  end if;
  if private.email_contact_form_source_markers_present(
       'Deck rebuild',
       v_labeled_form_body
     ) then
    raise exception 'labeled body was accepted without a form subject marker';
  end if;
  if private.email_contact_form_source_markers_present(
       v_labeled_form_subject,
       E'Name: Bob Marsh\nMessage: Need a railing quote.'
     ) then
    raise exception 'form subject was accepted without a labeled submitter email';
  end if;

  -- A reply that quotes an entire form notification stays ordinary mail.
  if private.email_contact_form_source_markers_present(
       'Re: New contact form submission',
       v_platform_form_body
     ) then
    raise exception 'quoted form notification in a reply was accepted';
  end if;

  -- STRICT: a NULL input yields NULL, which is why the enqueue gate wraps the
  -- call in coalesce(..., false) instead of trusting a bare boolean.
  if private.email_contact_form_source_markers_present(
       null,
       v_platform_form_body
     ) is not null then
    raise exception 'marker helper is not strict';
  end if;
end;
$contract$;

-- ── Migration 2: deterministic source-invalid skip ────────────────────────
-- Column-faithful shells for exactly the relations the failure RPC touches.
create table public.email_assignment_contact_form_draft_queue (
  id uuid primary key default gen_random_uuid(),
  assignment_event_id uuid not null,
  company_id uuid not null,
  opportunity_id uuid not null,
  assignment_version bigint not null,
  actor_user_id uuid not null,
  connection_id uuid not null,
  source_activity_id uuid not null,
  provider_message_id text not null,
  source_provider_thread_id text not null,
  customer_email text not null,
  customer_name text,
  source_subject text not null,
  source_body_text text not null,
  draft_history_id uuid,
  mailbox_draft_id text,
  outreach_provider_thread_id text,
  provider_create_attempt_id uuid,
  provider_create_started_at timestamptz,
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'retrying', 'completed', 'skipped', 'failed', 'stale',
    'reconciliation_required'
  )),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_holder text,
  lease_expires_at timestamptz,
  mailbox_busy_since timestamptz,
  completed_at timestamptz,
  result_reason text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_event_id),
  constraint email_assignment_contact_form_draft_lease_shape check (
    (status = 'processing' and lease_holder is not null and lease_expires_at is not null)
    or
    (status <> 'processing' and lease_holder is null and lease_expires_at is null)
  ),
  -- The deployed constraint, which had no terminal reason for a source that is
  -- not a contact form. The migration below must widen it.
  constraint email_assignment_contact_form_draft_completion_shape check (
    (
      status = 'completed'
      and completed_at is not null
      and draft_history_id is not null
      and nullif(btrim(mailbox_draft_id), '') is not null
      and nullif(btrim(outreach_provider_thread_id), '') is not null
      and provider_create_attempt_id is not null
      and provider_create_started_at is not null
      and result_reason = 'drafted'
    )
    or (
      status = 'skipped'
      and completed_at is not null
      and mailbox_draft_id is null
      and outreach_provider_thread_id is null
      and result_reason in (
        'autonomy_ineligible',
        'draft_unavailable',
        'lead_terminal',
        'already_replied'
      )
    )
    or (
      status = 'reconciliation_required'
      and completed_at is not null
      and provider_create_attempt_id is not null
      and provider_create_started_at is not null
      and result_reason = 'provider_reconciliation_required'
    )
    or (
      status not in ('completed', 'skipped', 'reconciliation_required')
      and completed_at is null
      and result_reason is null
    )
  )
);

\ir ../../supabase/migrations/20260830113200_contact_form_deterministic_source_invalid_skip.sql

insert into public.opportunities (id, company_id, assigned_to, assignment_version)
values (
  '57567bec-0000-4000-8000-000000000020',
  '57567bec-0000-4000-8000-000000000010',
  '57567bec-0000-4000-8000-000000000040',
  7
);

insert into public.opportunity_assignment_events (
  id, opportunity_id, company_id, assignment_version, new_assignee_id
)
values
  (
    '57567bec-0000-4000-8000-000000000050',
    '57567bec-0000-4000-8000-000000000020',
    '57567bec-0000-4000-8000-000000000010',
    7,
    '57567bec-0000-4000-8000-000000000040'
  ),
  (
    '57567bec-0000-4000-8000-000000000051',
    '57567bec-0000-4000-8000-000000000020',
    '57567bec-0000-4000-8000-000000000010',
    7,
    '57567bec-0000-4000-8000-000000000040'
  ),
  (
    '57567bec-0000-4000-8000-000000000052',
    '57567bec-0000-4000-8000-000000000020',
    '57567bec-0000-4000-8000-000000000010',
    7,
    '57567bec-0000-4000-8000-000000000040'
  );

insert into public.email_assignment_contact_form_draft_queue (
  id,
  assignment_event_id,
  company_id,
  opportunity_id,
  assignment_version,
  actor_user_id,
  connection_id,
  source_activity_id,
  provider_message_id,
  source_provider_thread_id,
  customer_email,
  source_subject,
  source_body_text,
  status,
  attempts,
  lease_holder,
  lease_expires_at,
  provider_create_attempt_id,
  provider_create_started_at
)
values
  -- The 1d22512e shape: a forward that will never parse. No provider write.
  (
    '57567bec-0000-4000-8000-000000000060',
    '57567bec-0000-4000-8000-000000000050',
    '57567bec-0000-4000-8000-000000000010',
    '57567bec-0000-4000-8000-000000000020',
    7,
    '57567bec-0000-4000-8000-000000000040',
    '57567bec-0000-4000-8000-000000000030',
    '57567bec-0000-4000-8000-000000000070',
    'provider-message-forward',
    'provider-thread-forward',
    'jane.doe@example.com',
    'Fwd: Deck rebuild',
    'Passing this along.',
    'processing',
    1,
    'contract-worker',
    now() + interval '5 minutes',
    null,
    null
  ),
  -- Same deterministic error, but a provider create already began.
  (
    '57567bec-0000-4000-8000-000000000061',
    '57567bec-0000-4000-8000-000000000051',
    '57567bec-0000-4000-8000-000000000010',
    '57567bec-0000-4000-8000-000000000020',
    7,
    '57567bec-0000-4000-8000-000000000040',
    '57567bec-0000-4000-8000-000000000030',
    '57567bec-0000-4000-8000-000000000071',
    'provider-message-durable',
    'provider-thread-durable',
    'jane.doe@example.com',
    'Fwd: Deck rebuild',
    'Passing this along.',
    'processing',
    1,
    'contract-worker',
    now() + interval '5 minutes',
    '57567bec-0000-4000-8000-000000000080',
    now() - interval '1 minute'
  ),
  -- An ordinary transport failure must still retry.
  (
    '57567bec-0000-4000-8000-000000000062',
    '57567bec-0000-4000-8000-000000000052',
    '57567bec-0000-4000-8000-000000000010',
    '57567bec-0000-4000-8000-000000000020',
    7,
    '57567bec-0000-4000-8000-000000000040',
    '57567bec-0000-4000-8000-000000000030',
    '57567bec-0000-4000-8000-000000000072',
    'provider-message-transport',
    'provider-thread-transport',
    'jane.doe@example.com',
    'New contact form submission',
    'Submission Summary',
    'processing',
    1,
    'contract-worker',
    now() + interval '5 minutes',
    null,
    null
  );

do $contract$
declare
  v_status text;
  v_row public.email_assignment_contact_form_draft_queue%rowtype;
begin
  perform set_config('contract.auth_role', 'anon', true);
  begin
    v_status := public.fail_email_assignment_contact_form_draft_as_system(
      '57567bec-0000-4000-8000-000000000060',
      'contract-worker',
      'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_SOURCE_INVALID'
    );
    raise exception 'failure RPC accepted a non-service role';
  exception
    when sqlstate '42501' then
      null;
  end;
  perform set_config('contract.auth_role', 'service_role', true);

  v_status := public.fail_email_assignment_contact_form_draft_as_system(
    '57567bec-0000-4000-8000-000000000060',
    'contract-worker',
    'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_SOURCE_INVALID'
  );
  if v_status is distinct from 'skipped' then
    raise exception 'deterministic source-invalid did not skip: %', v_status;
  end if;

  select queue.* into v_row
    from public.email_assignment_contact_form_draft_queue queue
   where queue.id = '57567bec-0000-4000-8000-000000000060';

  if v_row.result_reason is distinct from 'not_contact_form' then
    raise exception 'skip reason is wrong: %', v_row.result_reason;
  end if;
  if v_row.completed_at is null then
    raise exception 'deterministic skip was not terminalized';
  end if;
  if v_row.attempts <> 1 then
    raise exception 'deterministic skip consumed extra attempts: %', v_row.attempts;
  end if;
  if v_row.lease_holder is not null or v_row.lease_expires_at is not null then
    raise exception 'deterministic skip left a lease behind';
  end if;
  if v_row.mailbox_busy_since is not null then
    raise exception 'deterministic skip opened a mailbox wait';
  end if;

  -- A durable provider-create attempt still outranks the deterministic skip.
  v_status := public.fail_email_assignment_contact_form_draft_as_system(
    '57567bec-0000-4000-8000-000000000061',
    'contract-worker',
    'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_SOURCE_INVALID'
  );
  if v_status is distinct from 'reconciliation_required' then
    raise exception 'durable provider attempt was skipped instead of reconciled: %',
      v_status;
  end if;

  -- Transport failures keep their retry ladder.
  v_status := public.fail_email_assignment_contact_form_draft_as_system(
    '57567bec-0000-4000-8000-000000000062',
    'contract-worker',
    'ECONNRESET talking to the provider'
  );
  if v_status is distinct from 'retrying' then
    raise exception 'ordinary transport failure stopped retrying: %', v_status;
  end if;
end;
$contract$;

-- The widened constraint accepts the new terminal reason and nothing more.
do $contract$
begin
  begin
    update public.email_assignment_contact_form_draft_queue queue
       set status = 'skipped',
           completed_at = now(),
           result_reason = 'some_new_reason',
           lease_holder = null,
           lease_expires_at = null
     where queue.id = '57567bec-0000-4000-8000-000000000062';
    raise exception 'completion-shape constraint accepted an unknown skip reason';
  exception
    when check_violation then
      null;
  end;
end;
$contract$;

rollback;
