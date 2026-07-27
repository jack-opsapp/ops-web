begin;

-- Canonical, non-identifying lifecycle evidence for the external lead feed and
-- analytics API. Every fact is written by a trigger or fixed RPC in the same
-- transaction as the business mutation. No company is enabled by this
-- migration and no data is exposed publicly.

do $prerequisites$
begin
  if to_regclass('public.opportunities') is null
    or to_regclass('public.opportunity_correspondence_events') is null
    or to_regclass('public.opportunity_dispositions') is null
    or to_regclass('private.external_intake_submissions') is null
    or to_regprocedure(
      'public.record_opportunity_correspondence_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,text,timestamp with time zone,text,uuid,text,text,text,text[],text[],boolean)'
    ) is null
    or to_regprocedure(
      'public.move_opportunity_stage(uuid,text,uuid)'
    ) is null
    or to_regprocedure(
      'public.execute_opportunity_merge_guarded(uuid,uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.convert_opportunity_to_project(uuid,uuid,numeric,text,uuid,text,text,uuid,text,boolean,text,jsonb,bigint)'
    ) is null
    or not exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgname =
        'external_intake_project_files_on_opportunity_link'
        and not trigger_row.tgisinternal
    )
  then
    raise exception 'external_analytics_lifecycle_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Response-definition evidence ---------------------------------------------

alter table public.opportunity_correspondence_events
  add column if not exists response_definition_version smallint
    not null default 1,
  add column if not exists response_kind text
    not null default 'unknown',
  add column if not exists counts_as_first_response boolean
    not null default false;

alter table public.opportunity_correspondence_events
  drop constraint if exists
    opportunity_correspondence_events_response_definition_check,
  add constraint opportunity_correspondence_events_response_definition_check
    check (response_definition_version = 1),
  drop constraint if exists
    opportunity_correspondence_events_response_kind_check,
  add constraint opportunity_correspondence_events_response_kind_check
    check (
      response_kind in (
        'not_applicable',
        'human',
        'configured_automation',
        'automated_acknowledgement',
        'delivery_receipt',
        'internal_note',
        'unknown'
      )
    ),
  drop constraint if exists
    opportunity_correspondence_events_first_response_check,
  add constraint opportunity_correspondence_events_first_response_check
    check (
      not counts_as_first_response
      or (
        direction = 'outbound'
        and party_role = 'ops'
        and is_meaningful
        and response_kind in ('human', 'configured_automation')
      )
    );

-- Canonical facts and immutable event log ----------------------------------

create table private.external_lead_lifecycle_facts (
  company_id uuid not null,
  opportunity_id uuid not null,
  inquiry_received_at timestamptz not null,
  inquiry_time_quality text not null,
  first_response_at timestamptz,
  first_response_event_id uuid,
  first_response_definition_version smallint,
  first_response_kind text,
  won_at timestamptz,
  lost_at timestamptz,
  disqualified_at timestamptz,
  discarded_at timestamptz,
  archived_at timestamptz,
  converted_at timestamptz,
  deleted_at timestamptz,
  merged_at timestamptz,
  merged_into_opportunity_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_id, opportunity_id),
  constraint external_lead_lifecycle_facts_opportunity_company_fkey
    foreign key (company_id, opportunity_id)
    references public.opportunities (company_id, id)
    on delete restrict,
  constraint external_lead_lifecycle_facts_response_event_fkey
    foreign key (first_response_event_id)
    references public.opportunity_correspondence_events (id)
    on delete restrict,
  constraint external_lead_lifecycle_facts_merge_target_fkey
    foreign key (merged_into_opportunity_id)
    references public.opportunities (id)
    on delete restrict,
  constraint external_lead_lifecycle_facts_inquiry_quality_check
    check (
      inquiry_time_quality in (
        'exact',
        'provider',
        'manual',
        'fallback'
      )
    ),
  constraint external_lead_lifecycle_facts_response_check
    check (
      (
        first_response_at is null
        and first_response_event_id is null
        and first_response_definition_version is null
        and first_response_kind is null
      )
      or (
        first_response_at is not null
        and first_response_event_id is not null
        and first_response_definition_version = 1
        and first_response_kind in ('human', 'configured_automation')
        and first_response_at >= inquiry_received_at
      )
    )
);

create index external_lead_lifecycle_facts_response_event_idx
  on private.external_lead_lifecycle_facts (first_response_event_id)
  where first_response_event_id is not null;

create index external_lead_lifecycle_facts_merge_target_idx
  on private.external_lead_lifecycle_facts (merged_into_opportunity_id)
  where merged_into_opportunity_id is not null;

create index external_lead_lifecycle_facts_company_inquiry_idx
  on private.external_lead_lifecycle_facts (
    company_id,
    inquiry_received_at,
    opportunity_id
  );

