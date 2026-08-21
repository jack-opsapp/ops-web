-- Repair the lead conversion/disposition contract in one guarded release:
--   * nullable ranking hints can never invalidate the project candidate list;
--   * conversion photo choices are explicit, validated, and transaction-bound;
--   * every discard reason actually discards, including created-by-error;
--   * budget-timing deferrals archive as not_now instead of becoming losses.

begin;

create or replace function public.get_manual_project_link_candidates(
  p_opportunity_id uuid
)
returns table (
  project_id uuid,
  title text,
  address text,
  status text,
  same_address boolean,
  same_client boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_opportunity public.opportunities%rowtype;
  v_client_id uuid;
  v_normalized_address text;
begin
  if v_actor_user_id is null or v_company_id is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select opportunity.*
    into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = v_company_id
     and opportunity.deleted_at is null;

  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;
  if not private.user_can_convert_opportunity(
    v_actor_user_id,
    p_opportunity_id
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_client_id := private.resolve_opportunity_client_id(
    v_opportunity.client_ref,
    v_opportunity.client_id
  );
  v_normalized_address := private.normalize_address(v_opportunity.address);

  return query
  select
    project.id,
    project.title,
    project.address,
    project.status,
    coalesce(
      nullif(v_normalized_address, '') is not null
        and private.normalize_address(project.address) = v_normalized_address,
      false
    ),
    coalesce(
      v_client_id is not null and project.client_id = v_client_id,
      false
    )
  from public.projects project
  where project.company_id = v_company_id
    and project.deleted_at is null
    and private.user_can_view_project(v_actor_user_id, project.id)
    and private.user_can_link_opportunity_to_project(
      v_actor_user_id,
      project.id
    )
    and (
      project.opportunity_ref is null
      or project.opportunity_ref = p_opportunity_id
    )
    and (
      nullif(btrim(project.opportunity_id::text), '') is null
      or private.try_parse_uuid(project.opportunity_id::text) = p_opportunity_id
    )
  order by
    coalesce(
      nullif(v_normalized_address, '') is not null
        and private.normalize_address(project.address) = v_normalized_address
        and v_client_id is not null
        and project.client_id = v_client_id,
      false
    ) desc,
    coalesce(
      nullif(v_normalized_address, '') is not null
        and private.normalize_address(project.address) = v_normalized_address,
      false
    ) desc,
    coalesce(
      v_client_id is not null and project.client_id = v_client_id,
      false
    ) desc,
    project.updated_at desc nulls last,
    project.title,
    project.id;
end;
$function$;

revoke all on function public.get_manual_project_link_candidates(uuid)
  from public;
grant execute on function public.get_manual_project_link_candidates(uuid)
  to authenticated;

comment on function public.get_manual_project_link_candidates(uuid) is
  'All projects the current operator may explicitly link to a lead. Ranking flags are total booleans and can never invalidate the result set.';

create or replace function public.get_opportunity_conversion_photo_candidates(
  p_opportunity_id uuid
)
returns table (
  source_kind text,
  selection_key text,
  filename text,
  mime_type text,
  source_url text,
  ingest_status text,
  occurred_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_opportunity public.opportunities%rowtype;
begin
  if v_actor_user_id is null or v_company_id is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select opportunity.*
    into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = v_company_id
     and opportunity.deleted_at is null;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;
  if not private.user_can_convert_opportunity(
    v_actor_user_id,
    p_opportunity_id
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  with lead_candidates as (
    select
      image.photo_url,
      min(image.ordinality) as photo_order
    from unnest(coalesce(v_opportunity.images, '{}'::text[]))
      with ordinality as image(photo_url, ordinality)
    where nullif(btrim(image.photo_url), '') is not null
    group by image.photo_url
  ), candidates as (
    select
      'lead'::text as source_kind,
      lead.photo_url as selection_key,
      null::text as filename,
      null::text as mime_type,
      lead.photo_url as source_url,
      'stored'::text as ingest_status,
      null::timestamptz as occurred_at,
      v_opportunity.updated_at as created_at,
      0 as source_order,
      lead.photo_order as item_order,
      lead.photo_url as stable_key
    from lead_candidates lead

    union all

    select
      'email'::text,
      attachment.id::text,
      attachment.filename,
      attachment.detected_mime_type,
      attachment.source_url,
      attachment.ingest_status,
      attachment.occurred_at,
      attachment.created_at,
      1,
      row_number() over (
        order by attachment.occurred_at nulls last,
                 attachment.created_at,
                 attachment.id
      ),
      attachment.id::text
    from public.email_attachments attachment
    where attachment.company_id = v_company_id
      and attachment.opportunity_id = p_opportunity_id
      and private.email_conversion_photo_source_is_eligible(attachment.id)
  )
  select
    candidate.source_kind,
    candidate.selection_key,
    candidate.filename,
    candidate.mime_type,
    candidate.source_url,
    candidate.ingest_status,
    candidate.occurred_at,
    candidate.created_at
  from candidates candidate
  order by candidate.source_order,
           candidate.item_order,
           candidate.stable_key;
end;
$function$;

revoke all on function public.get_opportunity_conversion_photo_candidates(uuid)
  from public, anon;
grant execute on function public.get_opportunity_conversion_photo_candidates(uuid)
  to authenticated;

comment on function public.get_opportunity_conversion_photo_candidates(uuid) is
  'The exact settled lead and eligible inbound-email photos an authorized operator may choose during conversion.';

create or replace function private.prepare_conversion_photo_selection_event()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_evidence jsonb;
  v_selection jsonb;
  v_has_duplicates boolean;
begin
  if new.event_type is distinct from 'converted_to_project' then
    return new;
  end if;

  select opportunity.*
    into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = new.opportunity_id
     and opportunity.company_id = new.company_id
   for update;
  if not found then
    raise exception 'conversion_photo_selection_opportunity_not_found'
      using errcode = 'P0002';
  end if;

  select disposition.evidence
    into v_evidence
    from public.opportunity_dispositions disposition
   where disposition.id = private.try_parse_uuid(
           new.payload ->> 'disposition_id'
         )
     and disposition.company_id = new.company_id
     and disposition.opportunity_id = new.opportunity_id
     and disposition.converted_project_ref = new.project_id
     and disposition.disposition = 'converted_to_project';

  -- An omitted key is the legacy select-all contract. New clients send both
  -- arrays, including explicit empty arrays when the operator selects none.
  if v_evidence ? 'selected_lead_photo_urls' then
    v_selection := v_evidence -> 'selected_lead_photo_urls';
    if jsonb_typeof(v_selection) is distinct from 'array'
      or exists (
        select 1
        from jsonb_array_elements(v_selection) element(value)
        where jsonb_typeof(element.value) is distinct from 'string'
      )
    then
      raise exception 'conversion_photo_selection_invalid'
        using errcode = '22023';
    end if;

    select count(*) <> count(distinct item.value)
      into v_has_duplicates
      from jsonb_array_elements_text(v_selection) item(value);
    if v_has_duplicates then
      raise exception 'conversion_photo_selection_invalid'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(v_selection) item(value)
      where not (
        item.value = any(coalesce(v_opportunity.images, '{}'::text[]))
      )
    ) then
      raise exception 'conversion_photo_selection_stale'
        using errcode = '40001';
    end if;

    new.payload := new.payload || jsonb_build_object(
      'selected_lead_photo_urls',
      v_selection
    );
  end if;

  if v_evidence ? 'selected_email_attachment_ids' then
    v_selection := v_evidence -> 'selected_email_attachment_ids';
    if jsonb_typeof(v_selection) is distinct from 'array'
      or exists (
        select 1
        from jsonb_array_elements(v_selection) element(value)
        where jsonb_typeof(element.value) is distinct from 'string'
      )
    then
      raise exception 'conversion_photo_selection_invalid'
        using errcode = '22023';
    end if;

    select count(*) <> count(distinct item.value)
      into v_has_duplicates
      from jsonb_array_elements_text(v_selection) item(value);
    if v_has_duplicates then
      raise exception 'conversion_photo_selection_invalid'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(v_selection) item(value)
      where private.try_parse_uuid(item.value) is null
        or not exists (
          select 1
          from public.email_attachments attachment
          where attachment.id = private.try_parse_uuid(item.value)
            and attachment.company_id = new.company_id
            and attachment.opportunity_id = new.opportunity_id
            and private.email_conversion_photo_source_is_eligible(
              attachment.id
            )
        )
    ) then
      raise exception 'conversion_photo_selection_stale'
        using errcode = '40001';
    end if;

    new.payload := new.payload || jsonb_build_object(
      'selected_email_attachment_ids',
      v_selection
    );
  end if;

  return new;
end;
$function$;

revoke all on function private.prepare_conversion_photo_selection_event()
  from public, anon, authenticated, service_role;

drop trigger if exists conversion_events_prepare_photo_selection
  on public.opportunity_conversion_events;
create trigger conversion_events_prepare_photo_selection
before insert on public.opportunity_conversion_events
for each row execute function private.prepare_conversion_photo_selection_event();

create or replace function private.enqueue_conversion_event_email_photos()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.event_type is distinct from 'converted_to_project' then
    return new;
  end if;

  -- The conversion core remains the single source for legacy select-all
  -- behavior. For an explicit selection, remove only manual lead-photo rows
  -- inserted by this transaction; pre-existing project photos are untouchable.
  if new.payload ? 'selected_lead_photo_urls' then
    delete from public.project_photos photo
    using public.opportunities opportunity
    where opportunity.id = new.opportunity_id
      and opportunity.company_id = new.company_id
      and photo.project_id = new.project_id::text
      and photo.company_id = new.company_id::text
      and photo.source = 'other'
      and photo.created_at = transaction_timestamp()
      and photo.url = any(coalesce(opportunity.images, '{}'::text[]))
      and not (
        (new.payload -> 'selected_lead_photo_urls') ? photo.url
      );
  end if;

  insert into public.email_conversion_photo_jobs (
    company_id,
    conversion_event_id,
    email_attachment_id,
    opportunity_id,
    project_id,
    source_content_sha256,
    source_verified_size_bytes,
    operation,
    status,
    available_at
  )
  select
    new.company_id,
    new.id,
    attachment.id,
    new.opportunity_id,
    new.project_id,
    attachment.content_sha256,
    attachment.verified_size_bytes,
    'materialize',
    'pending',
    now()
  from public.email_attachments attachment
  where attachment.company_id = new.company_id
    and attachment.opportunity_id = new.opportunity_id
    and private.email_conversion_photo_source_is_eligible(attachment.id)
    and (
      not (new.payload ? 'selected_email_attachment_ids')
      or (new.payload -> 'selected_email_attachment_ids')
        ? attachment.id::text
    )
  order by attachment.occurred_at, attachment.id
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function private.enqueue_conversion_event_email_photos()
  from public, anon, authenticated, service_role;

-- Later attachment reconciliation must honor the immutable selection too.
do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'private.reconcile_email_attachment_conversion_photo(uuid)'
  );
  v_definition text;
  v_old_revoke text := $old$
       not eligible
       or job.opportunity_id is distinct from attachment.opportunity_id
$old$;
  v_new_revoke text := $new$
       not eligible
       or job.opportunity_id is distinct from attachment.opportunity_id
       or exists (
         select 1
           from public.opportunity_conversion_events selection_event
          where selection_event.id = job.conversion_event_id
            and selection_event.payload ? 'selected_email_attachment_ids'
            and not (
              (selection_event.payload -> 'selected_email_attachment_ids')
                ? attachment.id::text
            )
       )
$new$;
  v_old_event_filter text := $old$
         and event.event_type = 'converted_to_project'
       order by event.id
$old$;
  v_new_event_filter text := $new$
         and event.event_type = 'converted_to_project'
         and (
           not (event.payload ? 'selected_email_attachment_ids')
           or (event.payload -> 'selected_email_attachment_ids')
             ? attachment.id::text
         )
       order by event.id
$new$;
begin
  if v_signature is null then
    raise exception 'reconcile_email_attachment_conversion_photo missing';
  end if;
  select pg_get_functiondef(v_signature) into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_old_revoke, '')))
      / length(v_old_revoke) <> 1 then
    raise exception 'conversion photo revoke patch did not match once';
  end if;
  v_definition := replace(v_definition, v_old_revoke, v_new_revoke);

  if (length(v_definition) - length(replace(v_definition, v_old_event_filter, '')))
      / length(v_old_event_filter) <> 1 then
    raise exception 'conversion photo event filter patch did not match once';
  end if;
  v_definition := replace(
    v_definition,
    v_old_event_filter,
    v_new_event_filter
  );
  execute v_definition;
