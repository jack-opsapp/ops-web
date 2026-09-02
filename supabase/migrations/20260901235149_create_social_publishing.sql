-- Durable, service-role-only queue for scheduled-agent Instagram publishing.
-- Production application is an explicit release gate; this migration is local only.

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  contract_version text not null,

  source_type text not null
    check (source_type in ('blog', 'feature', 'insight', 'field_dispatch', 'performance_proof', 'release_note', 'roast', 'custom')),
  source_id text,
  source_url text,

  story_type text not null
    check (story_type in ('blog_signal', 'field_dispatch', 'operator_protocol', 'performance_proof', 'release_note', 'roast_card')),
  visual_treatment text not null
    check (visual_treatment in ('editorial_cover', 'split_signal', 'operator_brief', 'field_frame', 'proof_board', 'signal_grid', 'roast_file')),
  post_format text not null
    check (post_format in ('single', 'carousel')),

  content jsonb not null
    check (jsonb_typeof(content) = 'object'),
  caption text not null,
  alt_text text not null,
  agent_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(agent_preferences) = 'object'),
  selection_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(selection_metadata) = 'object'),
  rendered_assets jsonb not null default '[]'::jsonb
    check (jsonb_typeof(rendered_assets) = 'array'),

  status text not null default 'rendering'
    check (status in ('rendering', 'review', 'publishing', 'published', 'cancelled', 'failed')),
  publish_after timestamptz not null default (now() + interval '10 minutes'),
  requested_publish_at timestamptz,
  rendered_at timestamptz,
  published_at timestamptz,
  cancelled_at timestamptz,

  attempt_count integer not null default 0
    check (attempt_count >= 0),
  max_attempts integer not null default 4
    check (max_attempts between 1 and 10),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  publish_stage text not null default 'idle'
    check (publish_stage in ('idle', 'claimed', 'container_ready', 'publish_requested', 'publish_succeeded', 'reconciliation_required')),
  publish_attempts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(publish_attempts) = 'array'),
  recovery_notification_pending boolean not null default false,
  recovery_notification_claim_token uuid,
  recovery_notification_claim_expires_at timestamptz,
  recovery_notified_at timestamptz,

  last_error_code text,
  last_error_message text,
  last_error_retryable boolean,
  instagram_media_id text,
  instagram_permalink text,

  render_version text not null,
  selector_version text not null,
  voice_reference_version text not null,
  created_by text not null,
  updated_by text not null,
  audit_log jsonb not null default '[]'::jsonb
    check (jsonb_typeof(audit_log) = 'array'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint social_posts_source_url_https
    check (source_url is null or source_url ~ '^https://'),
  constraint social_posts_blog_source_required
    check (source_type <> 'blog' or source_id is not null),
  constraint social_posts_carousel_asset_shape
    check (
      status = 'rendering'
      or (post_format = 'single' and jsonb_array_length(rendered_assets) = 1)
      or (post_format = 'carousel' and jsonb_array_length(rendered_assets) between 2 and 10)
      or status in ('failed', 'cancelled')
    ),
  constraint social_posts_published_identity_required
    check (
      status <> 'published'
      or (
        instagram_media_id is not null
        and published_at is not null
      )
    ),
  constraint social_posts_cancelled_timestamp_required
    check (status <> 'cancelled' or cancelled_at is not null),
  constraint social_posts_recovery_notification_claim_pair
    check (
      (recovery_notification_claim_token is null and recovery_notification_claim_expires_at is null)
      or
      (recovery_notification_claim_token is not null and recovery_notification_claim_expires_at is not null)
    )
);

comment on table public.social_posts is
  'Service-role-only queue and audit record for scheduled-agent Instagram publishing.';
comment on column public.social_posts.content is
  'Validated, versioned scheduled-agent payload after authoritative source enrichment.';
comment on column public.social_posts.rendered_assets is
  'Ordered public JPEG metadata consumed by Instagram and the admin artifact preview.';

create index social_posts_due_idx
  on public.social_posts (publish_after, next_attempt_at, claim_expires_at)
  where status in ('review', 'publishing', 'failed');

create index social_posts_history_idx
  on public.social_posts (created_at desc, visual_treatment, post_format)
  where status in ('review', 'publishing', 'published');

create index social_posts_source_idx
  on public.social_posts (source_type, source_id, created_at desc);

create index social_posts_recovery_notification_idx
  on public.social_posts (recovery_notification_claim_expires_at, updated_at)
  where recovery_notification_pending is true;

alter table public.social_posts enable row level security;

revoke all on table public.social_posts from public, anon, authenticated;
grant select, insert, update, delete on table public.social_posts to service_role;

