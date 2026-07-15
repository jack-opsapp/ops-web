begin;

alter table public.ai_draft_history add column if not exists sent_provider_message_id text;

create unique index if not exists ai_draft_history_sent_provider_message_unique
  on public.ai_draft_history (company_id, connection_id, sent_provider_message_id)
  where sent_provider_message_id is not null;

-- Durable, sanitized queue. Raw provider bodies never enter this ledger.
create table public.email_outbound_learning_queue (
  id uuid primary key default gen_random_uuid(),
  company_id text not null check (btrim(company_id) <> ''),
  connection_id uuid not null references public.email_connections(id) on delete cascade,
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  provider_thread_id text,
  user_id text not null check (btrim(user_id) <> ''),
  from_email text,
  to_emails text[] not null default '{}'::text[],
  subject text not null default '',
  authored_body text not null check (btrim(authored_body) <> ''),
  clean_body text not null check (btrim(clean_body) <> ''),
  opportunity_id uuid references public.opportunities(id) on delete set null,
  draft_history_id uuid references public.ai_draft_history(id) on delete restrict,
  follow_up_draft_id uuid references public.opportunity_follow_up_drafts(id) on delete set null,
  draft_delivery_channel text
    check (draft_delivery_channel in ('ops_send', 'mailbox')),
  writing_sample jsonb,
  memory_extraction jsonb,
  draft_outcome jsonb,
  draft_correction_facts jsonb,
  profile_type text not null default 'general'
    check (btrim(profile_type) <> '' and length(profile_type) <= 64),
  learning_authority text not null default 'autonomous'
    check (
      learning_authority in (
        'operator_authored',
        'operator_approved',
        'autonomous'
      )
    ),
  apply_learning boolean,
  apply_full_body_learning boolean,
  preparation_version text,
  prepared_at timestamptz,
  applied_at timestamptz,
  occurred_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  last_failed_at timestamptz,
  last_terminal_error text,
  requeue_count integer not null default 0 check (requeue_count >= 0),
  last_requeued_at timestamptz,
  last_requeue_reason text,
  completed_lease_token uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, connection_id, provider_message_id),
  check (
    (draft_history_id is null and draft_delivery_channel is null)
    or (draft_history_id is not null and draft_delivery_channel is not null)
  ),
  check (
    (status = 'leased' and lease_token is not null and lease_expires_at is not null)
    or
    (status <> 'leased' and lease_token is null and lease_expires_at is null)
  ),
  check (
    (status = 'completed' and completed_lease_token is not null)
    or (status <> 'completed' and completed_lease_token is null)
  ),
  check (
    (writing_sample is null) = (memory_extraction is null)
  ),
  check (
    (
      prepared_at is null
      and preparation_version is null
      and apply_learning is null
      and apply_full_body_learning is null
      and draft_outcome is null
      and draft_correction_facts is null
    ) or (
      prepared_at is not null
      and preparation_version is not null
      and apply_learning is not null
      and apply_full_body_learning is not null
      and draft_outcome is not null
      and draft_correction_facts is not null
      and jsonb_typeof(draft_correction_facts) = 'array'
      and (
        apply_full_body_learning is false
        or (
          apply_learning is true
          and writing_sample is not null
          and memory_extraction is not null
        )
      )
    )
  ),
  check (
    learning_authority <> 'autonomous'
    or apply_learning is not true
  ),
  check (
    apply_full_body_learning is not true
    or learning_authority = 'operator_authored'
  )
);

create index email_outbound_learning_queue_due_idx
  on public.email_outbound_learning_queue (next_attempt_at, created_at)
  where status = 'pending';

create index email_outbound_learning_queue_stale_lease_idx
  on public.email_outbound_learning_queue (lease_expires_at, created_at)
  where status = 'leased';

create index email_outbound_learning_queue_failed_idx
  on public.email_outbound_learning_queue (last_failed_at desc, id desc)
  where status = 'failed';

create index email_outbound_learning_queue_failed_company_idx
  on public.email_outbound_learning_queue (company_id, last_failed_at desc, id desc)
  where status = 'failed';

create index email_outbound_learning_queue_connection_idx
  on public.email_outbound_learning_queue (connection_id);

create index email_outbound_learning_queue_opportunity_idx
  on public.email_outbound_learning_queue (opportunity_id)
  where opportunity_id is not null;

create index email_outbound_learning_queue_draft_history_idx
  on public.email_outbound_learning_queue (draft_history_id)
  where draft_history_id is not null;

create index email_outbound_learning_queue_follow_up_draft_idx
  on public.email_outbound_learning_queue (follow_up_draft_id)
  where follow_up_draft_id is not null;

create unique index email_outbound_learning_queue_draft_history_unique
  on public.email_outbound_learning_queue (draft_history_id)
  where draft_history_id is not null;

create unique index email_outbound_learning_queue_follow_up_draft_unique
  on public.email_outbound_learning_queue (follow_up_draft_id)
  where follow_up_draft_id is not null;

-- One immutable receipt gates the profile mutation for each provider message.
create table public.email_outbound_writing_samples (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null unique
    references public.email_outbound_learning_queue(id) on delete cascade,
  company_id text not null,
  connection_id uuid not null
    references public.email_connections(id) on delete cascade,
  provider_message_id text not null,
  user_id text not null,
  profile_type text not null,
  profile_id uuid
    references public.agent_writing_profiles(id) on delete set null,
  sample jsonb not null,
  applied_at timestamptz not null default now(),
  unique (company_id, connection_id, provider_message_id)
);

create index email_outbound_writing_samples_queue_idx
  on public.email_outbound_writing_samples (queue_id);

create index email_outbound_writing_samples_connection_idx
  on public.email_outbound_writing_samples (connection_id);

create index email_outbound_writing_samples_profile_idx
  on public.email_outbound_writing_samples (profile_id)
  where profile_id is not null;

-- One row per prepared fact/edge is the exactly-once memory evidence ledger.
create table public.email_outbound_memory_evidence (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null
    references public.email_outbound_learning_queue(id) on delete cascade,
  writing_sample_id uuid
    references public.email_outbound_writing_samples(id) on delete cascade,
  company_id text not null,
  connection_id uuid not null
    references public.email_connections(id) on delete cascade,
  provider_message_id text not null,
  user_id text not null,
  evidence_kind text not null check (evidence_kind in ('fact', 'edge')),
  evidence_key text not null
    check (btrim(evidence_key) <> '' and length(evidence_key) <= 200),
  effect text not null check (effect in ('inserted', 'reinforced', 'upserted')),
  memory_id uuid references public.agent_memories(id) on delete set null,
  knowledge_graph_id uuid
    references public.agent_knowledge_graph(id) on delete set null,
  applied_at timestamptz not null default now(),
  unique (company_id, connection_id, provider_message_id, evidence_kind, evidence_key),
  check (
    (evidence_kind = 'fact' and knowledge_graph_id is null)
    or
    (evidence_kind = 'edge' and memory_id is null)
  )
);

create index email_outbound_memory_evidence_queue_idx
  on public.email_outbound_memory_evidence (queue_id);

create index email_outbound_memory_evidence_writing_sample_idx
  on public.email_outbound_memory_evidence (writing_sample_id);

create index email_outbound_memory_evidence_connection_idx
  on public.email_outbound_memory_evidence (connection_id);

create index email_outbound_memory_evidence_memory_idx
  on public.email_outbound_memory_evidence (memory_id)
  where memory_id is not null;

create index email_outbound_memory_evidence_graph_idx
  on public.email_outbound_memory_evidence (knowledge_graph_id)
  where knowledge_graph_id is not null;

alter table public.email_outbound_learning_queue enable row level security;
alter table public.email_outbound_writing_samples enable row level security;
alter table public.email_outbound_memory_evidence enable row level security;

-- Even service_role has no table DML grant. The fixed-search-path definer RPCs
-- below are the only supported write surface.
revoke all on table public.email_outbound_learning_queue from public, anon, authenticated, service_role;
revoke all on table public.email_outbound_writing_samples from public, anon, authenticated, service_role;
revoke all on table public.email_outbound_memory_evidence from public, anon, authenticated, service_role;

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
  p_draft_delivery_channel text default null
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_company_id uuid;
  v_connection public.email_connections%rowtype;
  v_user_id text;
  v_draft public.ai_draft_history%rowtype;
  v_follow_up public.opportunity_follow_up_drafts%rowtype;
  v_linked_draft_history_id uuid;
  v_follow_up_opportunity_id uuid;
  v_draft_history_id uuid := p_draft_history_id;
  v_follow_up_draft_id uuid := p_follow_up_draft_id;
  v_opportunity_id uuid := p_opportunity_id;
  v_draft_delivery_channel text := nullif(
    btrim(p_draft_delivery_channel),
    ''
  );
  v_provider_thread_id text := nullif(btrim(p_provider_thread_id), '');
  v_existing_queue public.email_outbound_learning_queue%rowtype;
  v_provenance_enrichment boolean := false;
  v_row public.email_outbound_learning_queue;