end;
$migration$;

alter table public.lead_disposition_feedback
  drop constraint if exists lead_disposition_feedback_reason_code_check;
alter table public.lead_disposition_feedback
  add constraint lead_disposition_feedback_reason_code_check
  check (reason_code = any (array[
    'spam'::text,
    'job_applicant'::text,
    'vendor_sales'::text,
    'internal'::text,
    'platform_notification'::text,
    'test_traffic'::text,
    'duplicate'::text,
    'not_a_fit'::text,
    'created_by_error'::text,
    'other'::text,
    'legacy_unspecified'::text,
    'not_now'::text,
    'seasonal'::text,
    'waiting_on_client'::text,
    'archive_unspecified'::text
  ]));

-- Preserve the current production function and narrowly replace the reason
-- vocabulary and outcome tables. Assertion guards make schema drift fatal.
do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.apply_lead_disposition_feedback(uuid,text,text,text)'
  );
  v_definition text;
  v_old_reason_list text := $old$
      'duplicate',
      'not_a_fit',
      'other'
$old$;
  v_new_reason_list text := $new$
      'duplicate',
      'not_a_fit',
      'created_by_error',
      'other'
$new$;
  v_old_outcome text := $old$
      'test_traffic',
      'legacy_unspecified'
    ) then 'discarded'
    when v_reason = 'not_a_fit' then 'lost'
    when v_reason = 'duplicate' then 'duplicate_review'
    when v_reason = 'other' then 'review_deferred'
