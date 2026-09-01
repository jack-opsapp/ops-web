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
  max_attempts integer not null default 3
    check (max_attempts between 1 and 10),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,

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
        and instagram_permalink is not null
        and published_at is not null
      )
    ),
  constraint social_posts_cancelled_timestamp_required
    check (status <> 'cancelled' or cancelled_at is not null)
);

comment on table public.social_posts is
  'Service-role-only queue and audit record for scheduled-agent Instagram publishing.';
comment on column public.social_posts.content is
  'Validated, versioned scheduled-agent payload after authoritative source enrichment.';
comment on column public.social_posts.rendered_assets is
  'Ordered public JPEG metadata consumed by Instagram and the admin artifact preview.';

create index social_posts_due_idx
  on public.social_posts (publish_after, next_attempt_at, claim_expires_at)
  where status in ('review', 'failed');

create index social_posts_history_idx
  on public.social_posts (created_at desc, visual_treatment, post_format)
  where status in ('review', 'publishing', 'published');

create index social_posts_source_idx
  on public.social_posts (source_type, source_id, created_at desc);

alter table public.social_posts enable row level security;

revoke all on table public.social_posts from public, anon, authenticated;
grant select, insert, update, delete on table public.social_posts to service_role;

drop trigger if exists social_posts_set_updated_at on public.social_posts;
create trigger social_posts_set_updated_at
  before update on public.social_posts
  for each row execute function public.fn_set_updated_at();

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