create table private.external_lead_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  opportunity_id uuid not null,
  event_kind text not null,
  occurred_at timestamptz not null,
  from_stage text,
  to_stage text,
  response_event_id uuid,
  response_definition_version smallint,
  response_kind text,
  counts_as_first_response boolean not null default false,
  related_opportunity_id uuid,
  project_id uuid,
  source text not null,
  actor_user_id uuid,
  dedupe_key text not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint external_lead_lifecycle_events_company_identity_key
    unique (id, company_id),
  constraint external_lead_lifecycle_events_dedupe_key
    unique (company_id, dedupe_key),
  constraint external_lead_lifecycle_events_opportunity_company_fkey
    foreign key (company_id, opportunity_id)
    references public.opportunities (company_id, id)
    on delete restrict,
  constraint external_lead_lifecycle_events_response_fkey
    foreign key (response_event_id)
    references public.opportunity_correspondence_events (id)
    on delete restrict,
  constraint external_lead_lifecycle_events_related_opportunity_fkey
    foreign key (related_opportunity_id)
    references public.opportunities (id)
    on delete restrict,
  constraint external_lead_lifecycle_events_project_fkey
    foreign key (project_id)
    references public.projects (id)
    on delete restrict,
  constraint external_lead_lifecycle_events_actor_fkey
    foreign key (actor_user_id)
    references public.users (id)
    on delete restrict,
  constraint external_lead_lifecycle_events_kind_check
    check (
      event_kind in (
        'inquiry_received',
        'stage_changed',
        'won',
        'lost',
        'disqualified',
        'discarded',
        'archived',
        'unarchived',
        'deleted',
        'merged',
        'converted',
        'response_recorded'
      )
    ),
  constraint external_lead_lifecycle_events_response_check
    check (
      (
        event_kind <> 'response_recorded'
        and response_event_id is null
        and response_definition_version is null
        and response_kind is null
        and not counts_as_first_response
      )
      or (
        event_kind = 'response_recorded'
        and response_event_id is not null
        and response_definition_version = 1
        and response_kind in ('human', 'configured_automation')
        and counts_as_first_response
      )
    ),
  constraint external_lead_lifecycle_events_source_check
    check (
      char_length(btrim(source)) between 1 and 120
      and source !~ '[[:cntrl:]]'
    ),
  constraint external_lead_lifecycle_events_dedupe_check
    check (
      char_length(btrim(dedupe_key)) between 1 and 240
      and dedupe_key !~ '[[:cntrl:]]'
    ),
  constraint external_lead_lifecycle_events_metadata_check
    check (
      jsonb_typeof(safe_metadata) = 'object'
      and octet_length(safe_metadata::text) <= 16384
    )
);

create index external_lead_lifecycle_events_company_time_idx
  on private.external_lead_lifecycle_events (
    company_id,
    occurred_at,
    opportunity_id
  );

create index external_lead_lifecycle_events_opportunity_time_idx
  on private.external_lead_lifecycle_events (
    opportunity_id,
    occurred_at,
    id
  );

create index external_lead_lifecycle_events_response_idx
  on private.external_lead_lifecycle_events (response_event_id)
  where response_event_id is not null;

create index external_lead_lifecycle_events_related_opportunity_idx
  on private.external_lead_lifecycle_events (related_opportunity_id)
  where related_opportunity_id is not null;

create index external_lead_lifecycle_events_project_idx
  on private.external_lead_lifecycle_events (project_id)
  where project_id is not null;

create index external_lead_lifecycle_events_actor_idx
  on private.external_lead_lifecycle_events (actor_user_id)
  where actor_user_id is not null;

create or replace function private.reject_external_lead_lifecycle_event_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
begin
  raise exception 'external_lead_lifecycle_events_append_only'
    using errcode = '42501';
end;
$function$;

create trigger external_lead_lifecycle_events_append_only
before update or delete on private.external_lead_lifecycle_events
for each row
execute function private.reject_external_lead_lifecycle_event_mutation();

create or replace function private.external_lead_lifecycle_quality_rank(
  p_quality text
) returns smallint
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case p_quality
    when 'exact' then 4
    when 'provider' then 3
    when 'manual' then 2
    when 'fallback' then 1
    else 0
  end::smallint;
$function$;