drop trigger if exists social_posts_set_updated_at on public.social_posts;
create trigger social_posts_set_updated_at
  before update on public.social_posts
  for each row execute function public.fn_set_updated_at();

-- Recovery alerts are lifecycle projections, not permanent warnings. Any
-- operator-approved transition away from failed state cancels pending outbox
-- work and resolves the exact delivered alert in the same transaction.
create or replace function public.fn_resolve_social_recovery_on_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'failed' and new.status <> 'failed' then
    new.recovery_notification_pending = false;
    new.recovery_notification_claim_token = null;
    new.recovery_notification_claim_expires_at = null;

    update public.notifications as notification
    set
      is_read = true,
      resolved_at = coalesce(notification.resolved_at, now())
    where notification.type = 'social_post_failed'
      and notification.dedupe_key = 'social-recovery:' || new.id::text
      and notification.resolved_at is null;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_resolve_social_recovery_on_transition() from public, anon, authenticated;

drop trigger if exists social_posts_resolve_recovery_on_transition on public.social_posts;
create trigger social_posts_resolve_recovery_on_transition
  before update of status on public.social_posts
  for each row execute function public.fn_resolve_social_recovery_on_transition();

create or replace function public.claim_due_social_posts(
  p_claim_token uuid,
  p_limit integer default 2,
  p_claim_ttl_seconds integer default 180
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_claim_token is null then
    raise exception 'claim token is required' using errcode = '22023';
  end if;

  if p_limit < 1 or p_limit > 10 then
    raise exception 'claim limit must be between 1 and 10' using errcode = '22023';
  end if;

  if p_claim_ttl_seconds < 30 or p_claim_ttl_seconds > 900 then
    raise exception 'claim ttl must be between 30 and 900 seconds' using errcode = '22023';
  end if;

  -- A renderer is entirely internal. If it disappears, preserve the last
  -- complete package and require a fresh edit instead of leaving a dead row.
  update public.social_posts as social_post
  set
    status = 'failed',
    publish_stage = 'idle',
    last_error_code = 'STALE_RENDERING',
    last_error_message = 'Rendering did not finish. Edit the post to render a fresh package.',
    last_error_retryable = false,
    next_attempt_at = null,
    claim_token = null,
    claim_expires_at = null,
    recovery_notification_pending = true,
    recovery_notification_claim_token = null,
    recovery_notification_claim_expires_at = null,
    recovery_notified_at = null,
    updated_by = 'system:publisher',
    audit_log = social_post.audit_log || jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'actor', 'system:publisher',
        'from', 'rendering',
        'to', 'failed',
        'event', 'stale_render_recovered'
      )
    )
  where social_post.status = 'rendering'
    and social_post.updated_at <= now() - interval '15 minutes';

  -- Once media_publish may have been sent, automatic recovery is unsafe.
  -- Surface these rows for human reconciliation instead of ever reclaiming.
  update public.social_posts as social_post
  set
    status = 'failed',
    publish_stage = 'reconciliation_required',
    last_error_code = case
      when social_post.publish_stage = 'publish_succeeded' then 'PUBLISHED_ACK_NOT_PERSISTED'
      else 'PUBLISH_OUTCOME_UNKNOWN'
    end,
    last_error_message = 'Instagram may already contain this post. Reconcile the account before taking another action.',
    last_error_retryable = false,
    next_attempt_at = null,
    claim_token = null,
    claim_expires_at = null,
    recovery_notification_pending = true,
    recovery_notification_claim_token = null,
    recovery_notification_claim_expires_at = null,
    recovery_notified_at = null,
    updated_by = 'system:publisher',
    audit_log = social_post.audit_log || jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'actor', 'system:publisher',
        'from', 'publishing',
        'to', 'failed',
        'event', 'publish_reconciliation_required',
        'metadata', jsonb_build_object('prior_stage', social_post.publish_stage)
      )
    )
  where social_post.status = 'publishing'
    and social_post.claim_expires_at <= now()
    and social_post.publish_stage in ('publish_requested', 'publish_succeeded');

  -- A pre-publish lease is safe to retry only while an attempt remains. The
  -- final expired lease becomes an explicit operator recovery instead of a
  -- publishing row that can never be claimed again.
  update public.social_posts as social_post
  set
    status = 'failed',
    publish_stage = 'idle',
    last_error_code = 'PUBLISH_ATTEMPTS_EXHAUSTED',
    last_error_message = 'The final publishing lease expired before Instagram was called. Review the post before creating a fresh launch.',
    last_error_retryable = false,
    next_attempt_at = null,
    claim_token = null,
    claim_expires_at = null,
    recovery_notification_pending = true,
    recovery_notification_claim_token = null,
    recovery_notification_claim_expires_at = null,
    recovery_notified_at = null,
    updated_by = 'system:publisher',
    audit_log = social_post.audit_log || jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'actor', 'system:publisher',
        'from', 'publishing',
        'to', 'failed',
        'event', 'publish_attempts_exhausted',
        'metadata', jsonb_build_object(
          'prior_stage', social_post.publish_stage,
          'attempt_count', social_post.attempt_count
        )
      )
    )
  where social_post.status = 'publishing'
    and social_post.claim_expires_at <= now()
    and social_post.publish_stage in ('claimed', 'container_ready')
    and social_post.attempt_count >= social_post.max_attempts;

  return query
  with candidates as (
    select social_post.id
    from public.social_posts as social_post
    where (
        social_post.status = 'review'
        or (
          social_post.status = 'failed'
          and social_post.last_error_retryable is true
        )
        or (
          social_post.status = 'publishing'
          and social_post.publish_stage in ('claimed', 'container_ready')
          and social_post.claim_expires_at <= now()
        )
      )
      and social_post.publish_after <= now()
      and (social_post.next_attempt_at is null or social_post.next_attempt_at <= now())
      and social_post.attempt_count < social_post.max_attempts
      and (social_post.claim_expires_at is null or social_post.claim_expires_at <= now())
    order by social_post.publish_after asc, social_post.created_at asc
    for update skip locked
    limit p_limit
  )
  update public.social_posts as social_post
  set
    status = 'publishing',
    claim_token = p_claim_token,
    claim_expires_at = now() + make_interval(secs => p_claim_ttl_seconds),
    publish_stage = 'claimed',
    publish_attempts = social_post.publish_attempts || jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'attempt', social_post.attempt_count + 1,
        'stage', 'claimed',
        'claim_token', p_claim_token
      )
    ),
    attempt_count = social_post.attempt_count + 1,
    last_attempt_at = now(),
    updated_by = 'system:publisher',
    audit_log = social_post.audit_log || jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'actor', 'system:publisher',
        'from', social_post.status,
        'to', 'publishing',
        'event', 'claimed',
        'claim_token', p_claim_token
      )
    )
  from candidates
  where social_post.id = candidates.id
  returning social_post.*;
