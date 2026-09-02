begin;

do $prerequisites$
begin
  if to_regclass('private.external_lead_projection_state') is null
    or to_regclass('private.external_lead_projection_versions') is null
    or to_regclass('private.external_lead_projection_baselines') is null
    or to_regprocedure(
      'private.require_external_api_service_role()'
    ) is null
    or to_regprocedure(
      'private.insert_external_api_authenticated_audit_base(uuid,uuid,uuid,text,text,timestamp with time zone)'
    ) is null
  then
    raise exception 'external_lead_feed_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

alter table private.external_lead_projection_state
  add column retained_from_sequence bigint not null default 1,
  add constraint external_lead_projection_state_retention_floor_check
    check (
      retained_from_sequence > 0
      and retained_from_sequence <= high_water_sequence + 1
    );

create or replace function private.require_external_analytics_credential(
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_require_financial boolean
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.require_external_api_service_role();
  if p_principal_id is null
    or p_credential_id is null
    or p_company_id is null
    or p_digest_version is null
    or p_digest_version <= 0
    or p_credential_digest is null
    or octet_length(p_credential_digest) <> 32
    or p_visible_prefix is null
    or char_length(p_visible_prefix) not between 8 and 32
    or p_authorization_epoch is null
    or p_authorization_epoch <= 0
  then
    raise exception 'external_analytics_credential_invalid'
      using errcode = '42501';
  end if;

  perform private.lock_external_api_company_shared(p_company_id);
  perform 1
  from private.external_api_principals principal
  join private.external_api_credentials credential
    on credential.principal_id = principal.id
   and credential.company_id = principal.company_id
  where principal.id = p_principal_id
    and principal.company_id = p_company_id
    and credential.id = p_credential_id
    and credential.digest_version = p_digest_version
    and credential.secret_digest = p_credential_digest
    and credential.visible_prefix = p_visible_prefix
    and credential.issued_authorization_epoch = p_authorization_epoch
    and principal.authorization_epoch = p_authorization_epoch
    and principal.status = 'active'
    and principal.revoked_at is null
    and principal.credential_class = 'analytics'
    and principal.scopes @> array['analytics.leads.read']::text[]
    and (
      not p_require_financial
      or principal.scopes @> array['analytics.financial.read']::text[]
    )
    and (
      credential.status = 'active'
      or (
        credential.status = 'overlap'
        and credential.overlap_until > clock_timestamp()
      )
    )
    and (
      credential.expires_at is null
      or credential.expires_at > clock_timestamp()
    )
    and private.external_api_company_feature_enabled(p_company_id)
  for share of principal, credential;

  if not found then
    raise exception 'external_analytics_credential_invalid'
      using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.authorize_external_lead_feed_as_system(
  p_request_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_require_financial boolean,
  p_route text,
  p_method text,
  p_request_received_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_high_water bigint := 0;
  v_retained_from bigint := 1;
  v_data_through timestamptz := p_request_received_at;
begin
  perform private.insert_external_api_authenticated_audit_base(
    p_request_id,
    p_principal_id,
    p_credential_id,
    p_route,
    p_method,
    p_request_received_at
  );
  perform private.require_external_analytics_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch,
    p_require_financial
  );

  select
    state.high_water_sequence,
    state.retained_from_sequence
  into v_high_water, v_retained_from
  from private.external_lead_projection_state state
  where state.company_id = p_company_id
  for share;

  v_high_water := coalesce(v_high_water, 0);
  v_retained_from := coalesce(v_retained_from, 1);

  select coalesce(max(version.projected_at), p_request_received_at)
  into v_data_through
  from private.external_lead_projection_versions version
  where version.company_id = p_company_id
    and version.change_sequence <= v_high_water;

  return jsonb_build_object(
    'high_water_sequence', v_high_water::text,
    'retained_from_sequence', v_retained_from::text,
    'data_through', v_data_through
  );
end;
$function$;

create or replace function public.read_external_lead_feed_page_as_system(
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_include_financial boolean,
  p_mode text,
  p_high_water_sequence bigint,
  p_after_public_lead_id uuid,
  p_after_sequence bigint,
  p_page_size integer,
  p_filters jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_result jsonb;
  v_state private.external_lead_projection_state%rowtype;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  perform private.require_external_analytics_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch,
    p_include_financial
  );

  if p_mode not in ('full', 'incremental')
    or p_high_water_sequence < 0
    or p_page_size not between 1 and 250
    or jsonb_typeof(v_filters) <> 'object'
    or exists (
      select 1
      from jsonb_object_keys(v_filters) filter_key
      where filter_key not in (
        'inquiryReceivedFrom',
        'inquiryReceivedTo',
        'updatedFrom',
        'updatedTo',
        'sourceId',
        'campaignHandle',
        'formId',
        'stage',
        'disposition',
        'recordState'
      )
    )
    or (p_mode = 'incremental' and v_filters <> '{}'::jsonb)
    or (p_mode = 'full' and p_after_sequence is not null)
    or (p_mode = 'incremental' and p_after_public_lead_id is not null)
    or (p_mode = 'incremental' and p_after_sequence is null)
  then
    raise exception 'external_lead_feed_arguments_invalid'
      using errcode = '22023';
  end if;

  select state.*
  into v_state
  from private.external_lead_projection_state state
  where state.company_id = p_company_id
  for share;

  if p_high_water_sequence > coalesce(v_state.high_water_sequence, 0) then
    raise exception 'external_lead_feed_high_water_invalid'
      using errcode = '22023';
  end if;
  if p_mode = 'incremental'
    and p_after_sequence < coalesce(v_state.retained_from_sequence, 1) - 1
  then
    raise exception 'external_lead_feed_checkpoint_expired'
      using errcode = '22023';
  end if;

  if p_mode = 'full' then
    with latest as (
      select distinct on (version.handle_id)
        version.handle_id,
        version.public_lead_id,
        version.change_sequence,
        version.operation,
        version.public_projection,
        version.projected_at
      from private.external_lead_projection_versions version
      where version.company_id = p_company_id
        and version.change_sequence <= p_high_water_sequence
      order by
        version.handle_id,
        version.change_sequence desc
    ),
    filtered as (
      select
        latest.public_lead_id,
        case
          when p_include_financial then latest.public_projection
          else latest.public_projection - 'financial'
        end as public_projection
      from latest
      where (
          latest.operation <> 'deletion'
          or latest.projected_at >= clock_timestamp() - interval '30 days'
        )
        and (
          p_after_public_lead_id is null
          or latest.public_lead_id > p_after_public_lead_id
        )
        and (
          not (v_filters ? 'inquiryReceivedFrom')
          or (
            latest.public_projection ->> 'inquiryReceivedAt'
          )::timestamptz >= (
            v_filters ->> 'inquiryReceivedFrom'
          )::timestamptz
        )
        and (
          not (v_filters ? 'inquiryReceivedTo')
          or (
            latest.public_projection ->> 'inquiryReceivedAt'
          )::timestamptz < (
            v_filters ->> 'inquiryReceivedTo'
          )::timestamptz
        )
        and (
          not (v_filters ? 'updatedFrom')
          or (
            latest.public_projection ->> 'updatedAt'
          )::timestamptz >= (v_filters ->> 'updatedFrom')::timestamptz
        )
        and (
          not (v_filters ? 'updatedTo')
          or (
            latest.public_projection ->> 'updatedAt'
          )::timestamptz < (v_filters ->> 'updatedTo')::timestamptz
        )
        and (
          not (v_filters ? 'sourceId')
          or latest.public_projection #>> '{source,sourceId}' =
            v_filters ->> 'sourceId'
        )
        and (
          not (v_filters ? 'campaignHandle')
          or latest.public_projection #>> '{source,campaign,handle}' =
            v_filters ->> 'campaignHandle'
        )
        and (
          not (v_filters ? 'formId')
          or latest.public_projection #>> '{source,formId}' =
            v_filters ->> 'formId'
        )
        and (
          not (v_filters ? 'stage')
          or latest.public_projection ->> 'currentStage' in (
            select jsonb_array_elements_text(v_filters -> 'stage')
          )
        )
        and (
          not (v_filters ? 'disposition')
          or latest.public_projection ->> 'disposition' in (
            select jsonb_array_elements_text(v_filters -> 'disposition')
          )
        )
        and (
          not (v_filters ? 'recordState')
          or latest.public_projection ->> 'recordState' in (
            select jsonb_array_elements_text(v_filters -> 'recordState')
          )
        )
      order by latest.public_lead_id
      limit p_page_size + 1
    ),
    numbered as (
      select
        filtered.*,
        row_number() over (order by filtered.public_lead_id) as ordinal
      from filtered
    )
    select jsonb_build_object(
      'items', coalesce(
        jsonb_agg(
          numbered.public_projection
          order by numbered.public_lead_id
        ) filter (where numbered.ordinal <= p_page_size),
        '[]'::jsonb
      ),
      'has_more', count(*) > p_page_size,
      'last_public_lead_id', (
        array_agg(
          numbered.public_lead_id
          order by numbered.public_lead_id
        ) filter (where numbered.ordinal <= p_page_size)
      )[least(count(*)::integer, p_page_size)]
    )
    into v_result
    from numbered;
  else
    with selected as (
      select
        version.change_sequence,
        case
          when p_include_financial then version.public_projection
          else version.public_projection - 'financial'
        end as public_projection
      from private.external_lead_projection_versions version
      where version.company_id = p_company_id
        and version.change_sequence > p_after_sequence
        and version.change_sequence <= p_high_water_sequence
      order by version.change_sequence
      limit p_page_size + 1
    ),
    numbered as (
      select
        selected.*,
        row_number() over (order by selected.change_sequence) as ordinal
      from selected
    )
    select jsonb_build_object(
      'items', coalesce(
        jsonb_agg(
          numbered.public_projection
          order by numbered.change_sequence
        ) filter (where numbered.ordinal <= p_page_size),
        '[]'::jsonb
      ),
      'has_more', count(*) > p_page_size,
      'last_sequence', (
        array_agg(
          numbered.change_sequence
          order by numbered.change_sequence
        ) filter (where numbered.ordinal <= p_page_size)
      )[least(count(*)::integer, p_page_size)]::text
    )
    into v_result
    from numbered;
  end if;

  return coalesce(
    v_result,
    jsonb_build_object('items', '[]'::jsonb, 'has_more', false)
  );
end;
$function$;

-- Retention now advances an explicit contiguous incremental-sync floor. Old
-- baseline versions can remain available for full sync without pretending
-- their surrounding sequence gaps are still replayable.
create or replace function public.prune_external_lead_projection_versions_as_system(
  p_now timestamptz default clock_timestamp()
) returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token uuid := gen_random_uuid();
  v_company record;
  v_deleted bigint;
  v_total bigint := 0;
begin
  perform private.require_external_api_service_role();

  insert into private.external_lead_projection_retention_tokens (
    transaction_id,
    token,
    expires_at
  ) values (
    txid_current(),
    v_token,
    clock_timestamp() + interval '5 minutes'
  )
  on conflict (transaction_id)
  do update set
    token = excluded.token,
    expires_at = excluded.expires_at;
  perform set_config(
    'ops.external_projection_retention_token',
    v_token::text,
    true
  );

  for v_company in
    select
      version.company_id,
      max(version.change_sequence) as maximum_deleted_sequence
    from private.external_lead_projection_versions version
    where version.projected_at < p_now - interval '30 days'
      and not exists (
        select 1
        from private.external_lead_projection_baselines baseline
        where baseline.version_id = version.id
          and baseline.company_id = version.company_id
      )
    group by version.company_id
  loop
    delete from private.external_lead_projection_versions version
    where version.company_id = v_company.company_id
      and version.change_sequence <= v_company.maximum_deleted_sequence
      and version.projected_at < p_now - interval '30 days'
      and not exists (
        select 1
        from private.external_lead_projection_baselines baseline
        where baseline.version_id = version.id
          and baseline.company_id = version.company_id
      );
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    update private.external_lead_projection_state state
    set retained_from_sequence = greatest(
          state.retained_from_sequence,
          v_company.maximum_deleted_sequence + 1
        ),
        updated_at = clock_timestamp()
    where state.company_id = v_company.company_id;
  end loop;

  delete from private.external_lead_projection_retention_tokens token
  where token.transaction_id = txid_current()
    and token.token = v_token;
  perform set_config('ops.external_projection_retention_token', '', true);
  return v_total;
end;
$function$;

revoke all on function private.require_external_analytics_credential(
  uuid, uuid, uuid, smallint, bytea, text, bigint, boolean
) from public, anon, authenticated, service_role;

revoke all on function public.authorize_external_lead_feed_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, boolean,
  text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.authorize_external_lead_feed_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, boolean,
  text, text, timestamptz
) to service_role;

revoke all on function public.read_external_lead_feed_page_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, boolean, text,
  bigint, uuid, bigint, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.read_external_lead_feed_page_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, boolean, text,
  bigint, uuid, bigint, integer, jsonb
) to service_role;

comment on function public.read_external_lead_feed_page_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, boolean, text,
  bigint, uuid, bigint, integer, jsonb
) is 'Fixed privacy-safe full/incremental lead read. Revalidates tenant, epoch, credential class and additive financial scope inside every database call.';

commit;
