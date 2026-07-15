begin;

-- Phase C keeps the authored message, provider-rendered signature, and learned
-- preferences as separate data. Signatures in this table have already passed
-- the application sanitizer; the database rejects the highest-risk markup so
-- an unsafe caller cannot persist executable content by bypassing that layer.
create or replace function private.email_signature_content_is_safe(
  p_content_html text,
  p_content_text text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select
    coalesce(nullif(btrim(p_content_html), ''), nullif(btrim(p_content_text), '')) is not null
    and length(coalesce(p_content_html, '')) <= 65536
    and length(coalesce(p_content_text, '')) <= 65536
    and coalesce(p_content_html, '') !~* '<[[:space:]]*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)([[:space:]>]|$)'
    and coalesce(p_content_html, '') !~* '(^|[[:space:]<])on[a-z0-9_-]+[[:space:]]*='
    and coalesce(p_content_html, '') !~* '(javascript|vbscript)[[:space:]]*:'
    and coalesce(p_content_html, '') !~* 'data[[:space:]]*:[[:space:]]*(text/html|image/svg\+xml)'
    -- Reject encoded syntax that could turn into an attribute name, quote, or
    -- executable URL after a downstream HTML entity decode. Common inert
    -- typography entities remain usable; every other named entity fails shut.
    and coalesce(p_content_html, '') !~* '&#([0-9]+|x[0-9a-f]+);'
    and regexp_replace(
          coalesce(p_content_html, ''),
          '&(amp|lt|gt|quot|apos|nbsp);',
          '',
          'gi'
        ) !~* '&[a-z][a-z0-9]+;'
    and coalesce(p_content_html, '') !~* 'url[[:space:]]*\('
    and coalesce(p_content_html, '') !~* 'expression[[:space:]]*\('
    and coalesce(p_content_html, '') !~* '@import'
    and coalesce(p_content_html, '') !~* 'behavior[[:space:]]*:'
    and coalesce(p_content_html, '') !~* '-moz-binding[[:space:]]*:';
$$;

revoke all on function private.email_signature_content_is_safe(text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.email_signature_content_is_safe(text, text)
  to service_role;

create table public.email_signatures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.email_connections(id) on delete cascade,
  scope_user_id uuid references public.users(id) on delete cascade,
  source text not null
    check (source in ('ops', 'gmail_send_as', 'microsoft_confirmed')),
  content_html text,
  content_text text,
  content_hash text not null
    check (content_hash ~ '^[0-9a-f]{64}$'),
  provider_identity text
    check (provider_identity is null or btrim(provider_identity) <> ''),
  active boolean not null default true,
  fetched_at timestamptz,
  confirmed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (private.email_signature_content_is_safe(content_html, content_text)),
  check (source = 'ops' or provider_identity is not null),
  check (source <> 'gmail_send_as' or fetched_at is not null),
  check (source <> 'microsoft_confirmed' or confirmed_at is not null)
);

comment on table public.email_signatures is
  'Sanitized, mailbox-scoped signatures. OPS rows override provider rows at resolution time.';
comment on column public.email_signatures.content_hash is
  'Lowercase SHA-256 of the canonical sanitized HTML/text pair; used for append-once rendering.';
comment on column public.email_signatures.scope_user_id is
  'Operator scope. NULL is the mailbox-wide fallback for a company connection.';

create unique index email_signatures_active_scope_source_unique
  on public.email_signatures (
    company_id,
    connection_id,
    scope_user_id,
    source
  ) nulls not distinct
  where active;

create index email_signatures_effective_lookup_idx
  on public.email_signatures (
    company_id,
    connection_id,
    scope_user_id,
    active,
    source
  );

create or replace function private.enforce_email_signature_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_connection public.email_connections%rowtype;
  v_expected_content_hash text;
begin
  select c.*
  into v_connection
  from public.email_connections c
  where c.id = new.connection_id
  for share;

  if v_connection.id is null
    or v_connection.company_id <> new.company_id::text
  then
    raise exception 'email signature connection does not belong to company';
  end if;

  if new.scope_user_id is not null and not exists (
    select 1
    from public.users u
    where u.id = new.scope_user_id
      and u.company_id = new.company_id
  ) then
    raise exception 'email signature scope user does not belong to company';
  end if;

  if v_connection.type = 'individual'
    and nullif(btrim(v_connection.user_id), '') is not null
    and new.scope_user_id is not null
    and new.scope_user_id::text <> v_connection.user_id
  then
    raise exception 'email signature scope user does not own individual connection';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users u
    where u.id = new.created_by
      and u.company_id = new.company_id
  ) then
    raise exception 'email signature creator does not belong to company';
  end if;

  if new.updated_by is not null and not exists (
    select 1
    from public.users u
    where u.id = new.updated_by
      and u.company_id = new.company_id
  ) then
    raise exception 'email signature updater does not belong to company';
  end if;

  if not private.email_signature_content_is_safe(
    new.content_html,
    new.content_text
  ) then
    raise exception 'email signature content contains unsafe markup';
  end if;

  v_expected_content_hash := encode(
    extensions.digest(
      convert_to(
        coalesce(new.content_html, '')
          || chr(0)
          || coalesce(new.content_text, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if new.content_hash is distinct from v_expected_content_hash then
    raise exception 'email signature content hash does not match canonical content';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
  else
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_email_signature_tenant_integrity()
  from public, anon, authenticated, service_role;

create trigger email_signatures_tenant_integrity
before insert or update on public.email_signatures
for each row
execute function private.enforce_email_signature_tenant_integrity();

alter table public.email_signatures enable row level security;
alter table public.email_signatures force row level security;

revoke all on table public.email_signatures
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.email_signatures
  to service_role;

-- Signature edits are append-only at the content level. The prior active row
-- remains available as an inactive revision so flattened provider drafts can
-- strip both the current and any previously rendered OPS signature exactly.
create or replace function public.replace_email_signature(
  p_company_id uuid,
  p_connection_id uuid,
  p_scope_user_id uuid,
  p_source text,
  p_content_html text,
  p_content_text text,
  p_content_hash text,
  p_provider_identity text,
  p_fetched_at timestamptz,
  p_confirmed_at timestamptz,
  p_actor_user_id uuid
)
returns public.email_signatures
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_signature public.email_signatures%rowtype;
  v_lock_key text;
begin
  if p_source not in ('ops', 'gmail_send_as', 'microsoft_confirmed') then
    raise exception 'email signature source is invalid';
  end if;

  v_lock_key := 'email-signature:'
    || p_company_id::text || ':'
    || p_connection_id::text || ':'
    || coalesce(p_scope_user_id::text, 'mailbox') || ':'
    || p_source;
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  select s.*
  into v_signature
  from public.email_signatures s
  where s.company_id = p_company_id
    and s.connection_id = p_connection_id
    and s.scope_user_id is not distinct from p_scope_user_id
    and s.source = p_source
    and s.active
  order by s.created_at desc, s.id desc
  limit 1
  for update;

  if v_signature.id is not null
    and v_signature.content_hash = p_content_hash
    and v_signature.provider_identity is not distinct from p_provider_identity
  then
    update public.email_signatures s
    set fetched_at = coalesce(p_fetched_at, s.fetched_at),
        confirmed_at = coalesce(p_confirmed_at, s.confirmed_at),
        updated_by = p_actor_user_id
    where s.id = v_signature.id
    returning * into v_signature;

    return v_signature;
  end if;

  update public.email_signatures s
  set active = false,
      updated_by = p_actor_user_id
  where s.company_id = p_company_id
    and s.connection_id = p_connection_id
    and s.scope_user_id is not distinct from p_scope_user_id
    and s.source = p_source
    and s.active;

  insert into public.email_signatures (
    company_id,
    connection_id,
    scope_user_id,
    source,
    content_html,
    content_text,
    content_hash,
    provider_identity,
    active,
    fetched_at,
    confirmed_at,
    created_by,
    updated_by
  )
  values (
    p_company_id,
    p_connection_id,
    p_scope_user_id,
    p_source,
    p_content_html,
    p_content_text,
    p_content_hash,
    p_provider_identity,
    true,
    p_fetched_at,
    p_confirmed_at,
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into v_signature;

  return v_signature;
end;
$$;

revoke all on function public.replace_email_signature(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.replace_email_signature(uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid) to service_role;

-- Queue provenance explicitly separates operator-approved evidence from purely
-- autonomous sends. The CHECK lets an autonomous job complete its sent-state
-- bookkeeping while preventing it from carrying profile/memory mutations.
-- Keep these column-local CHECKs on the conditional ADD COLUMN statements.
-- Fresh installs already receive the same generated constraint names from 2050,
-- while upgrades from the pre-provenance queue create each column and CHECK once.
alter table public.email_outbound_learning_queue
  add column if not exists profile_type text not null default 'general'
    check (btrim(profile_type) <> '' and length(profile_type) <= 64),
  add column if not exists learning_authority text not null default 'autonomous'
    check (
      learning_authority in (
        'operator_authored',
        'operator_approved',
        'autonomous'
      )
    ),
  add column if not exists apply_full_body_learning boolean;

-- If this additive migration is applied after workers have already populated
-- the preceding migration, fail closed: old jobs did not record human
-- authority, so they may finish but may not create further learning effects.
update public.email_outbound_learning_queue
set apply_learning = false,
    apply_full_body_learning = false,
    writing_sample = null,
    memory_extraction = null,
    draft_correction_facts = '[]'::jsonb,
    updated_at = now()
where learning_authority = 'autonomous'
  and apply_learning is true
  and status <> 'completed';

update public.email_outbound_learning_queue
set apply_full_body_learning = false,
    updated_at = now()
where apply_full_body_learning is null
  and prepared_at is not null
  and status <> 'completed';

alter table public.email_outbound_memory_evidence
  alter column writing_sample_id drop not null;

alter table public.email_outbound_learning_queue
  add constraint email_outbound_learning_queue_autonomous_no_learning_check
    check (
      (
        status = 'completed'
        and applied_at is not null
        and completed_at is not null
      )
      or learning_authority <> 'autonomous'
      or apply_learning is not true
    ),
  add constraint email_outbound_learning_queue_profile_payload_check
    check (
      writing_sample is null
      or writing_sample ->> 'profileType' = profile_type
    ),
  add constraint email_outbound_learning_queue_full_body_authority_check
    check (
      apply_full_body_learning is not true
      or learning_authority = 'operator_authored'
    ),
  add constraint email_outbound_learning_queue_full_body_learning_check
    check (
      apply_full_body_learning is not true
      or apply_learning is true
    ),
  add constraint email_outbound_learning_queue_full_body_payload_check
    check (
      apply_full_body_learning is not true
      or (writing_sample is not null and memory_extraction is not null)
    ),
  add constraint email_outbound_learning_queue_prepared_full_body_decision_check
    check (
      status = 'completed'
      or prepared_at is null
      or apply_full_body_learning is not null
    );

alter table public.agent_writing_profiles
  add column if not exists subject_preferences jsonb not null default '{}'::jsonb;

alter table public.agent_writing_profiles
  add constraint agent_writing_profiles_subject_preferences_object_check
    check (jsonb_typeof(subject_preferences) = 'object');

-- Subject provenance is consumed independently from body-style authority.
-- Preserve the legacy generated/operator values while adding deterministic
-- thread/configured/fallback and threshold-promoted learned sources.
alter table public.ai_draft_history
  drop constraint if exists ai_draft_history_subject_source_check;

alter table public.ai_draft_history
  add constraint ai_draft_history_subject_source_check
    check (
      subject_source is null
      or subject_source in (
        'thread',
        'operator',
        'configured',
        'generated',
        'learned',
        'fallback'
      )
    );

comment on column public.ai_draft_history.subject_source is
  'Subject provenance: thread reuse, operator entry/edit, configured rule, AI-generated or learned new-thread subject, or deterministic fallback.';

-- Replace the old enqueue surface rather than overloading it. Two functions
-- whose trailing arguments both have defaults make PostgREST calls ambiguous.
alter function public.enqueue_email_outbound_learning(
  text,
  uuid,
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  text,
  timestamptz,
  uuid,
  uuid,
  uuid,
  text
) rename to enqueue_email_outbound_learning_legacy_internal;

revoke all on function public.enqueue_email_outbound_learning_legacy_internal(
  text,
  uuid,
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  text,
  timestamptz,
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;

create or replace function public.enqueue_email_outbound_learning(
  p_company_id text,
  p_connection_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text default null,
  p_user_id text default null,
  p_from_email text default null,
  p_to_emails text[] default null,
  p_subject text default null,
  p_authored_body text default null,
  p_clean_body text default null,
  p_occurred_at timestamptz default null,
  p_draft_history_id uuid default null,
  p_follow_up_draft_id uuid default null,
  p_opportunity_id uuid default null,
  p_draft_delivery_channel text default null,
  p_profile_type text default 'general',
  p_learning_authority text default 'autonomous'
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_row public.email_outbound_learning_queue;
  v_connection public.email_connections%rowtype;
  v_user public.users%rowtype;
  v_draft public.ai_draft_history%rowtype;
  v_activity public.activities%rowtype;
  v_profile_type text := nullif(btrim(p_profile_type), '');
  v_requested_authority text := nullif(btrim(p_learning_authority), '');
  v_verified_authority text := 'autonomous';
  v_has_auto_send boolean := false;
  v_existing_authority_rank integer;
  v_verified_authority_rank integer;
begin
  if v_profile_type is null or length(v_profile_type) > 64 then
    raise exception 'outbound learning profile type is invalid';
  end if;

  if v_requested_authority not in (
    'operator_authored',
    'operator_approved',
    'autonomous'
  ) then
    raise exception 'outbound learning authority is invalid';
  end if;

  v_row := public.enqueue_email_outbound_learning_legacy_internal(
    p_company_id,
    p_connection_id,
    p_provider_message_id,
    p_provider_thread_id,
    p_user_id,
    p_from_email,
    p_to_emails,
    p_subject,
    p_authored_body,
    p_clean_body,
    p_occurred_at,
    p_draft_history_id,
    p_follow_up_draft_id,
    p_opportunity_id,
    p_draft_delivery_channel
  );

  select q.*
  into v_row
  from public.email_outbound_learning_queue q
  where q.id = v_row.id
  for update;

  -- Caller-supplied authority is only a request. Derive the effective rank
  -- from tenant-bound rows that cannot be forged through this RPC.
  select c.*
  into v_connection
  from public.email_connections c
  where c.id = v_row.connection_id
    and c.company_id = v_row.company_id
  for share;

  select u.*
  into v_user
  from public.users u
  where u.id::text = v_row.user_id
    and u.company_id::text = v_row.company_id
    and coalesce(u.is_active, true)
    and u.deleted_at is null
  for share;

  select a.*
  into v_activity
  from public.activities a
  where a.company_id = v_row.company_id
    and a.email_connection_id = p_connection_id
    and a.email_message_id = p_provider_message_id
    and lower(a.type) = 'email'
    and a.direction = 'outbound'
  order by a.created_at desc, a.id desc
  limit 1
  for share;

  if v_row.draft_history_id is not null then
    select d.*
    into v_draft
    from public.ai_draft_history d
    where d.id = v_row.draft_history_id
      and d.company_id::text = v_row.company_id
      and d.connection_id = v_row.connection_id
      and d.user_id::text = v_row.user_id
    for share;

    select exists (
      select 1
      from public.pending_auto_sends pas
      where pas.company_id::text = v_row.company_id
        and pas.connection_id = v_row.connection_id
        and pas.draft_history_id = v_row.draft_history_id
        and pas.status in ('pending', 'sent')
    ) into v_has_auto_send;
  end if;

  if v_requested_authority = 'operator_approved'
    and v_draft.id is not null
    and not v_has_auto_send
    and (
      (
        v_row.draft_delivery_channel = 'ops_send'
        and v_activity.id is not null
        and v_activity.draft_history_id = v_row.draft_history_id
        and v_activity.created_by::text = v_row.user_id
      )
      or (
        v_row.draft_delivery_channel = 'mailbox'
        and nullif(btrim(v_draft.mailbox_draft_id), '') is not null
        and v_activity.id is not null
        and v_activity.created_at > v_draft.created_at
        and (
          nullif(btrim(v_draft.thread_id), '') is null
          or v_activity.email_thread_id = v_draft.thread_id
        )
      )
    )
  then
    v_verified_authority := 'operator_approved';
  elsif v_requested_authority = 'operator_authored'
    and v_draft.id is null
    and v_row.draft_history_id is null
    and (
      (
        v_activity.id is not null
        and v_activity.created_by::text = v_row.user_id
      )
      or (
        v_connection.type = 'individual'
        and v_connection.user_id = v_row.user_id
        and lower(btrim(v_connection.email)) = lower(btrim(v_row.from_email))
      )
      or (
        v_connection.type <> 'individual'
        and v_user.id is not null
        and lower(btrim(v_user.email)) = lower(btrim(v_row.from_email))
        and lower(btrim(v_connection.email)) = lower(btrim(v_row.from_email))
      )
    )
  then
    v_verified_authority := 'operator_authored';
  end if;

  v_existing_authority_rank := case v_row.learning_authority
    when 'operator_authored' then 3
    when 'operator_approved' then 2
    else 1
  end;
  v_verified_authority_rank := case v_verified_authority
    when 'operator_authored' then 3
    when 'operator_approved' then 2
    else 1
  end;

  if v_row.prepared_at is not null
    and v_row.profile_type <> v_profile_type
    and v_profile_type <> 'general'
  then
    raise exception 'outbound learning prepared profile type cannot change';
  end if;

  if v_row.prepared_at is null
    and v_row.profile_type <> 'general'
    and v_profile_type <> 'general'
    and v_row.profile_type <> v_profile_type
  then
    raise exception 'outbound learning profile type conflicts with queued provenance';
  end if;

  update public.email_outbound_learning_queue q
  set profile_type = case
        when q.prepared_at is null
          and q.profile_type = 'general'
          and v_profile_type <> 'general'
          then v_profile_type
        else q.profile_type
      end,
      learning_authority = case
        when v_verified_authority_rank > v_existing_authority_rank
          then v_verified_authority
        else q.learning_authority
      end,
      updated_at = now()
  where q.id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.enqueue_email_outbound_learning(
  text,
  uuid,
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  text,
  timestamptz,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_outbound_learning(text, uuid, text, text, text, text, text[], text, text, text, timestamptz, uuid, uuid, uuid, text, text, text) to service_role;

-- Literal, case-insensitive replacement avoids regex interpretation of names,
-- addresses, and opportunity titles while de-identifying learned subjects.
create or replace function private.replace_email_subject_literal(
  p_subject text,
  p_literal text,
  p_placeholder text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_result text := p_subject;
  v_needle text := nullif(btrim(p_literal), '');
  v_search_from integer := 1;
  v_relative_position integer;
  v_position integer;
  v_before text;
  v_after text;
begin
  if v_result is null or v_needle is null then
    return v_result;
  end if;

  loop
    v_relative_position := strpos(
      lower(substr(v_result, v_search_from)),
      lower(v_needle)
    );
    exit when v_relative_position = 0;
    v_position := v_search_from + v_relative_position - 1;

    v_before := case
      when v_position > 1 then substr(v_result, v_position - 1, 1)
      else ''
    end;
    v_after := substr(
      v_result,
      v_position + char_length(v_needle),
      1
    );

    if (
      substr(v_needle, 1, 1) ~ '[[:alnum:]_]'
      and v_before ~ '[[:alnum:]_]'
    ) or (
      substr(v_needle, char_length(v_needle), 1) ~ '[[:alnum:]_]'
      and v_after ~ '[[:alnum:]_]'
    ) then
      v_search_from := v_position + char_length(v_needle);
      continue;
    end if;

    v_result := substr(v_result, 1, v_position - 1)
      || p_placeholder
      || substr(v_result, v_position + char_length(v_needle));
    v_search_from := v_position + char_length(p_placeholder);
  end loop;

  return v_result;
end;
$$;

revoke all on function private.replace_email_subject_literal(text, text, text)
  from public, anon, authenticated, service_role;

-- Each human edit contributes one immutable evidence row. A separate unique
-- promotion receipt gates the profile mutation after the evidence threshold,
-- so retries, lease recovery, and duplicate provider events cannot apply the
-- same learned preference twice.
create table public.email_outbound_edit_evidence (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null
    references public.email_outbound_learning_queue(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  profile_type text not null
    check (btrim(profile_type) <> '' and length(profile_type) <= 64),
  evidence_kind text not null
    check (
      evidence_kind in (
        'greeting',
        'closing',
        'substitution',
        'tone',
        'structure',
        'subject'
      )
    ),
  source_type text not null
    check (btrim(source_type) <> '' and length(source_type) <= 64),
  evidence_key text not null
    check (evidence_key ~ '^[0-9a-f]{64}$'),
  pattern_value text not null
    check (btrim(pattern_value) <> '' and length(pattern_value) <= 500),
  from_value text,
  to_value text not null
    check (btrim(to_value) <> '' and length(to_value) <= 500),
  learning_authority text not null
    check (
      learning_authority in ('operator_authored', 'operator_approved')
    ),
  created_at timestamptz not null default now(),
  unique (queue_id, evidence_kind, evidence_key)
);

create index email_outbound_edit_evidence_pattern_idx
  on public.email_outbound_edit_evidence (
    company_id,
    user_id,
    profile_type,
    evidence_kind,
    evidence_key,
    created_at desc
  );

create table public.email_outbound_edit_promotions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  profile_id uuid not null
    references public.agent_writing_profiles(id) on delete cascade,
  profile_type text not null,
  evidence_kind text not null,
  evidence_key text not null,
  pattern_value text not null,
  evidence_count integer not null check (evidence_count > 0),
  threshold integer not null check (threshold in (3, 5)),
  promoted_by_queue_id uuid not null
    references public.email_outbound_learning_queue(id) on delete restrict,
  promoted_at timestamptz not null default now(),
  unique (company_id, user_id, profile_type, evidence_kind, evidence_key)
);

create index email_outbound_edit_promotions_profile_idx
  on public.email_outbound_edit_promotions (profile_id, promoted_at desc);

alter table public.email_outbound_edit_evidence enable row level security;
alter table public.email_outbound_edit_evidence force row level security;
alter table public.email_outbound_edit_promotions enable row level security;
alter table public.email_outbound_edit_promotions force row level security;

revoke all on table public.email_outbound_edit_evidence
  from public, anon, authenticated, service_role;
revoke all on table public.email_outbound_edit_promotions
  from public, anon, authenticated, service_role;

create or replace function public.promote_email_outbound_edit_learning(
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_job public.email_outbound_learning_queue%rowtype;
  v_draft public.ai_draft_history%rowtype;
  v_profile public.agent_writing_profiles%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_client public.clients%rowtype;
  v_change record;
  v_evidence public.email_outbound_edit_evidence%rowtype;
  v_evidence_id uuid;
  v_promotion_id uuid;
  v_evidence_key text;
  v_evidence_material text;
  v_pattern_value text;
  v_threshold integer;
  v_evidence_count integer;
  v_evidence_inserted integer := 0;
  v_promotions_inserted integer := 0;
  v_original_subject text;
  v_final_subject text;
  v_subject_pattern text;
  v_subject_token text;
  v_subject_qualifies boolean := false;
  v_greetings text[];
  v_closings text[];
  v_vocabulary jsonb;
  v_tone_traits jsonb;
  v_substitutions jsonb;
  v_paragraph_structure jsonb;
  v_subject_preferences jsonb;
  v_existing_patterns jsonb;
  v_preferred_patterns jsonb;
  v_examples jsonb;
  v_now timestamptz := now();
begin
  select q.*
  into v_job
  from public.email_outbound_learning_queue q
  where q.id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'outbound edit promotion job does not exist';
  end if;

  if v_job.status <> 'completed' then
    raise exception 'outbound edit promotion requires a completed job';
  end if;

  if v_job.learning_authority not in (
    'operator_authored',
    'operator_approved'
  ) or v_job.apply_learning is not true then
    return jsonb_build_object(
      'queueId', v_job.id,
      'evidenceInserted', 0,
      'promotionsInserted', 0,
      'skipped', true
    );
  end if;

  if v_job.draft_outcome is null
    or jsonb_typeof(v_job.draft_outcome -> 'changesMade') is distinct from 'array'
  then
    raise exception 'outbound edit promotion lacks a valid draft outcome';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_job.company_id || ':' || v_job.user_id, 0)
  );

  select p.*
  into v_profile
  from public.agent_writing_profiles p
  where p.company_id::text = v_job.company_id
    and p.user_id::text = v_job.user_id
    and p.profile_type = v_job.profile_type
  for update;

  if v_profile.id is null then
    raise exception 'outbound edit promotion writing profile does not exist';
  end if;

  if v_job.draft_history_id is not null then
    select d.*
    into v_draft
    from public.ai_draft_history d
    where d.id = v_job.draft_history_id
      and d.company_id::text = v_job.company_id
      and d.user_id::text = v_job.user_id
    for share;
  end if;

  if v_job.opportunity_id is not null then
    select o.*
    into v_opportunity
    from public.opportunities o
    where o.id = v_job.opportunity_id
      and o.company_id::text = v_job.company_id
    for share;

    if coalesce(v_opportunity.client_id, v_opportunity.client_ref) is not null then
      select c.*
      into v_client
      from public.clients c
      where c.id = coalesce(v_opportunity.client_id, v_opportunity.client_ref)
        and c.company_id::text = v_job.company_id
      for share;
    end if;
  end if;

  select
    subject_change.value ->> 'from',
    subject_change.value ->> 'to'
  into v_original_subject, v_final_subject
  from jsonb_array_elements(v_job.draft_outcome -> 'changesMade')
    as subject_change(value)
  where subject_change.value ->> 'type' = 'subject'
  order by subject_change.value ->> 'to'
  limit 1;

  v_final_subject := coalesce(
    nullif(btrim(v_final_subject), ''),
    nullif(btrim(v_job.subject), '')
  );

  -- New-thread subject evidence has no source message. Operator-authored
  -- subjects qualify directly; an operator-approved AI subject must have an
  -- explicit subject edit. Replies/forwards are excluded on both sides.
  v_subject_qualifies :=
    (
      (
        v_draft.id is not null
        and v_draft.source_message_id is null
        and v_draft.subject_source = 'operator'
        and v_job.learning_authority in ('operator_authored', 'operator_approved')
        and not (
          v_job.learning_authority = 'operator_approved'
          and not coalesce(
            (v_job.draft_outcome ->> 'subjectEdited')::boolean,
            false
          )
        )
      )
      or (
        v_draft.id is null
        and v_job.draft_history_id is null
        and v_job.learning_authority = 'operator_authored'
      )
    )
    and v_opportunity.id is not null
    and v_final_subject is not null
    and length(v_final_subject) <= 200
    and v_final_subject !~ '[[:cntrl:]]'
    and v_final_subject !~* '^(re|fw|fwd)\s*:'
    and (
      coalesce(v_original_subject, '') = ''
      or btrim(v_original_subject) !~* '^(re|fw|fwd)\s*:'
    );

  if v_subject_qualifies then
    -- Persist only a reusable, de-identified pattern. Raw subject text may
    -- contain another lead's name, address, project title, phone, or email and
    -- must never become a send-ready writing-profile candidate.
    v_subject_pattern := btrim(v_final_subject);
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_opportunity.title,
      '{project}'
    );
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_opportunity.contact_name,
      '{contact}'
    );
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_client.name,
      '{company}'
    );
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_opportunity.address,
      '{address}'
    );
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_client.address,
      '{address}'
    );
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_opportunity.contact_email,
      '{email}'
    );
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_client.email,
      '{email}'
    );
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_opportunity.contact_phone,
      '{number}'
    );
    v_subject_pattern := private.replace_email_subject_literal(
      v_subject_pattern,
      v_client.phone_number,
      '{number}'
    );

    -- Full-field replacement is not enough: operators commonly use only a
    -- contact's first name or one street/project token in a subject.
    for v_subject_token in
      select distinct token.value
      from regexp_split_to_table(
        coalesce(v_opportunity.contact_name, ''),
        '[^[:alnum:]''-]+'
      ) as token(value)
      where char_length(token.value) >= 2
      order by token.value
    loop
      v_subject_pattern := private.replace_email_subject_literal(
        v_subject_pattern,
        v_subject_token,
        '{contact}'
      );
    end loop;

    for v_subject_token in
      select distinct token.value
      from regexp_split_to_table(
        coalesce(v_client.name, ''),
        '[^[:alnum:]''-]+'
      ) as token(value)
      where char_length(token.value) >= 2
      order by token.value
    loop
      v_subject_pattern := private.replace_email_subject_literal(
        v_subject_pattern,
        v_subject_token,
        '{company}'
      );
    end loop;

    for v_subject_token in
      select distinct token.value
      from regexp_split_to_table(
        concat_ws(' ', v_opportunity.address, v_client.address),
        '[^[:alnum:]''-]+'
      ) as token(value)
      where char_length(token.value) >= 2
        and token.value !~ '^[[:digit:]]+$'
      order by token.value
    loop
      v_subject_pattern := private.replace_email_subject_literal(
        v_subject_pattern,
        v_subject_token,
        '{address}'
      );
    end loop;

    for v_subject_token in
      select distinct token.value
      from regexp_split_to_table(
        coalesce(v_opportunity.title, ''),
        '[^[:alnum:]''-]+'
      ) as token(value)
      where char_length(token.value) >= 3
        and lower(token.value) not in (
          'email', 'inquiry', 'lead', 'new', 'project', 'job', 'quote',
          'estimate', 'follow', 'following', 'for', 'the', 'and'
        )
      order by token.value
    loop
      v_subject_pattern := private.replace_email_subject_literal(
        v_subject_pattern,
        v_subject_token,
        '{project}'
      );
    end loop;

    v_subject_pattern := lower(regexp_replace(
      v_subject_pattern,
      '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}',
      '{email}',
      'gi'
    ));
    v_subject_pattern := regexp_replace(
      v_subject_pattern,
      '[[:digit:]]+',
      '{number}',
      'g'
    );
    v_subject_pattern := regexp_replace(
      btrim(v_subject_pattern),
      '[[:space:]]+',
      ' ',
      'g'
    );
    v_subject_qualifies := nullif(v_subject_pattern, '') is not null;
  end if;

  for v_change in
    with mapped_changes as (
      select
        case
          when change.value ->> 'type' = 'greeting' then 'greeting'
          when change.value ->> 'type' = 'closing' then 'closing'
          when change.value ->> 'type' = 'substitution' then 'substitution'
          when change.value ->> 'type' in (
            'tone_shift',
            'tone_exclamation',
            'formality_shift'
          ) then 'tone'
          when change.value ->> 'type' in (
            'structure',
            'structure_gpt',
            'length'
          ) then 'structure'
          else null
        end as evidence_kind,
        change.value ->> 'type' as source_type,
        nullif(btrim(change.value ->> 'from'), '') as from_value,
        nullif(btrim(change.value ->> 'to'), '') as to_value,
        null::text as subject_pattern
      from jsonb_array_elements(v_job.draft_outcome -> 'changesMade')
        as change(value)
      where change.value ->> 'type' <> 'subject'
    ), qualifying_changes as (
      select *
      from mapped_changes
      where evidence_kind is not null
        and to_value is not null
        and length(to_value) <= 500
        and (from_value is null or length(from_value) <= 500)
        and (
          evidence_kind <> 'substitution'
          or from_value is not null
        )
        and (
          evidence_kind <> 'substitution'
          or length(from_value) + length(to_value) <= 496
        )
      union all
      select
        'subject',
        'subject',
        null::text,
        v_subject_pattern,
        v_subject_pattern
      where v_subject_qualifies
    )
    select *
    from qualifying_changes
    order by evidence_kind, source_type, from_value, to_value
  loop
    v_evidence_material := case
      when v_change.evidence_kind = 'substitution' then
        lower(v_change.from_value) || ' -> ' || lower(v_change.to_value)
      when v_change.evidence_kind = 'subject' then
        v_change.subject_pattern
      when v_change.evidence_kind = 'structure'
        and lower(v_change.to_value) like '%bullet%' then
        'structure:bullets'
      when v_change.evidence_kind = 'structure'
        and lower(v_change.to_value) like '%prose%' then
        'structure:prose'
      when v_change.evidence_kind = 'structure'
        and lower(v_change.to_value) like '%shorten%' then
        'structure:shorter'
      when v_change.evidence_kind = 'structure'
        and lower(v_change.to_value) like '%lengthen%' then
        'structure:longer'
      when v_change.source_type = 'tone_exclamation'
        and substring(v_change.from_value from '^[0-9]+') is not null
        and substring(v_change.to_value from '^[0-9]+') is not null
        and substring(v_change.to_value from '^[0-9]+')::integer
          < substring(v_change.from_value from '^[0-9]+')::integer then
        'tone_exclamation:fewer'
      when v_change.source_type = 'tone_exclamation'
        and substring(v_change.from_value from '^[0-9]+') is not null
        and substring(v_change.to_value from '^[0-9]+') is not null
        and substring(v_change.to_value from '^[0-9]+')::integer
          > substring(v_change.from_value from '^[0-9]+')::integer then
        'tone_exclamation:more'
      else lower(v_change.source_type || ':' || v_change.to_value)
    end;
    v_pattern_value := left(v_evidence_material, 500);

    v_evidence_key := encode(
      extensions.digest(
        v_change.evidence_kind || ':' || v_evidence_material,
        'sha256'
      ),
      'hex'
    );

    v_threshold := case
      when v_change.evidence_kind in (
        'greeting',
        'closing',
        'substitution',
        'subject'
      ) then 3
      else 5
    end;

    v_evidence_id := null;
    insert into public.email_outbound_edit_evidence (
      queue_id,
      company_id,
      user_id,
      profile_type,
      evidence_kind,
      source_type,
      evidence_key,
      pattern_value,
      from_value,
      to_value,
      learning_authority,
      created_at
    )
    values (
      v_job.id,
      v_job.company_id::uuid,
      v_job.user_id::uuid,
      v_job.profile_type,
      v_change.evidence_kind,
      v_change.source_type,
      v_evidence_key,
      v_pattern_value,
      v_change.from_value,
      v_change.to_value,
      v_job.learning_authority,
      coalesce(v_job.completed_at, v_now)
    )
    on conflict (queue_id, evidence_kind, evidence_key) do nothing
    returning id into v_evidence_id;

    if v_evidence_id is null then
      continue;
    end if;

    v_evidence_inserted := v_evidence_inserted + 1;

    select e.*
    into v_evidence
    from public.email_outbound_edit_evidence e
    where e.id = v_evidence_id;

    select count(*)::integer
    into v_evidence_count
    from public.email_outbound_edit_evidence matching_evidence
    join (
      select e.queue_id, max(e.created_at) as last_evidence_at
      from public.email_outbound_edit_evidence e
      where e.company_id = v_evidence.company_id
        and e.user_id = v_evidence.user_id
        and e.profile_type = v_evidence.profile_type
      group by e.queue_id
      order by max(e.created_at) desc, e.queue_id desc
      limit 20
    ) recent_outcomes
      on recent_outcomes.queue_id = matching_evidence.queue_id
    where matching_evidence.evidence_kind = v_evidence.evidence_kind
      and matching_evidence.evidence_key = v_evidence.evidence_key;

    if v_evidence_count < v_threshold then
      continue;
    end if;

    v_promotion_id := null;
    insert into public.email_outbound_edit_promotions (
      company_id,
      user_id,
      profile_id,
      profile_type,
      evidence_kind,
      evidence_key,
      pattern_value,
      evidence_count,
      threshold,
      promoted_by_queue_id,
      promoted_at
    )
    values (
      v_evidence.company_id,
      v_evidence.user_id,
      v_profile.id,
      v_evidence.profile_type,
      v_evidence.evidence_kind,
      v_evidence.evidence_key,
      v_evidence.pattern_value,
      v_evidence_count,
      v_threshold,
      v_job.id,
      v_now
    )
    on conflict (company_id, user_id, profile_type, evidence_kind, evidence_key) do nothing
    returning id into v_promotion_id;

    if v_promotion_id is null and v_evidence.evidence_kind <> 'subject' then
      continue;
    end if;

    if v_promotion_id is null then
      -- A subject pattern remains useful after its first threshold crossing:
      -- refresh its rolling evidence count and examples on every later
      -- qualifying outcome instead of freezing the first promotion snapshot.
      update public.email_outbound_edit_promotions promotion
      set evidence_count = greatest(
            promotion.evidence_count,
            v_evidence_count
          ),
          promoted_by_queue_id = v_job.id,
          promoted_at = v_now
      where promotion.company_id = v_evidence.company_id
        and promotion.user_id = v_evidence.user_id
        and promotion.profile_type = v_evidence.profile_type
        and promotion.evidence_kind = v_evidence.evidence_kind
        and promotion.evidence_key = v_evidence.evidence_key;
    end if;

    if v_promotion_id is not null then
      v_promotions_inserted := v_promotions_inserted + 1;
    end if;

    -- Re-read under the existing row lock so each promotion composes with any
    -- preference promoted earlier in this same transaction.
    select p.*
    into v_profile
    from public.agent_writing_profiles p
    where p.id = v_profile.id
    for update;

    if v_evidence.evidence_kind = 'greeting' then
      v_greetings := array_prepend(
        v_evidence.to_value,
        array_remove(
          coalesce(v_profile.greeting_patterns, '{}'::text[]),
          v_evidence.to_value
        )
      );
      if cardinality(v_greetings) > 10 then
        v_greetings := v_greetings[1:10];
      end if;
      update public.agent_writing_profiles
      set greeting_patterns = v_greetings,
          updated_at = v_now
      where id = v_profile.id;

    elsif v_evidence.evidence_kind = 'closing' then
      v_closings := array_prepend(
        v_evidence.to_value,
        array_remove(
          coalesce(v_profile.closing_patterns, '{}'::text[]),
          v_evidence.to_value
        )
      );
      if cardinality(v_closings) > 10 then
        v_closings := v_closings[1:10];
      end if;
      update public.agent_writing_profiles
      set closing_patterns = v_closings,
          updated_at = v_now
      where id = v_profile.id;

    elsif v_evidence.evidence_kind = 'substitution' then
      v_vocabulary := coalesce(
        v_profile.vocabulary_preferences,
        '{}'::jsonb
      );
      v_substitutions := coalesce(
        v_vocabulary -> 'substitutions',
        '{}'::jsonb
      ) || jsonb_build_object(
        lower(v_evidence.from_value),
        v_evidence.to_value
      );
      v_vocabulary := v_vocabulary || jsonb_build_object(
        'substitutions',
        v_substitutions
      );
      update public.agent_writing_profiles
      set vocabulary_preferences = v_vocabulary,
          updated_at = v_now
      where id = v_profile.id;

    elsif v_evidence.evidence_kind = 'tone' then
      v_tone_traits := coalesce(v_profile.tone_traits, '{}'::jsonb);
      v_tone_traits := v_tone_traits || jsonb_build_object(
        'learned_edits',
        coalesce(v_tone_traits -> 'learned_edits', '{}'::jsonb)
          || jsonb_build_object(
            v_evidence.source_type,
            jsonb_build_object(
              'preference', v_evidence.to_value,
              'promoted_at', v_now
            )
          )
      );
      update public.agent_writing_profiles
      set tone_traits = v_tone_traits,
          formality_score = case lower(v_evidence.to_value)
            when 'more_formal' then least(1.0, coalesce(formality_score, 0.5) + 0.1)
            when 'less_formal' then greatest(0.0, coalesce(formality_score, 0.5) - 0.1)
            else formality_score
          end,
          updated_at = v_now
      where id = v_profile.id;

    elsif v_evidence.evidence_kind = 'structure' then
      v_vocabulary := coalesce(
        v_profile.vocabulary_preferences,
        '{}'::jsonb
      );
      v_paragraph_structure := coalesce(
        v_vocabulary -> 'paragraph_structure',
        '{}'::jsonb
      );
      if lower(v_evidence.to_value) like '%bullet%' then
        v_paragraph_structure := v_paragraph_structure
          || jsonb_build_object('prefersBullets', true);
      elsif lower(v_evidence.to_value) like '%prose%' then
        v_paragraph_structure := v_paragraph_structure
          || jsonb_build_object('prefersBullets', false);
      end if;
      if lower(v_evidence.to_value) like '%shorten%' then
        v_paragraph_structure := v_paragraph_structure
          || jsonb_build_object('preferredLength', 'shorter');
      elsif lower(v_evidence.to_value) like '%lengthen%' then
        v_paragraph_structure := v_paragraph_structure
          || jsonb_build_object('preferredLength', 'longer');
      end if;
      v_vocabulary := v_vocabulary || jsonb_build_object(
        'paragraph_structure',
        v_paragraph_structure,
        'learned_structure_edits',
        coalesce(
          v_vocabulary -> 'learned_structure_edits',
          '{}'::jsonb
        ) || jsonb_build_object(
          v_evidence.source_type,
          jsonb_build_object(
            'preference', v_evidence.to_value,
            'promoted_at', v_now
          )
        )
      );
      update public.agent_writing_profiles
      set vocabulary_preferences = v_vocabulary,
          updated_at = v_now
      where id = v_profile.id;

    elsif v_evidence.evidence_kind = 'subject' then
      select coalesce(jsonb_agg(example.to_value order by example.last_seen desc), '[]'::jsonb)
      into v_examples
      from (
        select e.to_value, max(e.created_at) as last_seen
        from public.email_outbound_edit_evidence e
        where e.company_id = v_evidence.company_id
          and e.user_id = v_evidence.user_id
          and e.profile_type = v_evidence.profile_type
          and e.evidence_kind = 'subject'
          and e.evidence_key = v_evidence.evidence_key
        group by e.to_value
        order by max(e.created_at) desc
        limit 5
      ) example;

      v_subject_preferences := coalesce(
        v_profile.subject_preferences,
        '{}'::jsonb
      );

      select coalesce(jsonb_agg(existing.value order by existing.ordinality), '[]'::jsonb)
      into v_existing_patterns
      from jsonb_array_elements(
        case
          when jsonb_typeof(
            v_subject_preferences -> 'preferred_patterns'
          ) = 'array'
            then v_subject_preferences -> 'preferred_patterns'
          else '[]'::jsonb
        end
      ) with ordinality as existing(value, ordinality)
      where existing.value ->> 'pattern' <> v_evidence.pattern_value;

      select coalesce(jsonb_agg(candidate.value order by candidate.ordinality), '[]'::jsonb)
      into v_preferred_patterns
      from (
        select
          jsonb_build_object(
            'pattern', v_evidence.pattern_value,
            'count', v_evidence_count,
            'examples', v_examples,
            'last_promoted_at', v_now
          ) as value,
          0::bigint as ordinality
        union all
        select existing.value, existing.ordinality
        from jsonb_array_elements(v_existing_patterns)
          with ordinality as existing(value, ordinality)
        order by ordinality
        limit 10
      ) candidate;

      v_subject_preferences := jsonb_build_object(
        'preferred_patterns', v_preferred_patterns,
        'updated_at', v_now
      );

      update public.agent_writing_profiles
      set subject_preferences = v_subject_preferences,
          updated_at = v_now
      where id = v_profile.id;
    end if;
  end loop;

  return jsonb_build_object(
    'queueId', v_job.id,
    'evidenceInserted', v_evidence_inserted,
    'promotionsInserted', v_promotions_inserted,
    'skipped', false
  );
end;
$$;

revoke all on function public.promote_email_outbound_edit_learning(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.promote_email_outbound_edit_learning(uuid) to service_role;

-- Promotion is part of the same transaction as the original application. If
-- promotion fails, every profile, memory, lifecycle, and completion mutation
-- made by the legacy body is rolled back with it.
alter function public.apply_email_outbound_learning(uuid, uuid)
  rename to apply_email_outbound_learning_legacy_internal;

revoke all on function public.apply_email_outbound_learning_legacy_internal(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.apply_email_outbound_learning(
  p_job_id uuid,
  p_lease_token uuid
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_job public.email_outbound_learning_queue;
begin
  v_job := public.apply_email_outbound_learning_legacy_internal(
    p_job_id,
    p_lease_token
  );

  perform public.promote_email_outbound_edit_learning(p_job_id);

  select q.*
  into v_job
  from public.email_outbound_learning_queue q
  where q.id = p_job_id;

  return v_job;
end;
$$;

revoke all on function public.apply_email_outbound_learning(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_email_outbound_learning(uuid, uuid)
  to service_role;

-- Repair any pre-invariant Phase C duplicates deterministically before the
-- partial unique indexes make one active provider draft and one active thread
-- draft structurally enforceable.
with ranked_mailbox_drafts as (
  select
    d.id,
    row_number() over (
      partition by d.company_id, d.connection_id, d.mailbox_draft_id
      order by d.created_at desc, d.id desc
    ) as revision_rank
  from public.ai_draft_history d
  where d.origin = 'phase_c'
    and d.status = 'auto_drafted'
    and d.connection_id is not null
    and d.mailbox_draft_id is not null
)
update public.ai_draft_history d
set status = 'superseded',
    discarded_at = coalesce(d.discarded_at, now())
from ranked_mailbox_drafts ranked
where d.id = ranked.id
  and ranked.revision_rank > 1;

with ranked_thread_drafts as (
  select
    d.id,
    row_number() over (
      partition by d.company_id, d.connection_id, d.thread_id
      order by d.created_at desc, d.id desc
    ) as revision_rank
  from public.ai_draft_history d
  where d.origin = 'phase_c'
    and d.status = 'auto_drafted'
    and d.connection_id is not null
    and d.thread_id is not null
)
update public.ai_draft_history d
set status = 'superseded',
    discarded_at = coalesce(d.discarded_at, now())
from ranked_thread_drafts ranked
where d.id = ranked.id
  and ranked.revision_rank > 1;

create unique index if not exists ai_draft_history_one_active_mailbox_draft_unique
  on public.ai_draft_history (company_id, connection_id, mailbox_draft_id)
  where status = 'auto_drafted'
    and mailbox_draft_id is not null
    and connection_id is not null
    and origin = 'phase_c';

create unique index if not exists ai_draft_history_one_active_thread_draft_unique
  on public.ai_draft_history (company_id, connection_id, thread_id)
  where status = 'auto_drafted'
    and thread_id is not null
    and connection_id is not null
    and origin = 'phase_c';

-- Mailbox providers can reuse an immutable provider draft id while OPS creates
-- a fresh learning-history row. Reassignment and supersession must commit as
-- one transaction or reconciliation can learn from the wrong generation.
create or replace function public.reassign_phase_c_mailbox_draft(
  p_company_id uuid,
  p_connection_id uuid,
  p_thread_id text,
  p_new_draft_history_id uuid,
  p_mailbox_draft_id text,
  p_expected_old_draft_history_id uuid default null,
  p_subject text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_new public.ai_draft_history%rowtype;
  v_expected_old public.ai_draft_history%rowtype;
  v_superseded_count integer := 0;
  v_thread_id text := nullif(btrim(p_thread_id), '');
  v_mailbox_draft_id text := nullif(btrim(p_mailbox_draft_id), '');
begin
  if v_thread_id is null then
    raise exception 'Phase C mailbox draft thread id is required';
  end if;
  if v_mailbox_draft_id is null then
    raise exception 'Phase C mailbox draft provider id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'phase-c-mailbox-draft:' || p_company_id::text || ':'
      || p_connection_id::text || ':' || v_mailbox_draft_id,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'phase-c-thread-draft:' || p_company_id::text || ':'
      || p_connection_id::text || ':' || v_thread_id,
    0
  ));

  if not exists (
    select 1
    from public.email_connections c
    where c.id = p_connection_id
      and c.company_id = p_company_id::text
      and c.status = 'active'
  ) then
    raise exception 'Phase C mailbox draft connection is not active in company';
  end if;

  select d.*
  into v_new
  from public.ai_draft_history d
  where d.id = p_new_draft_history_id
    and d.company_id = p_company_id
    and d.connection_id = p_connection_id
    and d.origin = 'phase_c'
    and d.status in ('drafted', 'auto_drafted')
    and (d.thread_id is null or d.thread_id = v_thread_id)
    and (
      d.mailbox_draft_id is null
      or d.mailbox_draft_id = v_mailbox_draft_id
    )
  for update;

  if v_new.id is null then
    raise exception 'new Phase C mailbox draft history is not eligible';
  end if;

  if p_expected_old_draft_history_id is not null then
    select d.*
    into v_expected_old
    from public.ai_draft_history d
    where d.id = p_expected_old_draft_history_id
      and d.company_id = p_company_id
      and d.connection_id = p_connection_id
      and d.origin = 'phase_c'
      and d.status = 'auto_drafted'
      and d.thread_id = v_thread_id
      and d.mailbox_draft_id = v_mailbox_draft_id
    for update;

    if v_expected_old.id is null then
      raise exception 'expected prior Phase C mailbox draft history changed';
    end if;
  end if;

  perform 1
  from public.ai_draft_history d
  where d.company_id = p_company_id
    and d.connection_id = p_connection_id
    and d.origin = 'phase_c'
    and d.status = 'auto_drafted'
    and (
      d.thread_id = v_thread_id
      or d.mailbox_draft_id = v_mailbox_draft_id
    )
  order by d.id
  for update;

  update public.ai_draft_history d
  set status = 'superseded',
      discarded_at = coalesce(d.discarded_at, now())
  where d.company_id = p_company_id
    and d.connection_id = p_connection_id
    and d.origin = 'phase_c'
    and d.status = 'auto_drafted'
    and d.id <> p_new_draft_history_id
    and (
      d.thread_id = v_thread_id
      or d.mailbox_draft_id = v_mailbox_draft_id
    );
  get diagnostics v_superseded_count = row_count;

  update public.ai_draft_history d
  set status = 'auto_drafted',
      thread_id = v_thread_id,
      mailbox_draft_id = v_mailbox_draft_id,
      discarded_at = null,
      subject = case
        when nullif(btrim(p_subject), '') is not null then btrim(p_subject)
        else d.subject
      end
  where d.id = p_new_draft_history_id
  returning d.* into v_new;

  return jsonb_build_object(
    'draft_history_id', v_new.id,
    'mailbox_draft_id', v_new.mailbox_draft_id,
    'status', v_new.status,
    'superseded_count', v_superseded_count
  );
end;
$$;

revoke all on function public.reassign_phase_c_mailbox_draft(
  uuid, uuid, text, uuid, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.reassign_phase_c_mailbox_draft(uuid, uuid, text, uuid, text, uuid, text) to service_role;

-- The shared dedupe RPC now accepts the explicit key used by persistent
-- signature prompts. The trailing parameter replaces (rather than overloads)
-- the prior signature so existing calls remain unambiguous through defaults.
drop function if exists public.create_notification_if_new(
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
);

create or replace function public.create_notification_if_new(
  p_user_id text,
  p_company_id text,
  p_type text,
  p_title text,
  p_body text,
  p_persistent boolean default false,
  p_action_url text default null,
  p_action_label text default null,
  p_project_id text default null,
  p_deep_link_type text default null,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.notifications (
    user_id,
    company_id,
    type,
    title,
    body,
    is_read,
    persistent,
    action_url,
    action_label,
    project_id,
    deep_link_type,
    dedupe_key
  )
  values (
    p_user_id,
    p_company_id,
    p_type,
    p_title,
    p_body,
    false,
    p_persistent,
    p_action_url,
    p_action_label,
    p_project_id,
    p_deep_link_type,
    nullif(btrim(p_dedupe_key), '')
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.create_notification_if_new(
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.create_notification_if_new(
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
) to service_role;

create or replace function public.sync_email_signature_notification(
  p_company_id uuid,
  p_connection_id uuid,
  p_scope_user_id uuid
)
returns public.notifications
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_connection public.email_connections%rowtype;
  v_dedupe_key text;
  v_notification_id uuid;
  v_notification public.notifications%rowtype;
  v_signature_available boolean;
begin
  select c.*
  into v_connection
  from public.email_connections c
  where c.id = p_connection_id
    and c.company_id = p_company_id::text
  for share;

  if v_connection.id is null then
    raise exception 'signature notification connection does not belong to company';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = p_scope_user_id
      and u.company_id = p_company_id
      and coalesce(u.is_active, true)
      and u.deleted_at is null
  ) then
    raise exception 'signature notification user is not active in company';
  end if;

  if v_connection.type = 'individual'
    and nullif(btrim(v_connection.user_id), '') is not null
    and v_connection.user_id <> p_scope_user_id::text
  then
    raise exception 'signature notification user does not own connection';
  end if;

  v_dedupe_key := 'email-signature:'
    || p_connection_id::text
    || ':'
    || p_scope_user_id::text;

  perform pg_advisory_xact_lock(hashtextextended(v_dedupe_key, 0));

  select exists (
    select 1
    from public.email_signatures s
    where s.company_id = p_company_id
      and s.connection_id = p_connection_id
      and s.active
      and (
        nullif(btrim(s.content_html), '') is not null
        or nullif(btrim(s.content_text), '') is not null
      )
      and (
        (
          s.source = 'ops'
          and (
            s.scope_user_id = p_scope_user_id
            or s.scope_user_id is null
          )
        )
        or (
          s.source <> 'ops'
          and lower(btrim(s.provider_identity))
            = lower(btrim(v_connection.email))
        )
      )
  ) into v_signature_available;

  if v_signature_available then
    update public.notifications n
    set resolved_at = now(),
        resolved_by = p_scope_user_id,
        resolution_reason = 'signature_available',
        is_read = true
    where n.user_id = p_scope_user_id::text
      and n.company_id = p_company_id::text
      and n.type = 'email_signature_required'
      and n.dedupe_key = v_dedupe_key
      and n.resolved_at is null;

    select n.*
    into v_notification
    from public.notifications n
    where n.user_id = p_scope_user_id::text
      and n.company_id = p_company_id::text
      and n.type = 'email_signature_required'
      and n.dedupe_key = v_dedupe_key
    order by n.resolved_at desc nulls last, n.created_at desc, n.id desc
    limit 1;

    return v_notification;
  end if;

  select n.id
  into v_notification_id
  from public.notifications n
  where n.user_id = p_scope_user_id::text
    and n.company_id = p_company_id::text
    and n.type = 'email_signature_required'
    and n.dedupe_key = v_dedupe_key
    and n.resolved_at is null
  order by n.is_read asc, n.created_at desc, n.id desc
  limit 1
  for update;

  if v_notification_id is not null then
    -- Collapse any historical read duplicate before reopening the canonical
    -- persistent row; this preserves the partial unread unique index.
    update public.notifications n
    set resolved_at = now(),
        resolved_by = p_scope_user_id,
        resolution_reason = 'superseded_signature_prompt',
        is_read = true
    where n.user_id = p_scope_user_id::text
      and n.company_id = p_company_id::text
      and n.type = 'email_signature_required'
      and n.dedupe_key = v_dedupe_key
      and n.resolved_at is null
      and n.id <> v_notification_id;

    update public.notifications n
    set title = 'Email signature required',
        body = 'Add a signature so OPS includes it in drafts from this inbox.',
        is_read = false,
        persistent = true,
        action_url = '/settings?section=email&connection=' || p_connection_id::text,
        action_label = 'ADD SIGNATURE',
        deep_link_type = 'email_signature',
        resolved_at = null,
        resolved_by = null,
        resolution_reason = null
    where n.id = v_notification_id
    returning n.* into v_notification;
  else
    insert into public.notifications (
      user_id,
      company_id,
      type,
      title,
      body,
      is_read,
      persistent,
      action_url,
      action_label,
      deep_link_type,
      dedupe_key
    )
    values (
      p_scope_user_id::text,
      p_company_id::text,
      'email_signature_required',
      'Email signature required',
      'Add a signature so OPS includes it in drafts from this inbox.',
      false,
      true,
      '/settings?section=email&connection=' || p_connection_id::text,
      'ADD SIGNATURE',
      'email_signature',
      v_dedupe_key
    )
    on conflict do nothing
    returning * into v_notification;

    if v_notification.id is null then
      select n.*
      into v_notification
      from public.notifications n
      where n.user_id = p_scope_user_id::text
        and n.company_id = p_company_id::text
        and n.type = 'email_signature_required'
        and n.dedupe_key = v_dedupe_key
        and n.resolved_at is null
      order by n.is_read asc, n.created_at desc, n.id desc
      limit 1;
    end if;
  end if;

  return v_notification;
end;
$$;

revoke all on function public.sync_email_signature_notification(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_email_signature_notification(uuid, uuid, uuid) to service_role;

commit;