$old$;
  v_new_outcome text := $new$
      'test_traffic',
      'duplicate',
      'not_a_fit',
      'created_by_error',
      'other',
      'legacy_unspecified'
    ) then 'discarded'
$new$;
  v_old_learning text := $old$
    when v_reason = 'not_a_fit' then 'positive'
    else 'neutral'
$old$;
  v_new_learning text := $new$
    else 'neutral'
$new$;
begin
  if v_signature is null then
    raise exception 'apply_lead_disposition_feedback missing';
  end if;
  select pg_get_functiondef(v_signature) into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_old_reason_list, '')))
      / length(v_old_reason_list) <> 1 then
    raise exception 'lead feedback reason patch did not match once';
  end if;
  v_definition := replace(v_definition, v_old_reason_list, v_new_reason_list);

  if (length(v_definition) - length(replace(v_definition, v_old_outcome, '')))
      / length(v_old_outcome) <> 1 then
    raise exception 'lead feedback outcome patch did not match once';
  end if;
  v_definition := replace(v_definition, v_old_outcome, v_new_outcome);

  if (length(v_definition) - length(replace(v_definition, v_old_learning, '')))
      / length(v_old_learning) <> 1 then
    raise exception 'lead feedback learning patch did not match once';
  end if;
  v_definition := replace(v_definition, v_old_learning, v_new_learning);
  execute v_definition;