begin
  if nullif(btrim(p_company_id), '') is null then
    raise exception 'outbound learning company id is required';
  end if;
  if nullif(btrim(p_provider_message_id), '') is null then
    raise exception 'outbound learning provider message id is required';
  end if;
  if nullif(btrim(p_authored_body), '') is null
    or nullif(btrim(p_clean_body), '') is null
  then
    raise exception 'outbound learning clean body is required';
  end if;
  if v_draft_delivery_channel is not null
    and v_draft_delivery_channel not in ('ops_send', 'mailbox')
  then
    raise exception 'outbound learning draft delivery channel is invalid';
  end if;

  -- A row lock cannot serialize the first insert because there is no row yet.
  -- Own the provider identity before any provenance reads so concurrent sync,
  -- send-route, and reconciliation enqueues observe one canonical generation.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'email-outbound:' || p_company_id || ':' || p_connection_id::text || ':'
        || btrim(p_provider_message_id),
      0
    )
  );

  -- Match the apply RPC lock order. If this provider identity already exists,
  -- own its queue row before touching connection or draft provenance rows.
  select q.*
  into v_existing_queue
  from public.email_outbound_learning_queue q
  where q.company_id = p_company_id
    and q.connection_id = p_connection_id
    and q.provider_message_id = btrim(p_provider_message_id)
  for update;

  select c0.id
  into v_company_id
  from public.companies c0
  where c0.id::text = p_company_id;

  if v_company_id is null then
    raise exception 'outbound learning company does not exist';
  end if;

  select c.*
  into v_connection
  from public.email_connections c
  where c.id = p_connection_id
    and c.company_id = p_company_id
  for share;

  if v_connection.id is null then
    raise exception 'outbound learning email connection does not belong to company';
  end if;

  if v_connection.type = 'individual'
    and nullif(btrim(p_user_id), '') is not null
    and nullif(btrim(v_connection.user_id), '') is not null
    and btrim(p_user_id) <> btrim(v_connection.user_id)
  then
    raise exception 'outbound learning user does not own email connection';
  end if;

  v_user_id := coalesce(
    nullif(btrim(p_user_id), ''),
    nullif(btrim(v_connection.user_id), '')
  );

  -- Read the follow-up link without a row lock so the canonical lock order can
  -- remain queue -> connection -> draft -> follow-up. The locked re-read below
  -- rejects any concurrent provenance change.
  if v_follow_up_draft_id is not null then
    select f.ai_draft_history_id, f.opportunity_id
    into v_linked_draft_history_id, v_follow_up_opportunity_id
    from public.opportunity_follow_up_drafts f
    where f.id = v_follow_up_draft_id
      and f.company_id::text = p_company_id;

    if not found then
      raise exception 'outbound learning follow-up draft does not belong to company';
    end if;
    v_opportunity_id := coalesce(v_opportunity_id, v_follow_up_opportunity_id);
    v_draft_history_id := coalesce(
      v_draft_history_id,
      v_linked_draft_history_id
    );
  end if;

  if v_draft_history_id is not null then
    select d.*
    into v_draft
    from public.ai_draft_history d
    where d.id = v_draft_history_id
      and d.company_id::text = p_company_id
    for share;

    if v_draft.id is null then
      raise exception 'outbound learning draft history does not belong to company';
    end if;
    if v_draft.connection_id is not null
      and v_draft.connection_id <> p_connection_id
    then
      raise exception 'outbound learning draft history belongs to another connection';
    end if;
    if v_user_id is not null and v_draft.user_id::text <> v_user_id then
      raise exception 'outbound learning draft history belongs to another user';
    end if;
    if nullif(btrim(v_draft.thread_id), '') is not null
      and v_provider_thread_id is not null
      and v_draft.thread_id <> v_provider_thread_id
    then
      raise exception 'outbound learning draft history belongs to another thread';
    end if;

    v_user_id := coalesce(v_user_id, v_draft.user_id::text);
    v_opportunity_id := coalesce(v_opportunity_id, v_draft.opportunity_id);
  end if;

  if v_follow_up_draft_id is not null then
    select f.*
    into v_follow_up
    from public.opportunity_follow_up_drafts f
    where f.id = v_follow_up_draft_id
      and f.company_id::text = p_company_id
    for share;

    if v_follow_up.id is null
      or v_follow_up.opportunity_id is distinct from v_follow_up_opportunity_id
      or v_follow_up.ai_draft_history_id is distinct from v_linked_draft_history_id
    then
      raise exception 'outbound learning follow-up draft provenance changed';
    end if;
    if v_follow_up.connection_id is not null
      and v_follow_up.connection_id <> p_connection_id
    then
      raise exception 'outbound learning follow-up draft belongs to another connection';
    end if;
    if nullif(btrim(v_follow_up.provider_thread_id), '') is not null
      and v_provider_thread_id is not null
      and v_follow_up.provider_thread_id <> v_provider_thread_id
    then
      raise exception 'outbound learning follow-up draft belongs to another thread';
    end if;
    if v_follow_up.ai_draft_history_id is distinct from v_draft_history_id then
      raise exception 'outbound learning follow-up row belongs to another draft history';
    end if;
  end if;

  if v_opportunity_id is not null and not exists (
    select 1
    from public.opportunities o
    where o.id = v_opportunity_id
      and o.company_id::text = p_company_id
  ) then
    raise exception 'outbound learning opportunity does not belong to company';
  end if;

  if v_follow_up.id is not null
    and v_opportunity_id is distinct from v_follow_up.opportunity_id
  then
    raise exception 'outbound learning follow-up draft belongs to another opportunity';
  end if;

  if v_draft.id is not null
    and v_draft.opportunity_id is not null
    and v_opportunity_id is distinct from v_draft.opportunity_id
  then
    raise exception 'outbound learning draft history belongs to another opportunity';
  end if;

  if v_user_id is null and nullif(btrim(p_from_email), '') is not null then
    select u.id::text
    into v_user_id
    from public.users u
    where u.company_id::text = p_company_id
      and lower(u.email) = lower(btrim(p_from_email))
      and coalesce(u.is_active, true)
      and u.deleted_at is null
    order by u.id
    limit 1;
  end if;

  if v_user_id is null or not exists (
    select 1
    from public.users u
    where u.id::text = v_user_id
      and u.company_id::text = p_company_id
      and coalesce(u.is_active, true)
      and u.deleted_at is null
  ) then
    raise exception 'outbound learning user is not an active company user';
  end if;

  if (v_draft_history_id is null)
    is distinct from (v_draft_delivery_channel is null)
  then
    raise exception 'outbound learning draft delivery channel requires one draft history';
  end if;

  if v_draft_delivery_channel = 'mailbox'
    and (
      v_draft.mailbox_draft_id is null
      or v_draft.status not in ('drafted', 'auto_drafted', 'sent_from_mailbox')
    )
  then
    raise exception 'outbound learning mailbox delivery lacks eligible mailbox draft provenance';
  end if;

  if v_draft_delivery_channel = 'ops_send'
    and v_draft.status not in ('drafted', 'auto_drafted', 'sent')
  then
    raise exception 'outbound learning OPS delivery lacks eligible draft provenance';
  end if;

  v_provenance_enrichment := v_existing_queue.id is not null and (
    (v_existing_queue.draft_history_id is null and v_draft_history_id is not null)
    or (
      v_existing_queue.follow_up_draft_id is null
      and v_follow_up_draft_id is not null
    )
    or (
      v_existing_queue.draft_delivery_channel is null
      and v_draft_delivery_channel is not null
    )
  );

  insert into public.email_outbound_learning_queue (
    company_id,
    connection_id,
    provider_message_id,
    provider_thread_id,
    user_id,
    from_email,
    to_emails,
    subject,
    authored_body,
    clean_body,
    opportunity_id,
    draft_history_id,
    follow_up_draft_id,
    draft_delivery_channel,
    apply_learning,
    draft_correction_facts,
    occurred_at
  )
  values (
    p_company_id,
    p_connection_id,
    btrim(p_provider_message_id),
    v_provider_thread_id,
    v_user_id,
    nullif(btrim(p_from_email), ''),
    coalesce(p_to_emails, '{}'::text[]),
    coalesce(p_subject, ''),
    btrim(p_authored_body),
    btrim(p_clean_body),
    v_opportunity_id,
    v_draft_history_id,
    v_follow_up_draft_id,
    v_draft_delivery_channel,
    null,
    null,
    p_occurred_at
  )
  on conflict (company_id, connection_id, provider_message_id)
  do update set
    provider_thread_id = coalesce(nullif(email_outbound_learning_queue.provider_thread_id, ''), excluded.provider_thread_id),
    user_id = email_outbound_learning_queue.user_id,
    from_email = coalesce(nullif(email_outbound_learning_queue.from_email, ''), excluded.from_email),
    to_emails = case
      when cardinality(email_outbound_learning_queue.to_emails) = 0
        then excluded.to_emails
      else email_outbound_learning_queue.to_emails
    end,
    subject = case when v_provenance_enrichment then excluded.subject
      else coalesce(nullif(email_outbound_learning_queue.subject, ''), excluded.subject)
    end,
    authored_body = case when v_provenance_enrichment then excluded.authored_body
      else coalesce(nullif(email_outbound_learning_queue.authored_body, ''), excluded.authored_body)
    end,
    clean_body = case when v_provenance_enrichment then excluded.clean_body
      else coalesce(nullif(email_outbound_learning_queue.clean_body, ''), excluded.clean_body)
    end,
    opportunity_id = coalesce(email_outbound_learning_queue.opportunity_id, excluded.opportunity_id),
    draft_history_id = coalesce(email_outbound_learning_queue.draft_history_id, excluded.draft_history_id),
    follow_up_draft_id = coalesce(email_outbound_learning_queue.follow_up_draft_id, excluded.follow_up_draft_id),
    draft_delivery_channel = coalesce(
      email_outbound_learning_queue.draft_delivery_channel,
      excluded.draft_delivery_channel
    ),
    occurred_at = coalesce(email_outbound_learning_queue.occurred_at, excluded.occurred_at),
    status = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then 'pending'
      else email_outbound_learning_queue.status
    end,
    attempts = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then 0
      else email_outbound_learning_queue.attempts
    end,
    next_attempt_at = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then now()
      else email_outbound_learning_queue.next_attempt_at
    end,
    apply_learning = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.apply_learning
    end,
    apply_full_body_learning = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.apply_full_body_learning
    end,
    -- A committed receipt makes the base extraction immutable. Without one,
    -- enrichment replaced the canonical body, so every prepared payload is stale.
    writing_sample = case
      when v_provenance_enrichment
        and not exists (
          select 1
          from public.email_outbound_writing_samples receipt
          where receipt.queue_id = email_outbound_learning_queue.id
        )
        then null
      else email_outbound_learning_queue.writing_sample
    end,
    memory_extraction = case
      when v_provenance_enrichment
        and not exists (
          select 1
          from public.email_outbound_writing_samples receipt
          where receipt.queue_id = email_outbound_learning_queue.id
        )
        then null
      else email_outbound_learning_queue.memory_extraction
    end,
    draft_outcome = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.draft_outcome
    end,
    draft_correction_facts = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.draft_correction_facts
    end,
    preparation_version = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.preparation_version
    end,
    prepared_at = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.prepared_at
    end,
    completed_at = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.completed_at
    end,
    completed_lease_token = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.completed_lease_token
    end,
    lease_token = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.lease_token
    end,
    lease_expires_at = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.lease_expires_at
    end,
    last_error = case
      when (
        (email_outbound_learning_queue.draft_history_id is null and excluded.draft_history_id is not null)
        or (email_outbound_learning_queue.follow_up_draft_id is null and excluded.follow_up_draft_id is not null)
        or (email_outbound_learning_queue.draft_delivery_channel is null and excluded.draft_delivery_channel is not null)
      )
        then null
      else email_outbound_learning_queue.last_error
    end,
    updated_at = now()
  returning * into v_row;

  if v_row.user_id <> v_user_id
    or (
      v_provider_thread_id is not null
      and v_row.provider_thread_id is distinct from v_provider_thread_id
    )
    or (
      v_draft_history_id is not null
      and v_row.draft_history_id is distinct from v_draft_history_id
    )
    or (
      v_follow_up_draft_id is not null
      and v_row.follow_up_draft_id is distinct from v_follow_up_draft_id
    )
    or (
      v_opportunity_id is not null
      and v_row.opportunity_id is distinct from v_opportunity_id
    )
    or (
      v_draft_history_id is not null
      and v_row.draft_delivery_channel is distinct from v_draft_delivery_channel
    )
    or (
      (v_draft_history_id is not null or v_follow_up_draft_id is not null)
      and (
        v_row.subject is distinct from coalesce(p_subject, '')
        or v_row.authored_body is distinct from btrim(p_authored_body)
        or v_row.clean_body is distinct from btrim(p_clean_body)
      )
    )
  then
    raise exception 'outbound learning provider message provenance conflicts with queued sample';
  end if;

  return v_row;