create or replace function private.ensure_external_lead_lifecycle_facts(
  p_company_id uuid,
  p_opportunity_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_created_at timestamptz;
begin
  select opportunity.created_at
  into v_created_at
  from public.opportunities opportunity
  where opportunity.company_id = p_company_id
    and opportunity.id = p_opportunity_id;

  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  insert into private.external_lead_lifecycle_facts (
    company_id,
    opportunity_id,
    inquiry_received_at,
    inquiry_time_quality
  ) values (
    p_company_id,
    p_opportunity_id,
    coalesce(v_created_at, clock_timestamp()),
    'fallback'
  )
  on conflict (company_id, opportunity_id) do nothing;
end;
$function$;

create or replace function private.append_external_lead_lifecycle_event(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_event_kind text,
  p_occurred_at timestamptz,
  p_source text,
  p_dedupe_key text,
  p_from_stage text default null,
  p_to_stage text default null,
  p_response_event_id uuid default null,
  p_response_definition_version smallint default null,
  p_response_kind text default null,
  p_counts_as_first_response boolean default false,
  p_related_opportunity_id uuid default null,
  p_project_id uuid default null,
  p_actor_user_id uuid default null,
  p_safe_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event_id uuid;
begin
  insert into private.external_lead_lifecycle_events (
    company_id,
    opportunity_id,
    event_kind,
    occurred_at,
    from_stage,
    to_stage,
    response_event_id,
    response_definition_version,
    response_kind,
    counts_as_first_response,
    related_opportunity_id,
    project_id,
    source,
    actor_user_id,
    dedupe_key,
    safe_metadata
  ) values (
    p_company_id,
    p_opportunity_id,
    p_event_kind,
    p_occurred_at,
    p_from_stage,
    p_to_stage,
    p_response_event_id,
    p_response_definition_version,
    p_response_kind,
    p_counts_as_first_response,
    p_related_opportunity_id,
    p_project_id,
    p_source,
    p_actor_user_id,
    p_dedupe_key,
    coalesce(p_safe_metadata, '{}'::jsonb)
  )
  on conflict (company_id, dedupe_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select event.id
    into v_event_id
    from private.external_lead_lifecycle_events event
    where event.company_id = p_company_id
      and event.dedupe_key = p_dedupe_key;
  end if;

  return v_event_id;
end;
$function$;

create or replace function private.record_external_lead_inquiry(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_received_at timestamptz,
  p_quality text,
  p_source text,
  p_dedupe_key text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_facts private.external_lead_lifecycle_facts%rowtype;
begin
  if p_received_at is null
    or p_quality not in ('exact', 'provider', 'manual', 'fallback')
  then
    raise exception 'invalid_external_lead_inquiry_evidence'
      using errcode = '22023';
  end if;

  perform private.ensure_external_lead_lifecycle_facts(
    p_company_id,
    p_opportunity_id
  );

  select facts.*
  into v_facts
  from private.external_lead_lifecycle_facts facts
  where facts.company_id = p_company_id
    and facts.opportunity_id = p_opportunity_id
  for update;

  if private.external_lead_lifecycle_quality_rank(p_quality)
      > private.external_lead_lifecycle_quality_rank(
        v_facts.inquiry_time_quality
      )
    or (
      p_quality = v_facts.inquiry_time_quality
      and p_received_at < v_facts.inquiry_received_at
    )
  then
    update private.external_lead_lifecycle_facts facts
    set inquiry_received_at = p_received_at,
        inquiry_time_quality = p_quality,
        first_response_at = case
          when facts.first_response_at is not null
            and facts.first_response_at < p_received_at
          then null
          else facts.first_response_at
        end,
        first_response_event_id = case
          when facts.first_response_at is not null
            and facts.first_response_at < p_received_at
          then null
          else facts.first_response_event_id
        end,
        first_response_definition_version = case
          when facts.first_response_at is not null
            and facts.first_response_at < p_received_at
          then null
          else facts.first_response_definition_version
        end,
        first_response_kind = case
          when facts.first_response_at is not null
            and facts.first_response_at < p_received_at
          then null
          else facts.first_response_kind
        end,
        updated_at = clock_timestamp()
    where facts.company_id = p_company_id
      and facts.opportunity_id = p_opportunity_id;
  end if;

  perform private.append_external_lead_lifecycle_event(
    p_company_id,
    p_opportunity_id,
    'inquiry_received',
    p_received_at,
    p_source,
    p_dedupe_key,
    p_safe_metadata => jsonb_build_object('quality', p_quality)
  );
end;
$function$;

create or replace function private.record_external_lead_first_response(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_response_event_id uuid,
  p_responded_at timestamptz,
  p_response_definition_version smallint,
  p_response_kind text,
  p_source text
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_facts private.external_lead_lifecycle_facts%rowtype;
begin
  if p_response_event_id is null
    or p_responded_at is null
    or p_response_definition_version <> 1
    or p_response_kind not in ('human', 'configured_automation')
  then
    raise exception 'invalid_external_lead_response_evidence'
      using errcode = '22023';
  end if;

  perform private.ensure_external_lead_lifecycle_facts(
    p_company_id,
    p_opportunity_id
  );

  select facts.*
  into v_facts
  from private.external_lead_lifecycle_facts facts
  where facts.company_id = p_company_id
    and facts.opportunity_id = p_opportunity_id
  for update;

  -- A response that predates the best-known inquiry is contradictory evidence,
  -- not a duration. Preserve it on the correspondence row but leave coverage
  -- unknown for analytics.
  if p_responded_at < v_facts.inquiry_received_at then
    return;
  end if;

  if v_facts.first_response_at is null
    or p_responded_at < v_facts.first_response_at
  then
    update private.external_lead_lifecycle_facts facts
    set first_response_at = p_responded_at,
        first_response_event_id = p_response_event_id,
        first_response_definition_version = p_response_definition_version,
        first_response_kind = p_response_kind,
        updated_at = clock_timestamp()
    where facts.company_id = p_company_id
      and facts.opportunity_id = p_opportunity_id;
  end if;

  perform private.append_external_lead_lifecycle_event(
    p_company_id,
    p_opportunity_id,
    'response_recorded',
    p_responded_at,
    p_source,
    format(
      'correspondence:%s:response:v%s',
      p_response_event_id,
      p_response_definition_version
    ),
    p_response_event_id => p_response_event_id,
    p_response_definition_version => p_response_definition_version,
    p_response_kind => p_response_kind,
    p_counts_as_first_response => true
  );
end;
$function$;

-- Business-row triggers ----------------------------------------------------

create or replace function private.external_lead_lifecycle_on_opportunity_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := coalesce(
    nullif(
      current_setting('ops.lifecycle_actor_user_id', true),
      ''
    )::uuid,
    private.get_current_user_id()
  );
  v_source text := coalesce(
    nullif(current_setting('ops.lifecycle_source', true), ''),
    'database_trigger'
  );
  v_effective_project_id uuid;
  v_old_effective_project_id uuid;
  v_occurred_at timestamptz;
begin
  if tg_op = 'INSERT' then
    perform private.record_external_lead_inquiry(
      new.company_id,
      new.id,
      coalesce(new.created_at, clock_timestamp()),
      case when v_actor_user_id is null then 'fallback' else 'manual' end,
      case
        when v_actor_user_id is null then 'system_opportunity_insert'
        else 'manual_opportunity_insert'
      end,
      format('opportunity:%s:inquiry:insert', new.id)
    );
    return new;
  end if;

  perform private.ensure_external_lead_lifecycle_facts(
    new.company_id,
    new.id
  );

  if new.stage is distinct from old.stage then
    v_occurred_at := coalesce(new.stage_entered_at, new.updated_at, clock_timestamp());
    perform private.append_external_lead_lifecycle_event(
      new.company_id,
      new.id,
      'stage_changed',
      v_occurred_at,
      v_source,
      format(
        'opportunity:%s:stage:%s:%s',
        new.id,
        new.stage,
        extract(epoch from v_occurred_at)::numeric
      ),
      p_from_stage => old.stage,
      p_to_stage => new.stage,
      p_actor_user_id => v_actor_user_id
    );

    if new.stage in ('won', 'lost', 'discarded') then
      perform private.append_external_lead_lifecycle_event(
        new.company_id,
        new.id,
        new.stage,
        v_occurred_at,
        v_source,
        format(
          'opportunity:%s:terminal:%s:%s',
          new.id,
          new.stage,
          extract(epoch from v_occurred_at)::numeric
        ),
        p_from_stage => old.stage,
        p_to_stage => new.stage,
        p_actor_user_id => v_actor_user_id
      );

      update private.external_lead_lifecycle_facts facts
      set won_at = case
            when new.stage = 'won' then
              coalesce(facts.won_at, v_occurred_at)
            else facts.won_at
          end,
          lost_at = case
            when new.stage = 'lost' then
              coalesce(facts.lost_at, v_occurred_at)
            else facts.lost_at
          end,
          discarded_at = case
            when new.stage = 'discarded' then
              coalesce(facts.discarded_at, v_occurred_at)
            else facts.discarded_at
          end,
          updated_at = clock_timestamp()
      where facts.company_id = new.company_id
        and facts.opportunity_id = new.id;
    end if;
  end if;

  if new.archived_at is distinct from old.archived_at then
    v_occurred_at := case
      when new.archived_at is null then clock_timestamp()
      else new.archived_at
    end;
    perform private.append_external_lead_lifecycle_event(
      new.company_id,
      new.id,
      case when new.archived_at is null then 'unarchived' else 'archived' end,
      v_occurred_at,
      v_source,
      format(
        'opportunity:%s:archive:%s:%s',
        new.id,
        case when new.archived_at is null then 'off' else 'on' end,
        extract(epoch from v_occurred_at)::numeric
      ),
      p_actor_user_id => v_actor_user_id
    );

    update private.external_lead_lifecycle_facts facts
    set archived_at = new.archived_at,
        updated_at = clock_timestamp()
    where facts.company_id = new.company_id
      and facts.opportunity_id = new.id;
  end if;

  if new.deleted_at is distinct from old.deleted_at
    and new.deleted_at is not null
  then
    perform private.append_external_lead_lifecycle_event(
      new.company_id,
      new.id,
      'deleted',
      new.deleted_at,
      v_source,
      format(
        'opportunity:%s:deleted:%s',
        new.id,
        extract(epoch from new.deleted_at)::numeric
      ),
      p_actor_user_id => v_actor_user_id
    );

    update private.external_lead_lifecycle_facts facts
    set deleted_at = new.deleted_at,
        updated_at = clock_timestamp()
    where facts.company_id = new.company_id
      and facts.opportunity_id = new.id;
  end if;

  if new.merged_into_opportunity_id is distinct from
      old.merged_into_opportunity_id
    and new.merged_into_opportunity_id is not null
  then
    v_occurred_at := clock_timestamp();
    perform private.append_external_lead_lifecycle_event(
      new.company_id,
      new.id,
      'merged',
      v_occurred_at,
      v_source,
      format(
        'opportunity:%s:merged:%s',
        new.id,
        new.merged_into_opportunity_id
      ),
      p_related_opportunity_id => new.merged_into_opportunity_id,
      p_actor_user_id => v_actor_user_id
    );

    update private.external_lead_lifecycle_facts facts
    set merged_at = coalesce(facts.merged_at, v_occurred_at),
        merged_into_opportunity_id = new.merged_into_opportunity_id,
        updated_at = clock_timestamp()
    where facts.company_id = new.company_id
      and facts.opportunity_id = new.id;
  end if;

  v_effective_project_id := coalesce(new.project_ref, new.project_id);
  v_old_effective_project_id := coalesce(old.project_ref, old.project_id);
  if v_effective_project_id is distinct from v_old_effective_project_id
    and v_effective_project_id is not null
  then
    v_occurred_at := clock_timestamp();
    perform private.append_external_lead_lifecycle_event(
      new.company_id,
      new.id,
      'converted',
      v_occurred_at,
      v_source,
      format(
        'opportunity:%s:converted:%s',
        new.id,
        v_effective_project_id
      ),
      p_project_id => v_effective_project_id,
      p_actor_user_id => v_actor_user_id
    );

    update private.external_lead_lifecycle_facts facts
    set converted_at = coalesce(facts.converted_at, v_occurred_at),
        updated_at = clock_timestamp()
    where facts.company_id = new.company_id
      and facts.opportunity_id = new.id;
  end if;

  -- handled_at is intentionally absent: manual handling is not evidence that a
  -- customer received a substantive first response.
  return new;
end;
$function$;

create trigger external_lead_lifecycle_on_opportunity_change
after insert or update of
  stage,
  stage_entered_at,
  archived_at,
  deleted_at,
  merged_into_opportunity_id,
  project_id,
  project_ref
on public.opportunities
for each row
execute function private.external_lead_lifecycle_on_opportunity_change();

create or replace function private.external_lead_lifecycle_on_intake_submission()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.record_external_lead_inquiry(
    new.company_id,
    new.opportunity_id,
    new.created_at,
    'exact',
    'external_intake_submission',
    format('intake_submission:%s:inquiry', new.id)
  );
  return new;
end;
$function$;

create trigger external_lead_lifecycle_on_intake_submission
after insert on private.external_intake_submissions
for each row
execute function private.external_lead_lifecycle_on_intake_submission();

create or replace function private.external_lead_lifecycle_on_disposition()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event_kind text := case
    when new.disposition = 'converted_to_project' then 'converted'
    else new.disposition
  end;
begin
  perform private.ensure_external_lead_lifecycle_facts(
    new.company_id,
    new.opportunity_id
  );

  perform private.append_external_lead_lifecycle_event(
    new.company_id,
    new.opportunity_id,
    v_event_kind,
    new.created_at,
    new.decided_via,
    format('disposition:%s', new.id),
    p_related_opportunity_id => new.merged_into_opportunity_id,
    p_project_id => new.converted_project_ref,
    p_actor_user_id => new.decided_by
  );

  update private.external_lead_lifecycle_facts facts
  set won_at = case
        when new.disposition = 'won' then
          coalesce(facts.won_at, new.created_at)
        else facts.won_at
      end,
      lost_at = case
        when new.disposition = 'lost' then
          coalesce(facts.lost_at, new.created_at)
        else facts.lost_at
      end,
      disqualified_at = case
        when new.disposition = 'disqualified' then
          coalesce(facts.disqualified_at, new.created_at)
        else facts.disqualified_at
      end,
      discarded_at = case
        when new.disposition = 'discarded' then
          coalesce(facts.discarded_at, new.created_at)
        else facts.discarded_at
      end,
      converted_at = case
        when new.disposition = 'converted_to_project' then
          coalesce(facts.converted_at, new.created_at)
        else facts.converted_at
      end,
      merged_at = case
        when new.disposition = 'merged' then
          coalesce(facts.merged_at, new.created_at)
        else facts.merged_at
      end,
      merged_into_opportunity_id = case
        when new.disposition = 'merged' then new.merged_into_opportunity_id
        else facts.merged_into_opportunity_id
      end,
      updated_at = clock_timestamp()
  where facts.company_id = new.company_id
    and facts.opportunity_id = new.opportunity_id;

  return new;
end;
$function$;

create trigger external_lead_lifecycle_on_disposition
after insert on public.opportunity_dispositions
for each row
execute function private.external_lead_lifecycle_on_disposition();

create or replace function private.external_lead_lifecycle_on_correspondence()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_should_record_response boolean := false;
begin
  if tg_op = 'INSERT'
    and new.direction = 'inbound'
    and new.party_role = 'customer'
    and new.is_meaningful
  then
    perform private.record_external_lead_inquiry(
      new.company_id,
      new.opportunity_id,
      new.occurred_at,
      'provider',
      new.source,
      format('correspondence:%s:inquiry', new.id)
    );
  end if;

  if tg_op = 'INSERT' then
    v_should_record_response := new.counts_as_first_response;
  elsif tg_op = 'UPDATE' then
    v_should_record_response :=
      new.counts_as_first_response
      and (
        old.counts_as_first_response is distinct from
          new.counts_as_first_response
        or old.response_definition_version is distinct from
          new.response_definition_version
        or old.response_kind is distinct from new.response_kind
      );
  end if;

  if v_should_record_response then
    perform private.record_external_lead_first_response(
      new.company_id,
      new.opportunity_id,
      new.id,
      new.occurred_at,
      new.response_definition_version,
      new.response_kind,
      new.source
    );
  end if;

  return new;
end;
$function$;

create trigger external_lead_lifecycle_on_correspondence
after insert or update of
  response_definition_version,
  response_kind,
  counts_as_first_response
on public.opportunity_correspondence_events
for each row
execute function private.external_lead_lifecycle_on_correspondence();

-- Extended correspondence command. The exact-message recovery wrappers
-- `guarded_orphan_email_activity_adoption` and
-- `guarded_orphan_outbound_email_activity_adoption` retain the original
-- nineteen-argument signature. Their historical rows therefore remain
-- response_kind = 'unknown' and counts_as_first_response = false, reducing
-- response coverage instead of inventing certainty.

create or replace function public.record_opportunity_correspondence_event(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_activity_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_direction text,
  p_party_role text,
  p_is_meaningful boolean,
  p_noise_reason text,
  p_occurred_at timestamptz,
  p_linked_contact_kind text,
  p_linked_contact_id uuid,
  p_source text,
  p_subject text,
  p_from_email text,
  p_to_emails text[],
  p_cc_emails text[],
  p_apply_opportunity_projection boolean,
  p_response_definition_version smallint,
  p_response_kind text,
  p_counts_as_first_response boolean
) returns table (
  created boolean,
  event_id uuid,
  correspondence_count integer,
  inbound_count integer,
  outbound_count integer,
  stage text,
  stage_manually_set boolean,
  assignment_version bigint,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_message_direction text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_result record;
  v_existing record;
begin
  if p_response_definition_version <> 1
    or p_response_kind not in (
      'not_applicable',
      'human',
      'configured_automation',
      'automated_acknowledgement',
      'delivery_receipt',
      'internal_note',
      'unknown'
    )
    or (
      p_counts_as_first_response
      and (
        p_direction <> 'outbound'
        or p_party_role <> 'ops'
        or not p_is_meaningful
        or p_response_kind not in ('human', 'configured_automation')
      )
    )
  then
    raise exception 'invalid_correspondence_response_classification'
      using errcode = '22023';
  end if;

  select *
  into v_result
  from public.record_opportunity_correspondence_event(
    p_company_id,
    p_opportunity_id,
    p_activity_id,
    p_connection_id,
    p_provider_thread_id,
    p_provider_message_id,
    p_direction,
    p_party_role,
    p_is_meaningful,
    p_noise_reason,
    p_occurred_at,
    p_linked_contact_kind,
    p_linked_contact_id,
    p_source,
    p_subject,
    p_from_email,
    p_to_emails,
    p_cc_emails,
    p_apply_opportunity_projection
  );

  select
    event.response_definition_version,
    event.response_kind,
    event.counts_as_first_response
  into v_existing
  from public.opportunity_correspondence_events event
  where event.id = v_result.event_id
    and event.company_id = p_company_id
    and event.opportunity_id = p_opportunity_id
  for update;

  if not found then
    raise exception 'correspondence_event_not_found'
      using errcode = 'P0002';
  end if;

  if v_existing.response_kind <> 'unknown'
    and (
      v_existing.response_definition_version is distinct from
        p_response_definition_version
      or v_existing.response_kind is distinct from p_response_kind
      or v_existing.counts_as_first_response is distinct from
        p_counts_as_first_response
    )
  then
    raise exception 'correspondence_response_classification_conflict'
      using errcode = '23505';
  end if;

  if v_existing.response_kind = 'unknown'
    and (
      v_existing.response_definition_version is distinct from
        p_response_definition_version
      or v_existing.response_kind is distinct from p_response_kind
      or v_existing.counts_as_first_response is distinct from
        p_counts_as_first_response
    )
  then
    update public.opportunity_correspondence_events event
    set response_definition_version = p_response_definition_version,
        response_kind = p_response_kind,
        counts_as_first_response = p_counts_as_first_response
    where event.id = v_result.event_id
      and event.company_id = p_company_id
      and event.opportunity_id = p_opportunity_id;
  end if;

  return query select
    v_result.created,
    v_result.event_id,
    v_result.correspondence_count,
    v_result.inbound_count,
    v_result.outbound_count,
    v_result.stage,
    v_result.stage_manually_set,
    v_result.assignment_version,
    v_result.last_inbound_at,
    v_result.last_outbound_at,
    v_result.last_message_direction;
end;
$function$;

revoke all on function public.record_opportunity_correspondence_event(
  uuid, uuid, uuid, uuid, text, text, text, text, boolean, text, timestamptz,
  text, uuid, text, text, text, text[], text[], boolean, smallint, text, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.record_opportunity_correspondence_event(
  uuid, uuid, uuid, uuid, text, text, text, text, boolean, text, timestamptz,
  text, uuid, text, text, text, text[], text[], boolean, smallint, text, boolean
) to service_role;

-- Fixed operator/system lifecycle commands --------------------------------

create or replace function public.move_opportunity_stage(
  p_opportunity_id uuid,
  p_to_stage text,
  p_user_id uuid
) returns public.opportunities
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_from_stage text;
  v_prior_entered_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_probability integer;
  v_actor_user_id uuid;
  v_updated public.opportunities;
begin
  if p_opportunity_id is null or nullif(btrim(p_to_stage), '') is null then
    raise exception 'opportunity and target stage are required'
      using errcode = '22023';
  end if;

  select opportunity.company_id
  into v_company_id
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.deleted_at is null;

  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and p_user_id is not null
    and p_user_id is distinct from private.get_current_user_id()
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  v_actor_user_id := case
    when coalesce(auth.role(), '') = 'service_role' then p_user_id
    else coalesce(p_user_id, private.get_current_user_id())
  end;

  perform private.lock_lead_assignment_company(v_company_id);

  select opportunity.stage, opportunity.stage_entered_at
  into v_from_stage, v_prior_entered_at
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = v_company_id
    and opportunity.deleted_at is null
  for update;

  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if v_from_stage = p_to_stage then
    select opportunity.*
    into v_updated
    from public.opportunities opportunity
    where opportunity.id = p_opportunity_id;
    return v_updated;
  end if;

  select config.default_win_probability
  into v_probability
  from public.pipeline_stage_configs config
  where config.company_id = v_company_id
    and config.slug = p_to_stage
  limit 1;

  perform set_config('ops.lifecycle_source', 'manual_stage_change', true);
  perform set_config(
    'ops.lifecycle_actor_user_id',
    coalesce(v_actor_user_id::text, ''),
    true
  );

  update public.opportunities opportunity
  set stage = p_to_stage,
      stage_entered_at = v_now,
      win_probability = coalesce(v_probability, opportunity.win_probability),
      stage_manually_set = true,
      updated_at = v_now
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = v_company_id
    and opportunity.deleted_at is null
  returning opportunity.* into v_updated;

  insert into public.stage_transitions (
    company_id,
    opportunity_id,
    from_stage,
    to_stage,
    transitioned_at,
    transitioned_by,
    duration_in_stage
  ) values (
    v_company_id,
    p_opportunity_id,
    v_from_stage,
    p_to_stage,
    v_now,
    v_actor_user_id,
    case
      when v_prior_entered_at is null then null
      else v_now - v_prior_entered_at
    end
  );

  return v_updated;
end;
$function$;

create or replace function public.mutate_opportunity_lifecycle(
  p_opportunity_id uuid,
  p_action text,
  p_actor_user_id uuid default null,
  p_company_id uuid default null
) returns public.opportunities
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_company_id uuid;
  v_current public.opportunities;
  v_now timestamptz := clock_timestamp();
  v_actor_user_id uuid;
begin
  if p_opportunity_id is null
    or p_action is null
    or p_action not in ('archive', 'unarchive', 'delete')
  then
    raise exception 'invalid_opportunity_lifecycle_mutation'
      using errcode = '22023';
  end if;

  select opportunity.company_id
  into v_company_id
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id;

  if not found or (
    p_company_id is not null
    and p_company_id is distinct from v_company_id
  ) then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if not v_is_service
    and p_actor_user_id is not null
    and p_actor_user_id is distinct from private.get_current_user_id()
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  v_actor_user_id := case
    when v_is_service then p_actor_user_id
    else coalesce(p_actor_user_id, private.get_current_user_id())
  end;
  if not v_is_service and v_actor_user_id is null then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  select opportunity.*
  into v_current
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = v_company_id
  for update;

  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if (
    not v_is_service
    or v_actor_user_id is not null
  ) and not private.user_can_edit_opportunity(
    v_actor_user_id,
    p_opportunity_id
  ) then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_action in ('archive', 'unarchive')
    and v_current.deleted_at is not null
  then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  perform set_config(
    'ops.lifecycle_source',
    case
      when v_actor_user_id is null then 'system_' || p_action
      else 'operator_' || p_action
    end,
    true
  );
  perform set_config(
    'ops.lifecycle_actor_user_id',
    coalesce(v_actor_user_id::text, ''),
    true
  );

  if p_action = 'archive' and v_current.archived_at is null then
    update public.opportunities opportunity
    set archived_at = v_now,
        updated_at = v_now
    where opportunity.id = p_opportunity_id
    returning opportunity.* into v_current;
  elsif p_action = 'unarchive' and v_current.archived_at is not null then
    update public.opportunities opportunity
    set archived_at = null,
        updated_at = v_now
    where opportunity.id = p_opportunity_id
    returning opportunity.* into v_current;
  elsif p_action = 'delete' and v_current.deleted_at is null then
    update public.opportunities opportunity
    set deleted_at = v_now,
        updated_at = v_now
    where opportunity.id = p_opportunity_id
    returning opportunity.* into v_current;
  end if;

  return v_current;
end;
$function$;

revoke all on function public.mutate_opportunity_lifecycle(
  uuid, text, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.mutate_opportunity_lifecycle(
  uuid, text, uuid, uuid
) to anon, authenticated, service_role;

-- Keep private evidence private even from service-role PostgREST. Fixed
-- SECURITY DEFINER functions are the only write boundary.
alter table private.external_lead_lifecycle_facts enable row level security;
alter table private.external_lead_lifecycle_events enable row level security;

revoke all on table private.external_lead_lifecycle_facts
  from public, anon, authenticated, service_role;
revoke all on table private.external_lead_lifecycle_events
  from public, anon, authenticated, service_role;

revoke all on function
  private.reject_external_lead_lifecycle_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function
  private.external_lead_lifecycle_quality_rank(text)
  from public, anon, authenticated, service_role;
revoke all on function
  private.ensure_external_lead_lifecycle_facts(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  private.append_external_lead_lifecycle_event(
    uuid, uuid, text, timestamptz, text, text, text, text, uuid, smallint,
    text, boolean, uuid, uuid, uuid, jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function
  private.record_external_lead_inquiry(
    uuid, uuid, timestamptz, text, text, text
  ) from public, anon, authenticated, service_role;
revoke all on function
  private.record_external_lead_first_response(
    uuid, uuid, uuid, timestamptz, smallint, text, text
  ) from public, anon, authenticated, service_role;
revoke all on function
  private.external_lead_lifecycle_on_opportunity_change()
  from public, anon, authenticated, service_role;
revoke all on function
  private.external_lead_lifecycle_on_intake_submission()
  from public, anon, authenticated, service_role;
revoke all on function
  private.external_lead_lifecycle_on_disposition()
  from public, anon, authenticated, service_role;
revoke all on function
  private.external_lead_lifecycle_on_correspondence()
  from public, anon, authenticated, service_role;

comment on table private.external_lead_lifecycle_facts is
  'Canonical non-identifying inquiry, response, terminal, archive, merge, '
  'deletion, and conversion facts for external lead analytics.';

comment on table private.external_lead_lifecycle_events is
  'Append-only non-identifying lifecycle evidence written in the same '
  'transaction as the source business mutation.';

comment on function public.mutate_opportunity_lifecycle(
  uuid, text, uuid, uuid
) is
  'Atomically archive, unarchive, or soft-delete an opportunity. The '
  'opportunity trigger appends external lifecycle evidence in the same '
  'transaction.';

commit;