end;
$$;

revoke all on function public.claim_due_social_posts(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_social_posts(uuid, integer, integer) to service_role;

create or replace function public.claim_social_recovery_notifications(
  p_claim_token uuid,
  p_limit integer default 10,
  p_claim_ttl_seconds integer default 180
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_claim_token is null then
    raise exception 'recovery notification claim token is required' using errcode = '22023';
  end if;

  if p_limit < 1 or p_limit > 25 then
    raise exception 'recovery notification limit must be between 1 and 25' using errcode = '22023';
  end if;

  if p_claim_ttl_seconds < 30 or p_claim_ttl_seconds > 900 then
    raise exception 'recovery notification claim ttl must be between 30 and 900 seconds' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select social_post.id
    from public.social_posts as social_post
    where social_post.status = 'failed'
      and social_post.recovery_notification_pending is true
      and (
        social_post.recovery_notification_claim_token is null
        or social_post.recovery_notification_claim_expires_at <= now()
      )
    order by social_post.updated_at asc, social_post.id asc
    for update skip locked
    limit p_limit
  )
  update public.social_posts as social_post
  set
    recovery_notification_claim_token = p_claim_token,
    recovery_notification_claim_expires_at = now() + make_interval(secs => p_claim_ttl_seconds),
    updated_by = 'system:publisher'
  from candidates
  where social_post.id = candidates.id
  returning social_post.*;
end;
$$;

revoke all on function public.claim_social_recovery_notifications(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_social_recovery_notifications(uuid, integer, integer) to service_role;

create or replace function public.deliver_social_recovery_notification(
  p_post_id uuid,
  p_claim_token uuid,
  p_user_id uuid,
  p_company_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts%rowtype;
begin
  if p_post_id is null or p_claim_token is null or p_user_id is null or p_company_id is null then
    raise exception 'recovery notification identity is required' using errcode = '22023';
  end if;

  select social_post.*
  into v_post
  from public.social_posts as social_post
  where social_post.id = p_post_id
    and social_post.status = 'failed'
    and social_post.recovery_notification_pending is true
    and social_post.recovery_notification_claim_token = p_claim_token
    and social_post.recovery_notification_claim_expires_at > now()
  for update;

  if v_post.id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.users as operator_user
    join public.companies as operator_company
      on operator_company.id = operator_user.company_id
    where operator_user.id = p_user_id
      and operator_user.company_id = p_company_id
      and operator_user.deleted_at is null
      and coalesce(operator_user.is_active, false)
      and operator_company.deleted_at is null
  ) then
    raise exception 'social recovery notification recipient is unavailable' using errcode = '42501';
  end if;

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
    dedupe_key
  )
  values (
    p_user_id::text,
    p_company_id::text,
    'social_post_failed',
    'SOCIAL PUBLISH NEEDS REVIEW · ' || upper(left(v_post.id::text, 8)),
    left(coalesce(v_post.last_error_code, 'SOCIAL_RECOVERY_REQUIRED') || ' · ' || coalesce(v_post.last_error_message, 'Review this Instagram post before taking another action.'), 300),
    false,
    true,
    '/admin/social?post=' || v_post.id::text,
    'OPEN FAILURE',
    'social-recovery:' || v_post.id::text
  )
  on conflict do nothing;

  update public.social_posts as social_post
  set
    recovery_notification_pending = false,
    recovery_notification_claim_token = null,
    recovery_notification_claim_expires_at = null,
    recovery_notified_at = now(),
    updated_by = 'system:publisher',
    audit_log = social_post.audit_log || jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'actor', 'system:publisher',
        'from', 'failed',
        'to', 'failed',
        'event', 'recovery_notification_delivered'
      )
    )
  where social_post.id = v_post.id;

  return true;