end;
$$;

create or replace function public.claim_email_outbound_learning(
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns setof public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_limit integer := greatest(0, least(coalesce(p_limit, 25), 100));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 3600));
begin
  if v_limit = 0 then
    return;
  end if;

  return query
  with exhausted as (
    select q.id
    from public.email_outbound_learning_queue q
    where q.status = 'leased'
      and q.lease_expires_at <= now()
      and q.attempts >= q.max_attempts
    order by q.lease_expires_at, q.created_at, q.id
    limit v_limit
    for update skip locked
  ), terminalized as (
    update public.email_outbound_learning_queue q
    set status = 'failed',
        lease_token = null,
        lease_expires_at = null,
        last_error = coalesce(q.last_error, 'lease expired after maximum attempts'),
        last_failed_at = now(),
        last_terminal_error = coalesce(
          q.last_error,
          'lease expired after maximum attempts'
        ),
        updated_at = now()
    from exhausted e
    where q.id = e.id
    returning q.*
  ), candidates as (
    select q.id
    from public.email_outbound_learning_queue q
    where (
        (q.status = 'pending' and q.next_attempt_at <= now())
        or (q.status = 'leased' and q.lease_expires_at <= now())
      )
      and q.attempts < q.max_attempts
    order by
      case when q.status = 'leased' then q.lease_expires_at else q.next_attempt_at end,
      q.created_at,
      q.id
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.email_outbound_learning_queue q
    set status = 'leased',
        attempts = q.attempts + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        updated_at = now()
    from candidates c
    where q.id = c.id
    returning q.*
  )
  select * from terminalized
  union all
  select * from claimed;
end;
$$;