end;
$migration$;

alter table public.opportunity_dispositions
  drop constraint if exists opportunity_dispositions_disposition_check;
alter table public.opportunity_dispositions
  add constraint opportunity_dispositions_disposition_check
  check (disposition = any (array[
    'won'::text,
    'lost'::text,
    'disqualified'::text,
    'discarded'::text,
    'archived'::text,
    'merged'::text,
    'converted_to_project'::text
  ]));

-- A future-budget answer is a real lead being parked, not a qualified loss.
-- Keep the guarded evidence/high-water contract and change only its lifecycle
-- projection from Lost to archived/not_now.
do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.apply_email_opportunity_deferred_disposition(uuid,uuid,uuid,text,bigint,text,timestamptz,jsonb)'
  );
  v_definition text;
  v_old_disposition_lookup text := $old$
     and disposition.disposition = 'lost'
     and disposition.reason_code = 'budget_timing'
$old$;
  v_new_disposition_lookup text := $new$
     and disposition.disposition = 'archived'
     and disposition.reason_code = 'not_now'
$new$;
  v_old_already_applied text := $old$
  if v_opp.stage = 'lost'
    and v_existing_disposition_id is not null
$old$;
  v_new_already_applied text := $new$
  if v_opp.archived_at is not null
    and v_existing_disposition_id is not null
$new$;
  v_old_redeferral text := $old$
  v_is_redeferral := v_opp.stage = 'lost'
    and v_existing_disposition_id is not null;
$old$;
  v_new_redeferral text := $new$
  v_is_redeferral := v_opp.archived_at is not null
    and v_existing_disposition_id is not null;
$new$;
  v_old_terminal text := $old$
  if v_opp.stage in ('won', 'lost', 'discarded')
    and not v_is_redeferral
$old$;
  v_new_terminal text := $new$
  if (
    v_opp.stage in ('won', 'lost', 'discarded')
    or v_opp.archived_at is not null
  ) and not v_is_redeferral