end;
$$;

revoke all on function public.deliver_social_recovery_notification(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.deliver_social_recovery_notification(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.claim_social_post_by_id(
  p_post_id uuid,
  p_claim_token uuid,
  p_claim_ttl_seconds integer default 180
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_post_id is null or p_claim_token is null then
    raise exception 'post id and claim token are required' using errcode = '22023';
  end if;

  if p_claim_ttl_seconds < 30 or p_claim_ttl_seconds > 900 then
    raise exception 'claim ttl must be between 30 and 900 seconds' using errcode = '22023';
  end if;

  return query
  update public.social_posts as social_post
  set
    status = 'publishing',
    claim_token = p_claim_token,
    claim_expires_at = now() + make_interval(secs => p_claim_ttl_seconds),
    publish_stage = 'claimed',
    publish_attempts = social_post.publish_attempts || jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'attempt', social_post.attempt_count + 1,
        'stage', 'claimed',
        'claim_token', p_claim_token
      )
    ),
    attempt_count = social_post.attempt_count + 1,
    last_attempt_at = now(),
    next_attempt_at = null,
    updated_by = 'admin:publish-now',
    audit_log = social_post.audit_log || jsonb_build_array(
      jsonb_build_object(
        'at', now(),
        'actor', 'admin:publish-now',
        'from', social_post.status,
        'to', 'publishing',
        'event', 'claimed_manual',
        'claim_token', p_claim_token
      )
    )
  where social_post.id = p_post_id
    and social_post.status = 'review'
    and social_post.publish_stage = 'idle'
    and social_post.attempt_count < social_post.max_attempts
    and (social_post.claim_expires_at is null or social_post.claim_expires_at <= now())
  returning social_post.*;
end;
$$;

revoke all on function public.claim_social_post_by_id(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_social_post_by_id(uuid, uuid, integer) to service_role;

create or replace function public.record_social_publish_stage(
  p_post_id uuid,
  p_claim_token uuid,
  p_stage text,
  p_container_id text,
  p_media_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  if p_post_id is null or p_claim_token is null or p_container_id is null then
    raise exception 'post, claim, and container are required' using errcode = '22023';
  end if;

  if p_stage not in ('container_ready', 'publish_requested', 'publish_succeeded') then
    raise exception 'invalid publish stage' using errcode = '22023';
  end if;

  if p_stage = 'publish_succeeded' and p_media_id is null then
    raise exception 'media id is required after publish succeeds' using errcode = '22023';
  end if;

  update public.social_posts as social_post
  set
    publish_stage = p_stage,
    publish_attempts = social_post.publish_attempts || jsonb_build_array(
      jsonb_strip_nulls(
        jsonb_build_object(
          'at', now(),
          'attempt', social_post.attempt_count,
          'stage', p_stage,
          'claim_token', p_claim_token,
          'container_id', p_container_id,
          'media_id', p_media_id
        )
      )
    ),
    updated_by = 'system:publisher'
  where social_post.id = p_post_id
    and social_post.status = 'publishing'
    and social_post.claim_token = p_claim_token
    and social_post.claim_expires_at > now()
    and (
      (p_stage = 'container_ready' and social_post.publish_stage = 'claimed')
      or (p_stage = 'publish_requested' and social_post.publish_stage = 'container_ready')
      or (p_stage = 'publish_succeeded' and social_post.publish_stage = 'publish_requested')
    )
  returning social_post.id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

revoke all on function public.record_social_publish_stage(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_social_publish_stage(uuid, uuid, text, text, text) to service_role;