create or replace function public.prepare_email_outbound_learning(
  p_job_id uuid,
  p_lease_token uuid,
  p_apply_learning boolean,
  p_apply_full_body_learning boolean,
  p_writing_sample jsonb,
  p_memory_extraction jsonb,
  p_draft_outcome jsonb,
  p_draft_correction_facts jsonb,
  p_preparation_version text
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_job public.email_outbound_learning_queue;
begin
  select q.*
  into v_job
  from public.email_outbound_learning_queue q
  where q.id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'outbound learning job does not exist';
  end if;

  -- A client may lose the successful response. A repeat is a read-only no-op.
  if v_job.status = 'completed' then
    if v_job.completed_lease_token is distinct from p_lease_token then
      raise exception 'outbound learning preparation lost lease ownership';
    end if;
    if v_job.apply_full_body_learning is true and not exists (
      select 1
      from public.email_outbound_writing_samples r
      where r.queue_id = v_job.id
    ) then
      raise exception 'completed outbound learning job is missing its receipt';
    end if;
    return v_job;
  end if;

  if v_job.status <> 'leased'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at <= now()
  then
    raise exception 'outbound learning preparation lost lease ownership';
  end if;

  if p_apply_learning is null then
    raise exception 'outbound learning apply-learning decision is required';
  end if;

  if p_apply_full_body_learning is null then
    raise exception 'outbound learning full-body decision is required';
  end if;

  if p_apply_full_body_learning and not p_apply_learning then
    raise exception 'outbound learning full-body learning requires learning';
  end if;

  if p_apply_learning and v_job.learning_authority = 'autonomous' then
    raise exception 'outbound learning authority does not permit learning';
  end if;

  if p_apply_full_body_learning and v_job.learning_authority <> 'operator_authored'
  then
    raise exception 'outbound learning authority does not permit full-body learning';
  end if;

  if p_apply_learning
    and v_job.learning_authority = 'operator_authored'
    and not p_apply_full_body_learning
  then
    raise exception 'operator-authored learning requires full-body preparation';
  end if;

  if not p_apply_learning
    and v_job.draft_history_id is null
    and v_job.follow_up_draft_id is null
  then
    raise exception 'outbound learning disabled preparation has no sent outcome';
  end if;

  if p_apply_learning and not exists (
    select 1
    from public.email_connections c
    where c.id = v_job.connection_id
      and c.company_id = v_job.company_id
      and (
        c.type = 'company'
        or c.user_id is null
        or c.user_id = v_job.user_id
      )
  ) then
    raise exception 'outbound learning connection ownership changed';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id::text = v_job.user_id
      and u.company_id::text = v_job.company_id
      and coalesce(u.is_active, true)
      and u.deleted_at is null
  ) then
    raise exception 'outbound learning user is no longer active in company';
  end if;

  if p_apply_learning and not exists (
    select 1
    from public.admin_feature_overrides o
    where o.company_id::text = v_job.company_id
      and o.feature_key = 'phase_c'
      and o.enabled is true
  ) then
    raise exception 'outbound learning phase_c feature is disabled';
  end if;

  if p_apply_full_body_learning then
    if jsonb_typeof(p_writing_sample) is distinct from 'object'
      or nullif(btrim(p_writing_sample ->> 'profileType'), '') is null
      or jsonb_typeof(p_writing_sample -> 'formalityScore') is distinct from 'number'
      or jsonb_typeof(p_writing_sample -> 'avgSentenceLength') is distinct from 'number'
    then
      raise exception 'outbound learning writing sample is invalid';
    end if;

    if jsonb_typeof(p_memory_extraction) is distinct from 'object'
      or jsonb_typeof(p_memory_extraction -> 'facts') is distinct from 'array'
      or jsonb_typeof(p_memory_extraction -> 'edges') is distinct from 'array'
    then
      raise exception 'outbound learning memory extraction is invalid';
    end if;

    if jsonb_array_length(p_memory_extraction -> 'facts') > 50
      or jsonb_array_length(p_memory_extraction -> 'edges') > 50
    then
      raise exception 'outbound learning memory extraction is invalid';
    end if;
  elsif p_writing_sample is not null or p_memory_extraction is not null then
    raise exception 'outbound learning edit-only preparation contains full-body payload';
  end if;

  if jsonb_typeof(p_draft_correction_facts) is distinct from 'array' then
    raise exception 'outbound learning draft correction facts are invalid';
  end if;

  if jsonb_array_length(p_draft_correction_facts) > 20
    or (not p_apply_learning and jsonb_array_length(p_draft_correction_facts) <> 0)
    or exists (
      select 1
      from jsonb_array_elements(p_draft_correction_facts) correction(value)
      where jsonb_typeof(correction.value) is distinct from 'object'
        or nullif(btrim(correction.value ->> 'evidenceKey'), '') is null
        or length(correction.value ->> 'evidenceKey') > 200
        or correction.value ->> 'category' is distinct from 'correction'
        or nullif(btrim(correction.value ->> 'content'), '') is null
        or jsonb_typeof(correction.value -> 'confidence') is distinct from 'number'
        or (
          correction.value ? 'embedding'
          and jsonb_typeof(correction.value -> 'embedding') not in ('array', 'null')
        )
        or (
          jsonb_typeof(correction.value -> 'embedding') = 'array'
          and jsonb_array_length(correction.value -> 'embedding') <> 1536
        )
    )
  then
    raise exception 'outbound learning draft correction facts are invalid';
  end if;

  if jsonb_typeof(p_draft_outcome) is distinct from 'object'
    or not (p_draft_outcome ? 'finalVersion')
    or jsonb_typeof(p_draft_outcome -> 'finalVersion') is distinct from 'string'
    or not (p_draft_outcome ? 'editDistance')
    or jsonb_typeof(p_draft_outcome -> 'editDistance') is distinct from 'number'
    or jsonb_typeof(p_draft_outcome -> 'changesMade') is distinct from 'array'
    or jsonb_typeof(p_draft_outcome -> 'sentWithoutChanges') is distinct from 'boolean'
    or not (p_draft_outcome ? 'subject')
    or jsonb_typeof(p_draft_outcome -> 'subject') is distinct from 'string'
    or jsonb_typeof(p_draft_outcome -> 'subjectEdited') is distinct from 'boolean'
    or jsonb_typeof(p_draft_outcome -> 'edited') is distinct from 'boolean'
    or jsonb_typeof(p_draft_outcome -> 'contentCorrections') is distinct from 'array'
  then
    raise exception 'outbound learning draft outcome is invalid';
  end if;

  if (p_draft_outcome ->> 'editDistance')::numeric < 0
    or (p_draft_outcome ->> 'editDistance')::numeric
      <> trunc((p_draft_outcome ->> 'editDistance')::numeric)
    or jsonb_array_length(p_draft_outcome -> 'changesMade') > 100
    or jsonb_array_length(p_draft_outcome -> 'contentCorrections') > 20
    or (p_draft_outcome ->> 'edited')::boolean
      is distinct from not (p_draft_outcome ->> 'sentWithoutChanges')::boolean
    or p_draft_outcome ->> 'finalVersion' is distinct from v_job.authored_body
    or p_draft_outcome ->> 'subject' is distinct from v_job.subject
    or exists (
      select 1
      from jsonb_array_elements(p_draft_outcome -> 'changesMade') change(value)
      where jsonb_typeof(change.value) is distinct from 'object'
        or jsonb_typeof(change.value -> 'type') is distinct from 'string'
        or jsonb_typeof(change.value -> 'from') is distinct from 'string'
        or jsonb_typeof(change.value -> 'to') is distinct from 'string'
    )
    or exists (
      select 1
      from jsonb_array_elements(p_draft_outcome -> 'contentCorrections') correction(value)
      where jsonb_typeof(correction.value) is distinct from 'string'
    )
  then
    raise exception 'outbound learning draft outcome is invalid';
  end if;

  if nullif(btrim(p_preparation_version), '') is null then
    raise exception 'outbound learning preparation version is required';
  end if;

  update public.email_outbound_learning_queue
  set apply_learning = p_apply_learning,
      apply_full_body_learning = p_apply_full_body_learning,
      writing_sample = coalesce(writing_sample, p_writing_sample),
      memory_extraction = coalesce(memory_extraction, p_memory_extraction),
      draft_outcome = coalesce(draft_outcome, p_draft_outcome),
      draft_correction_facts = p_draft_correction_facts,
      preparation_version = btrim(p_preparation_version),
      prepared_at = now(),
      updated_at = now()
  where id = p_job_id
    and status = 'leased'
    and lease_token = p_lease_token
    and lease_expires_at > now()
  returning * into v_job;

  if v_job.id is null then
    raise exception 'outbound learning preparation lost lease ownership';
  end if;

  return v_job;
end;
$$;

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
  v_company_id uuid;
  v_sample jsonb;
  v_draft_outcome jsonb;
  v_profile_type text;
  v_profile public.agent_writing_profiles%rowtype;
  v_writing_receipt public.email_outbound_writing_samples%rowtype;
  v_old_count integer;
  v_new_count integer;
  v_greetings text[];
  v_closings text[];
  v_greeting text;
  v_closing text;
  v_vocab jsonb;
  v_punctuation jsonb;
  v_fact record;
  v_fact_json jsonb;
  v_memory public.agent_memories%rowtype;
  v_memory_id uuid;
  v_memory_effect text;
  v_edge record;
  v_edge_json jsonb;
  v_graph_id uuid;
  v_effective_follow_up_id uuid;
  v_effective_draft_id uuid;
  v_follow_up public.opportunity_follow_up_drafts%rowtype;
  v_draft public.ai_draft_history%rowtype;
  v_sent_at timestamptz;