$new$;
  v_old_projection text := $old$
  if v_is_redeferral then
    update public.opportunities
       set lost_reason = 'budget_timing',
           lost_notes = 'Customer deferred the work to a future budget cycle.',
           next_follow_up_at = v_effective_follow_up_at,
           updated_at = now()
     where id = p_opportunity_id
       and company_id = p_company_id;
  else
    update public.opportunities
       set stage = 'lost',
           stage_entered_at = now(),
           win_probability = 0,
           lost_reason = 'budget_timing',
           lost_notes = 'Customer deferred the work to a future budget cycle.',
           next_follow_up_at = v_effective_follow_up_at,
           actual_close_date = now()::date,
           updated_at = now()
     where id = p_opportunity_id
       and company_id = p_company_id;

    insert into public.stage_transitions (
      company_id,
      opportunity_id,
      from_stage,
      to_stage,
      transitioned_at,
      transitioned_by,
      duration_in_stage
    ) values (
      p_company_id,
      p_opportunity_id,
      v_opp.stage,
      'lost',
      now(),
      null,
      now() - coalesce(v_opp.stage_entered_at, now())
    );
  end if;
$old$;
  v_new_projection text := $new$
  update public.opportunities
     set archived_at = coalesce(archived_at, now()),
         lost_reason = null,
         lost_notes = null,
         actual_close_date = null,
         next_follow_up_at = v_effective_follow_up_at,
         updated_at = now()
   where id = p_opportunity_id
     and company_id = p_company_id;
$new$;
  v_old_disposition_insert text := $old$
    'lost',
    'budget_timing',
    'Customer deferred the work to a future budget cycle.',
$old$;
  v_new_disposition_insert text := $new$
    'archived',
    'not_now',
    'Customer asked to revisit the work later.',
$new$;
  v_old_return text := $old$
    'lost'::text,
    v_effective_follow_up_at,
$old$;
  v_new_return text := $new$
    v_opp.stage,
    v_effective_follow_up_at,
$new$;
begin
  if v_signature is null then
    raise exception 'apply_email_opportunity_deferred_disposition missing';
  end if;
  select pg_get_functiondef(v_signature) into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_old_disposition_lookup, '')))
      / length(v_old_disposition_lookup) <> 1 then
    raise exception 'not-now disposition lookup patch did not match once';
  end if;
  v_definition := replace(
    v_definition,
    v_old_disposition_lookup,
    v_new_disposition_lookup
  );

  if (length(v_definition) - length(replace(v_definition, v_old_already_applied, '')))
      / length(v_old_already_applied) <> 1 then
    raise exception 'not-now idempotency patch did not match once';
  end if;
  v_definition := replace(
    v_definition,
    v_old_already_applied,
    v_new_already_applied
  );

  if (length(v_definition) - length(replace(v_definition, v_old_redeferral, '')))
      / length(v_old_redeferral) <> 1 then
    raise exception 'not-now redeferral patch did not match once';
  end if;
  v_definition := replace(v_definition, v_old_redeferral, v_new_redeferral);

  if (length(v_definition) - length(replace(v_definition, v_old_terminal, '')))
      / length(v_old_terminal) <> 1 then
    raise exception 'not-now terminal patch did not match once';
  end if;
  v_definition := replace(v_definition, v_old_terminal, v_new_terminal);

  if (length(v_definition) - length(replace(v_definition, v_old_projection, '')))
      / length(v_old_projection) <> 1 then
    raise exception 'not-now lifecycle projection patch did not match once';
  end if;
  v_definition := replace(v_definition, v_old_projection, v_new_projection);

  if (length(v_definition) - length(replace(v_definition, v_old_disposition_insert, '')))
      / length(v_old_disposition_insert) <> 1 then
    raise exception 'not-now disposition insert patch did not match once';
  end if;
  v_definition := replace(
    v_definition,
    v_old_disposition_insert,
    v_new_disposition_insert
  );

  if (length(v_definition) - length(replace(v_definition, v_old_return, '')))
      / length(v_old_return) <> 1 then
    raise exception 'not-now return patch did not match once';
  end if;
  v_definition := replace(v_definition, v_old_return, v_new_return);
  execute v_definition;
end;
$migration$;

comment on function public.apply_email_opportunity_deferred_disposition(
  uuid, uuid, uuid, text, bigint, text, timestamptz, jsonb
) is
  'Archives an evidence-bound budget/timing deferral as not_now while preserving the active stage and a guarded follow-up date.';

commit;