begin
  -- Lock order for every application is queue, tenant connection, active user,
  -- per-user advisory lock, profile, facts by evidence key, edges by evidence key,
  -- draft history, then follow-up lifecycle row.
  select q.*
  into v_job
  from public.email_outbound_learning_queue q
  where q.id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'outbound learning job does not exist';
  end if;

  -- A committed transaction followed by a lost HTTP response must never apply
  -- the effects a second time, even though the caller still has its old lease.
  if v_job.status = 'completed' then
    if v_job.completed_lease_token is distinct from p_lease_token then
      raise exception 'outbound learning application lost lease ownership';
    end if;
    if v_job.apply_full_body_learning is true and not exists (
      select 1
      from public.email_outbound_writing_samples r
      where r.queue_id = v_job.id
    ) then
      raise exception 'completed outbound learning job is missing its receipt';
    end if;
    return v_job;
  end if;

  if v_job.status <> 'leased'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at <= now()
  then
    raise exception 'outbound learning application lost lease ownership';
  end if;

  select c0.id
  into v_company_id
  from public.companies c0
  where c0.id::text = v_job.company_id
  for share;

  if v_company_id is null then
    raise exception 'outbound learning company no longer exists';
  end if;

  perform 1
  from public.email_connections c
  where c.id = v_job.connection_id
    and c.company_id = v_job.company_id
    and (
      c.type = 'company'
      or c.user_id is null
      or c.user_id = v_job.user_id
    )
  for share;

  if not found then
    raise exception 'outbound learning connection ownership changed';
  end if;

  perform 1
  from public.users u
  where u.id::text = v_job.user_id
    and u.company_id::text = v_job.company_id
    and coalesce(u.is_active, true)
    and u.deleted_at is null
  for share;

  if not found then
    raise exception 'outbound learning user is no longer active in company';
  end if;

  if v_job.apply_learning is null
    or v_job.apply_full_body_learning is null
    or v_job.draft_outcome is null
    or v_job.draft_correction_facts is null
    or v_job.prepared_at is null
    or (
      v_job.apply_full_body_learning
      and (v_job.writing_sample is null or v_job.memory_extraction is null)
    )
  then
    raise exception 'outbound learning job has not been prepared';
  end if;

  v_draft_outcome := v_job.draft_outcome;

  if v_draft_outcome ->> 'finalVersion' is distinct from v_job.authored_body
    or v_draft_outcome ->> 'subject' is distinct from v_job.subject
  then
    raise exception 'outbound learning prepared outcome does not match sent message';
  end if;

  if v_job.apply_learning then
    perform pg_advisory_xact_lock(
      hashtextextended(v_job.company_id || ':' || v_job.user_id, 0)
    );

  if v_job.apply_full_body_learning then
  select r.*
  into v_writing_receipt
  from public.email_outbound_writing_samples r
  where r.queue_id = v_job.id
  for update;

  if v_writing_receipt.id is null then
    v_sample := v_job.writing_sample;
    v_profile_type := nullif(btrim(v_sample ->> 'profileType'), '');

    if v_profile_type is null
      or jsonb_typeof(v_sample -> 'formalityScore') is distinct from 'number'
      or jsonb_typeof(v_sample -> 'avgSentenceLength') is distinct from 'number'
    then
      raise exception 'prepared outbound learning writing sample is invalid';
    end if;

    insert into public.email_outbound_writing_samples (
      queue_id,
      company_id,
      connection_id,
      provider_message_id,
      user_id,
      profile_type,
      sample
    )
    values (
      v_job.id,
      v_job.company_id,
      v_job.connection_id,
      v_job.provider_message_id,
      v_job.user_id,
      v_profile_type,
      v_sample
    )
    returning * into v_writing_receipt;

    insert into public.agent_writing_profiles (
      company_id,
      user_id,
      profile_type,
      greeting_patterns,
      closing_patterns,
      vocabulary_preferences,
      tone_traits,
      emails_analyzed,
      updated_at
    )
    values (
      v_company_id,
      v_job.user_id,
      v_profile_type,
      '{}'::text[],
      '{}'::text[],
      '{}'::jsonb,
      '{}'::jsonb,
      0,
      now()
    )
    on conflict (company_id, user_id, profile_type) do nothing;

    select p.*
    into v_profile
    from public.agent_writing_profiles p
    where p.company_id = v_company_id
      and p.user_id = v_job.user_id
      and p.profile_type = v_profile_type
    for update;

    if v_profile.id is null then
      raise exception 'outbound learning writing profile could not be locked';
    end if;

    v_old_count := greatest(0, coalesce(v_profile.emails_analyzed, 0));
    v_new_count := v_old_count + 1;
    v_greetings := coalesce(v_profile.greeting_patterns, '{}'::text[]);
    v_closings := coalesce(v_profile.closing_patterns, '{}'::text[]);
    v_greeting := nullif(btrim(v_sample ->> 'greeting'), '');
    v_closing := nullif(btrim(v_sample ->> 'closing'), '');

    if v_greeting is not null and not (v_greeting = any(v_greetings)) then
      v_greetings := array_append(v_greetings, v_greeting);
    end if;
    if cardinality(v_greetings) > 10 then
      v_greetings := v_greetings[1:10];
    end if;

    if v_closing is not null and not (v_closing = any(v_closings)) then
      v_closings := array_append(v_closings, v_closing);
    end if;
    if cardinality(v_closings) > 10 then
      v_closings := v_closings[1:10];
    end if;

    v_vocab := coalesce(v_profile.vocabulary_preferences, '{}'::jsonb);

    select coalesce(
      jsonb_object_agg(
        current_metric.key,
        to_jsonb(
          (
            coalesce(
              (v_vocab #>> array['punctuation_habits', current_metric.key])::numeric,
              current_metric.value::numeric
            ) * v_old_count
            + current_metric.value::numeric
          ) / v_new_count
        )
      ),
      '{}'::jsonb
    )
    into v_punctuation
    from jsonb_each_text(coalesce(v_sample -> 'punctuation', '{}'::jsonb))
      as current_metric(key, value);

    v_vocab := v_vocab || jsonb_build_object(
      'hedging_tendency',
        (
          coalesce(
            (v_vocab ->> 'hedging_tendency')::numeric,
            coalesce((v_sample ->> 'hedgingFrequency')::numeric, 0)
          ) * v_old_count
          + coalesce((v_sample ->> 'hedgingFrequency')::numeric, 0)
        ) / v_new_count,
      'punctuation_habits',
        coalesce(v_vocab -> 'punctuation_habits', '{}'::jsonb) || v_punctuation,
      'paragraph_structure', jsonb_build_object(
        'bulletFrequency',
          (
            coalesce(
              (v_vocab #>> '{paragraph_structure,bulletFrequency}')::numeric,
              coalesce((v_sample #>> '{paragraphStructure,bulletFrequency}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{paragraphStructure,bulletFrequency}')::numeric, 0)
          ) / v_new_count,
        'avgParagraphLines',
          (
            coalesce(
              (v_vocab #>> '{paragraph_structure,avgParagraphLines}')::numeric,
              coalesce((v_sample #>> '{paragraphStructure,avgParagraphLines}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{paragraphStructure,avgParagraphLines}')::numeric, 0)
          ) / v_new_count,
        'prefersBullets',
          coalesce((v_sample #>> '{paragraphStructure,prefersBullets}')::boolean, false)
          or coalesce((v_vocab #>> '{paragraph_structure,prefersBullets}')::boolean, false)
      ),
      'vocabulary_complexity', jsonb_build_object(
        'avgWordLength',
          (
            coalesce(
              (v_vocab #>> '{vocabulary_complexity,avgWordLength}')::numeric,
              coalesce((v_sample #>> '{vocabularyComplexity,avgWordLength}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{vocabularyComplexity,avgWordLength}')::numeric, 0)
          ) / v_new_count,
        'uniqueWordRatio',
          (
            coalesce(
              (v_vocab #>> '{vocabulary_complexity,uniqueWordRatio}')::numeric,
              coalesce((v_sample #>> '{vocabularyComplexity,uniqueWordRatio}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{vocabularyComplexity,uniqueWordRatio}')::numeric, 0)
          ) / v_new_count,
        'usesTradeJargon',
          coalesce((v_sample #>> '{vocabularyComplexity,usesTradeJargon}')::boolean, false)
          or coalesce((v_vocab #>> '{vocabulary_complexity,usesTradeJargon}')::boolean, false)
      ),
      'engagement_style', jsonb_build_object(
        'questionsPerEmail',
          (
            coalesce(
              (v_vocab #>> '{engagement_style,questionsPerEmail}')::numeric,
              coalesce((v_sample #>> '{engagementStyle,questionsPerEmail}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{engagementStyle,questionsPerEmail}')::numeric, 0)
          ) / v_new_count,
        'directAddressFreq',
          (
            coalesce(
              (v_vocab #>> '{engagement_style,directAddressFreq}')::numeric,
              coalesce((v_sample #>> '{engagementStyle,directAddressFreq}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{engagementStyle,directAddressFreq}')::numeric, 0)
          ) / v_new_count,
        'firstPersonFreq',
          (
            coalesce(
              (v_vocab #>> '{engagement_style,firstPersonFreq}')::numeric,
              coalesce((v_sample #>> '{engagementStyle,firstPersonFreq}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{engagementStyle,firstPersonFreq}')::numeric, 0)
          ) / v_new_count
      ),
      'email_length', jsonb_build_object(
        'avgWordCount',
          (
            coalesce(
              (v_vocab #>> '{email_length,avgWordCount}')::numeric,
              coalesce((v_sample #>> '{emailLength,wordCount}')::numeric, 0)
            ) * v_old_count
            + coalesce((v_sample #>> '{emailLength,wordCount}')::numeric, 0)
          ) / v_new_count,
        'lengthDistribution', jsonb_build_object(
          'short',
            coalesce((v_vocab #>> '{email_length,lengthDistribution,short}')::integer, 0)
            + case when v_sample #>> '{emailLength,category}' = 'short' then 1 else 0 end,
          'medium',
            coalesce((v_vocab #>> '{email_length,lengthDistribution,medium}')::integer, 0)
            + case when v_sample #>> '{emailLength,category}' = 'medium' then 1 else 0 end,
          'long',
            coalesce((v_vocab #>> '{email_length,lengthDistribution,long}')::integer, 0)
            + case when v_sample #>> '{emailLength,category}' = 'long' then 1 else 0 end
        )
      ),
      'last_outbound_learning_queue_id', v_job.id
    );

    update public.agent_writing_profiles p
    set formality_score = (
          coalesce(p.formality_score, (v_sample ->> 'formalityScore')::numeric)
            * v_old_count
          + (v_sample ->> 'formalityScore')::numeric
        ) / v_new_count,
        avg_sentence_length = (
          coalesce(p.avg_sentence_length, (v_sample ->> 'avgSentenceLength')::numeric)
            * v_old_count
          + (v_sample ->> 'avgSentenceLength')::numeric
        ) / v_new_count,
        greeting_patterns = v_greetings,
        closing_patterns = v_closings,
        vocabulary_preferences = v_vocab,
        emails_analyzed = v_new_count,
        updated_at = now()
    where p.id = v_profile.id;

    update public.email_outbound_writing_samples r
    set profile_id = v_profile.id
    where r.id = v_writing_receipt.id
    returning * into v_writing_receipt;
  end if;
  end if;

  -- A provider-sync job can complete before the send route attaches its draft
  -- provenance. In that race the immutable writing receipt already exists, but
  -- a later preparation can contain new human-correction facts. Evidence has
  -- its own provider/evidence-key receipts, so always evaluate it here while
  -- still applying every individual effect at most once.
  for v_fact in
      select prepared_fact.value
      from (
        select fact.value
        from jsonb_array_elements(
          coalesce(v_job.memory_extraction -> 'facts', '[]'::jsonb)
        ) as fact(value)
        union all
        select correction.value
        from jsonb_array_elements(v_job.draft_correction_facts) as correction(value)
      ) as prepared_fact
      order by prepared_fact.value ->> 'evidenceKey'
    loop
      v_fact_json := v_fact.value;

      if nullif(btrim(v_fact_json ->> 'evidenceKey'), '') is null
        or length(v_fact_json ->> 'evidenceKey') > 200
        or nullif(btrim(v_fact_json ->> 'type'), '') is null
        or nullif(btrim(v_fact_json ->> 'category'), '') is null
        or nullif(btrim(v_fact_json ->> 'content'), '') is null
        or jsonb_typeof(v_fact_json -> 'confidence') is distinct from 'number'
      then
        raise exception 'prepared outbound learning fact is invalid';
      end if;

      if v_fact_json ? 'embedding'
        and jsonb_typeof(v_fact_json -> 'embedding') not in ('array', 'null')
      then
        raise exception 'prepared outbound learning fact embedding is invalid';
      end if;
      if jsonb_typeof(v_fact_json -> 'embedding') = 'array'
        and jsonb_array_length(v_fact_json -> 'embedding') <> 1536
      then
        raise exception 'prepared outbound learning fact embedding must have 1536 dimensions';
      end if;

      if exists (
        select 1
        from public.email_outbound_memory_evidence e
        where e.company_id = v_job.company_id
          and e.connection_id = v_job.connection_id
          and e.provider_message_id = v_job.provider_message_id
          and e.evidence_kind = 'fact'
          and e.evidence_key = v_fact_json ->> 'evidenceKey'
      ) then
        continue;
      end if;

      select m.*
      into v_memory
      from public.agent_memories m
      where m.company_id = v_company_id
        and m.user_id is not distinct from v_job.user_id
        and m.category = v_fact_json ->> 'category'
        and lower(regexp_replace(btrim(m.content), '[[:space:]]+', ' ', 'g'))
          = lower(regexp_replace(
              btrim(v_fact_json ->> 'content'),
              '[[:space:]]+',
              ' ',
              'g'
            ))
      order by m.id
      limit 1
      for update;

      if v_memory.id is not null then
        update public.agent_memories m
        set confidence = least(
              1.0,
              greatest(coalesce(m.confidence, 0.5), (v_fact_json ->> 'confidence')::numeric)
                + 0.05
            ),
            access_count = coalesce(m.access_count, 0) + 1,
            last_accessed_at = now(),
            updated_at = now()
        where m.id = v_memory.id
        returning m.id into v_memory_id;
        v_memory_effect := 'reinforced';
      else
        insert into public.agent_memories (
          company_id,
          user_id,
          memory_type,
          category,
          content,
          embedding,
          confidence,
          source,
          source_id,
          last_accessed_at,
          access_count,
          updated_at
        )
        values (
          v_company_id,
          v_job.user_id,
          v_fact_json ->> 'type',
          v_fact_json ->> 'category',
          v_fact_json ->> 'content',
          case
            when jsonb_typeof(v_fact_json -> 'embedding') = 'array'
              then (v_fact_json -> 'embedding')::text::extensions.vector(1536)
            else null
          end,
          greatest(0.0, least(1.0, (v_fact_json ->> 'confidence')::numeric)),
          case
            when v_fact_json ->> 'category' = 'correction' then 'draft_edit'
            else 'email'
          end,
          v_job.provider_message_id,
          now(),
          1,
          now()
        )
        returning id into v_memory_id;
        v_memory_effect := 'inserted';
      end if;

      insert into public.email_outbound_memory_evidence (
        queue_id,
        writing_sample_id,
        company_id,
        connection_id,
        provider_message_id,
        user_id,
        evidence_kind,
        evidence_key,
        effect,
        memory_id
      )
      values (
        v_job.id,
        v_writing_receipt.id,
        v_job.company_id,
        v_job.connection_id,
        v_job.provider_message_id,
        v_job.user_id,
        'fact',
        v_fact_json ->> 'evidenceKey',
        v_memory_effect,
        v_memory_id
      );
  end loop;

  for v_edge in
      select edge.value
      from jsonb_array_elements(
        coalesce(v_job.memory_extraction -> 'edges', '[]'::jsonb)
      ) as edge(value)
      order by edge.value ->> 'evidenceKey'
    loop
      v_edge_json := v_edge.value;

      if nullif(btrim(v_edge_json ->> 'evidenceKey'), '') is null
        or length(v_edge_json ->> 'evidenceKey') > 200
        or nullif(btrim(v_edge_json ->> 'subjectType'), '') is null
        or nullif(btrim(v_edge_json ->> 'subjectId'), '') is null
        or nullif(btrim(v_edge_json ->> 'predicate'), '') is null
        or nullif(btrim(v_edge_json ->> 'objectType'), '') is null
        or nullif(btrim(v_edge_json ->> 'objectId'), '') is null
      then
        raise exception 'prepared outbound learning edge is invalid';
      end if;

      if exists (
        select 1
        from public.email_outbound_memory_evidence e
        where e.company_id = v_job.company_id
          and e.connection_id = v_job.connection_id
          and e.provider_message_id = v_job.provider_message_id
          and e.evidence_kind = 'edge'
          and e.evidence_key = v_edge_json ->> 'evidenceKey'
      ) then
        continue;
      end if;

      insert into public.agent_knowledge_graph as existing_graph (
        company_id,
        subject_type,
        subject_id,
        predicate,
        object_type,
        object_id,
        properties,
        confidence,
        valid_from,
        updated_at
      )
      values (
        v_company_id,
        v_edge_json ->> 'subjectType',
        v_edge_json ->> 'subjectId',
        v_edge_json ->> 'predicate',
        v_edge_json ->> 'objectType',
        v_edge_json ->> 'objectId',
        coalesce(v_edge_json -> 'properties', '{}'::jsonb),
        0.8,
        coalesce(v_job.occurred_at, now()),
        now()
      )
      on conflict (
        company_id,
        subject_type,
        subject_id,
        predicate,
        object_type,
        object_id
      )
      do update set
        properties = coalesce(existing_graph.properties, '{}'::jsonb)
          || excluded.properties,
        confidence = greatest(
          coalesce(existing_graph.confidence, 0.0),
          excluded.confidence
        ),
        valid_to = null,
        updated_at = now()
      returning id into v_graph_id;

      insert into public.email_outbound_memory_evidence (
        queue_id,
        writing_sample_id,
        company_id,
        connection_id,
        provider_message_id,
        user_id,
        evidence_kind,
        evidence_key,
        effect,
        knowledge_graph_id
      )
      values (
        v_job.id,
        v_writing_receipt.id,
        v_job.company_id,
        v_job.connection_id,
        v_job.provider_message_id,
        v_job.user_id,
        'edge',
        v_edge_json ->> 'evidenceKey',
        'upserted',
        v_graph_id
      );
  end loop;

  update public.email_outbound_learning_queue q
  set applied_at = coalesce(q.applied_at, now()),
      updated_at = now()
  where q.id = v_job.id
  returning * into v_job;
  end if;

  v_effective_follow_up_id := v_job.follow_up_draft_id;
  v_effective_draft_id := v_job.draft_history_id;
  v_sent_at := coalesce(v_job.occurred_at, now());

  if v_effective_draft_id is not null then
    select d.*
    into v_draft
    from public.ai_draft_history d
    where d.id = v_effective_draft_id
    for update;

    if v_draft.id is null
      or v_draft.company_id <> v_company_id
      or v_draft.user_id::text <> v_job.user_id
      or (
        v_draft.connection_id is not null
        and v_draft.connection_id <> v_job.connection_id
      )
      or (
        v_job.opportunity_id is not null
        and v_draft.opportunity_id is not null
        and v_draft.opportunity_id <> v_job.opportunity_id
      )
      or (
        v_job.provider_thread_id is not null
        and v_draft.thread_id is not null
        and v_draft.thread_id <> v_job.provider_thread_id
      )
    then
      raise exception 'outbound learning draft history provenance changed';
    end if;

    if v_draft.status not in ('drafted', 'auto_drafted', 'sent', 'sent_from_mailbox') then
      raise exception 'outbound learning draft history is not eligible for sent outcome';
    end if;

    if v_draft.status in ('sent', 'sent_from_mailbox')
      and v_draft.final_version is not null
      and btrim(v_draft.final_version) <> btrim(v_job.authored_body)
    then
      raise exception 'outbound learning draft history was sent with another body';
    end if;

    if v_draft.sent_provider_message_id is not null
      and v_draft.sent_provider_message_id <> v_job.provider_message_id
    then
      raise exception 'outbound learning draft history was sent as another provider message';
    end if;

    if (
      v_draft.status = 'sent_from_mailbox'
      and v_job.draft_delivery_channel <> 'mailbox'
    ) or (
      v_draft.status = 'sent'
      and v_job.draft_delivery_channel <> 'ops_send'
    ) then
      raise exception 'outbound learning draft history delivery channel changed';
    end if;

    update public.ai_draft_history d
    set connection_id = coalesce(d.connection_id, v_job.connection_id),
        opportunity_id = coalesce(d.opportunity_id, v_job.opportunity_id),
        thread_id = coalesce(d.thread_id, v_job.provider_thread_id),
        final_version = v_draft_outcome ->> 'finalVersion',
        edit_distance = (v_draft_outcome ->> 'editDistance')::integer,
        changes_made = v_draft_outcome -> 'changesMade',
        status = case
          when v_job.draft_delivery_channel = 'mailbox' then 'sent_from_mailbox'
          else 'sent'
        end,
        sent_provider_message_id = coalesce(d.sent_provider_message_id, v_job.provider_message_id),
        sent_without_changes = (v_draft_outcome ->> 'sentWithoutChanges')::boolean,
        sent_at = coalesce(d.sent_at, v_sent_at),
        edited_at = case
          when (v_draft_outcome ->> 'edited')::boolean
            then coalesce(d.edited_at, v_sent_at)
          else d.edited_at
        end,
        subject_source = case
          when (v_draft_outcome ->> 'subjectEdited')::boolean
            then 'operator'
          else d.subject_source
        end,
        subject = v_draft_outcome ->> 'subject'
    where d.id = v_effective_draft_id;
  end if;

  if v_effective_follow_up_id is not null then
    select f.*
    into v_follow_up
    from public.opportunity_follow_up_drafts f
    where f.id = v_effective_follow_up_id
    for update;

    if v_follow_up.id is null
      or v_follow_up.company_id <> v_company_id
      or (
        v_follow_up.connection_id is not null
        and v_follow_up.connection_id <> v_job.connection_id
      )
      or (
        v_job.opportunity_id is not null
        and v_follow_up.opportunity_id <> v_job.opportunity_id
      )
      or (
        v_job.provider_thread_id is not null
        and v_follow_up.provider_thread_id is not null
        and v_follow_up.provider_thread_id <> v_job.provider_thread_id
      )
      or v_follow_up.ai_draft_history_id is distinct from v_effective_draft_id
    then
      raise exception 'outbound learning follow-up draft provenance changed';
    end if;

    if v_follow_up.status not in ('drafted', 'sent') then
      raise exception 'outbound learning follow-up draft is not eligible for sent outcome';
    end if;

    if v_follow_up.status = 'sent'
      and v_follow_up.final_sent_body is not null
      and btrim(v_follow_up.final_sent_body) <> btrim(v_job.authored_body)
    then
      raise exception 'outbound learning follow-up draft was sent with another body';
    end if;

    update public.opportunity_follow_up_drafts f
    set connection_id = coalesce(f.connection_id, v_job.connection_id),
        provider_thread_id = coalesce(f.provider_thread_id, v_job.provider_thread_id),
        ai_draft_history_id = coalesce(f.ai_draft_history_id, v_effective_draft_id),
        subject = coalesce(v_job.subject, f.subject),
        final_sent_body = v_job.authored_body,
        status = 'sent',
        edited_by = v_job.user_id::uuid,
        edited_at = case
          when btrim(coalesce(f.current_body, f.original_body)) <> btrim(v_job.authored_body)
            or (
              v_job.subject is not null
              and v_job.subject is distinct from f.subject
            )
            then coalesce(f.edited_at, v_sent_at)
          else f.edited_at
        end,
        sent_at = coalesce(f.sent_at, v_sent_at),
        updated_at = now()
    where f.id = v_effective_follow_up_id;
  end if;

  update public.email_outbound_learning_queue q
  set draft_history_id = coalesce(q.draft_history_id, v_effective_draft_id),
      follow_up_draft_id = coalesce(q.follow_up_draft_id, v_effective_follow_up_id),
      status = 'completed',
      applied_at = coalesce(q.applied_at, now()),
      completed_at = now(),
      completed_lease_token = p_lease_token,
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = now()
  where q.id = v_job.id
    and q.status = 'leased'
    and q.lease_token = p_lease_token
    and q.lease_expires_at > now()
  returning * into v_job;

  if v_job.id is null then
    raise exception 'outbound learning application lost lease ownership';
  end if;

  return v_job;
end;
$$;

create or replace function public.retry_email_outbound_learning(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_row public.email_outbound_learning_queue;
  v_delay_seconds integer;
begin
  select q.*
  into v_row
  from public.email_outbound_learning_queue q
  where q.id = p_job_id
  for update;

  if v_row.id is null then
    raise exception 'outbound learning job does not exist';
  end if;

  if v_row.status = 'completed' then
    if v_row.completed_lease_token is distinct from p_lease_token then
      raise exception 'outbound learning retry lost lease ownership';
    end if;
    return v_row;
  end if;

  if v_row.status <> 'leased'
    or v_row.lease_token is distinct from p_lease_token
    or v_row.lease_expires_at <= now()
  then
    raise exception 'outbound learning retry lost lease ownership';
  end if;

  v_delay_seconds := least(3600,
    (30 * power(2::numeric, greatest(0, v_row.attempts - 1)))::integer
  );

  update public.email_outbound_learning_queue
  set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
      next_attempt_at = case
        when attempts >= max_attempts then now()
        else now() + make_interval(secs => v_delay_seconds)
      end,
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_error, 'outbound learning failed'), 4000),
      last_failed_at = case
        when attempts >= max_attempts then now()
        else last_failed_at
      end,
      last_terminal_error = case
        when attempts >= max_attempts
          then left(coalesce(p_error, 'outbound learning failed'), 4000)
        else last_terminal_error
      end,
      updated_at = now()
  where id = p_job_id
    and status = 'leased'
    and lease_token = p_lease_token
    and lease_expires_at > now()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'outbound learning retry lost lease ownership';
  end if;

  return v_row;
end;
$$;

create or replace function public.defer_email_outbound_learning(
  p_job_id uuid,
  p_lease_token uuid,
  p_reason text,
  p_delay_seconds integer default 900
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_row public.email_outbound_learning_queue;
  v_delay_seconds integer := greatest(
    30,
    least(coalesce(p_delay_seconds, 900), 86400)
  );
begin
  select q.*
  into v_row
  from public.email_outbound_learning_queue q
  where q.id = p_job_id
  for update;

  if v_row.id is null then
    raise exception 'outbound learning job does not exist';
  end if;

  if v_row.status = 'completed' then
    if v_row.completed_lease_token is distinct from p_lease_token then
      raise exception 'outbound learning deferral lost lease ownership';
    end if;
    return v_row;
  end if;

  if v_row.status <> 'leased'
    or v_row.lease_token is distinct from p_lease_token
    or v_row.lease_expires_at <= now()
  then
    raise exception 'outbound learning deferral lost lease ownership';
  end if;

  update public.email_outbound_learning_queue
  set status = 'pending',
      attempts = greatest(0, attempts - 1),
      next_attempt_at = now() + make_interval(secs => v_delay_seconds),
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_reason, 'outbound learning deferred'), 4000),
      updated_at = now()
  where id = p_job_id
    and status = 'leased'
    and lease_token = p_lease_token
    and lease_expires_at > now()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'outbound learning deferral lost lease ownership';
  end if;

  return v_row;
end;
$$;

-- Sanitized operational read surface. It intentionally omits addresses,
-- subject/body content, and every prepared model payload.
create or replace function public.diagnose_email_outbound_learning(
  p_company_id text default null,
  p_status text default null,
  p_limit integer default 100,
  p_before_sort_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  company_id text,
  connection_id uuid,
  provider_message_id text,
  provider_thread_id text,
  user_id text,
  opportunity_id uuid,
  draft_history_id uuid,
  follow_up_draft_id uuid,
  draft_delivery_channel text,
  status text,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  lease_expires_at timestamptz,
  last_error text,
  last_failed_at timestamptz,
  last_terminal_error text,
  requeue_count integer,
  last_requeued_at timestamptz,
  last_requeue_reason text,
  is_prepared boolean,
  has_learning_receipt boolean,
  applied_at timestamptz,
  completed_at timestamptz,
  occurred_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_status text := nullif(btrim(p_status), '');
begin
  if v_status is not null
    and v_status not in ('pending', 'leased', 'completed', 'failed')
  then
    raise exception 'outbound learning diagnostic status is invalid';
  end if;

  if (p_before_sort_at is null) is distinct from (p_before_id is null) then
    raise exception 'outbound learning diagnostic cursor is incomplete';
  end if;

  if v_status = 'failed' then
    return query
    select
      q.id,
      q.company_id,
      q.connection_id,
      q.provider_message_id,
      q.provider_thread_id,
      q.user_id,
      q.opportunity_id,
      q.draft_history_id,
      q.follow_up_draft_id,
      q.draft_delivery_channel,
      q.status,
      q.attempts,
      q.max_attempts,
      q.next_attempt_at,
      q.lease_expires_at,
      q.last_error,
      q.last_failed_at,
      q.last_terminal_error,
      q.requeue_count,
      q.last_requeued_at,
      q.last_requeue_reason,
      q.prepared_at is not null,
      exists (
        select 1
        from public.email_outbound_writing_samples r
        where r.queue_id = q.id
      ),
      q.applied_at,
      q.completed_at,
      q.occurred_at,
      q.created_at,
      q.updated_at
    from public.email_outbound_learning_queue q
    where q.status = 'failed'
      and (p_company_id is null or q.company_id = p_company_id)
      and (
        p_before_sort_at is null
        or (q.last_failed_at, q.id) < (p_before_sort_at, p_before_id)
      )
    order by q.last_failed_at desc, q.id desc
    limit v_limit;
    return;
  end if;

  return query
  select
    q.id,
    q.company_id,
    q.connection_id,
    q.provider_message_id,
    q.provider_thread_id,
    q.user_id,
    q.opportunity_id,
    q.draft_history_id,
    q.follow_up_draft_id,
    q.draft_delivery_channel,
    q.status,
    q.attempts,
    q.max_attempts,
    q.next_attempt_at,
    q.lease_expires_at,
    q.last_error,
    q.last_failed_at,
    q.last_terminal_error,
    q.requeue_count,
    q.last_requeued_at,
    q.last_requeue_reason,
    q.prepared_at is not null,
    exists (
      select 1
      from public.email_outbound_writing_samples r
      where r.queue_id = q.id
    ),
    q.applied_at,
    q.completed_at,
    q.occurred_at,
    q.created_at,
    q.updated_at
  from public.email_outbound_learning_queue q
  where (p_company_id is null or q.company_id = p_company_id)
    and (v_status is null or q.status = v_status)
    and (
      p_before_sort_at is null
      or (q.created_at, q.id) < (p_before_sort_at, p_before_id)
    )
  order by q.created_at desc, q.id desc
  limit v_limit;
end;
$$;

create or replace function public.requeue_failed_email_outbound_learning(
  p_job_id uuid,
  p_reason text
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_row public.email_outbound_learning_queue;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_reason is null then
    raise exception 'outbound learning requeue reason is required';
  end if;

  select q.*
  into v_row
  from public.email_outbound_learning_queue q
  where q.id = p_job_id
  for update;

  if v_row.id is null then
    raise exception 'outbound learning job does not exist';
  end if;
  if v_row.status <> 'failed' then
    raise exception 'only failed outbound learning jobs can be requeued';
  end if;

  update public.email_outbound_learning_queue q
  set status = 'pending',
      attempts = 0,
      next_attempt_at = now(),
      lease_token = null,
      lease_expires_at = null,
      completed_lease_token = null,
      completed_at = null,
      last_error = null,
      requeue_count = q.requeue_count + 1,
      last_requeued_at = now(),
      last_requeue_reason = left(v_reason, 1000),
      updated_at = now()
  where q.id = p_job_id
    and q.status = 'failed'
  returning q.* into v_row;

  if v_row.id is null then
    raise exception 'outbound learning job changed before requeue';
  end if;

  return v_row;
end;
$$;

revoke all on function public.enqueue_email_outbound_learning(text, uuid, text, text, text, text, text[], text, text, text, timestamptz, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_outbound_learning(text, uuid, text, text, text, text, text[], text, text, text, timestamptz, uuid, uuid, uuid, text) to service_role;

revoke all on function public.claim_email_outbound_learning(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_email_outbound_learning(integer, integer) to service_role;

revoke all on function public.prepare_email_outbound_learning(uuid, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.prepare_email_outbound_learning(uuid, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb, text) to service_role;

revoke all on function public.apply_email_outbound_learning(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.apply_email_outbound_learning(uuid, uuid) to service_role;

revoke all on function public.retry_email_outbound_learning(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.retry_email_outbound_learning(uuid, uuid, text) to service_role;

revoke all on function public.defer_email_outbound_learning(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.defer_email_outbound_learning(uuid, uuid, text, integer) to service_role;

revoke all on function public.diagnose_email_outbound_learning(text, text, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.diagnose_email_outbound_learning(text, text, integer, timestamptz, uuid) to service_role;

revoke all on function public.requeue_failed_email_outbound_learning(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.requeue_failed_email_outbound_learning(uuid, text) to service_role;

comment on table public.email_outbound_learning_queue is
  'Durable sanitized outbound-learning ledger. Service-role callers may mutate it only through the narrow queue RPCs.';

comment on table public.email_outbound_writing_samples is
  'Immutable provider-message receipt proving the corresponding writing-profile sample was applied exactly once.';

comment on table public.email_outbound_memory_evidence is
  'Provider-message/evidence-key receipts proving memory and graph effects were applied exactly once.';

commit;
