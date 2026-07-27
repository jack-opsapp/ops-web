begin;

do $prerequisites$
begin
  if to_regclass('private.external_api_security_events') is null
    or to_regclass('private.external_api_credentials') is null
    or to_regclass('private.external_intake_upload_batches') is null
    or to_regclass(
      'private.external_intake_submission_replay_digests'
    ) is null
    or to_regprocedure(
      'private.require_external_api_service_role()'
    ) is null
    or to_regprocedure(
      'private.append_external_api_security_event(uuid,text,uuid,uuid,uuid,uuid,uuid,text,bigint)'
    ) is null
    or to_regprocedure(
      'public.purge_external_api_network_fingerprints_as_system(timestamp with time zone)'
    ) is null
    or to_regprocedure(
      'public.prune_external_lead_projection_versions_as_system(timestamp with time zone)'
    ) is null
  then
    raise exception 'external_api_operations_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

alter table private.external_api_security_events
  drop constraint external_api_security_events_type_check;

alter table private.external_api_security_events
  add constraint external_api_security_events_type_check
  check (
    event_type in (
      'principal_created',
      'credential_created',
      'credential_updated',
      'credential_rotated',
      'credential_revoked',
      'credential_rejected',
      'source_created',
      'source_updated',
      'scope_denied',
      'source_denied',
      'cross_tenant_denied',
      'hostile_upload'
    )
  );

create table private.external_api_security_retention_tokens (
  transaction_id bigint primary key,
  token uuid not null unique,
  expires_at timestamptz not null
);

alter table private.external_api_security_retention_tokens
  enable row level security;

revoke all on table private.external_api_security_retention_tokens
  from public, anon, authenticated, service_role;

create or replace function private.reject_external_api_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_token_text text :=
    current_setting('ops.external_api_security_retention_token', true);
begin
  if tg_op = 'DELETE'
    and v_token_text is not null
    and v_token_text <> ''
    and exists (
      select 1
      from private.external_api_security_retention_tokens token
      where token.transaction_id = txid_current()
        and token.token = v_token_text::uuid
        and token.expires_at >= clock_timestamp()
    )
  then
    return old;
  end if;

  raise exception 'external_api_security_events_append_only'
    using errcode = '42501';
end;
$function$;

create or replace function public.record_external_api_authorization_denial_as_system(
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_failure_code text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event_type text;
  v_epoch bigint;
begin
  perform private.require_external_api_service_role();

  if p_failure_code = 'insufficient_scope' then
    v_event_type := 'scope_denied';
  elsif p_failure_code in ('source_not_allowed', 'form_not_allowed') then
    v_event_type := 'source_denied';
  elsif p_failure_code = 'cross_tenant_denied' then
    v_event_type := 'cross_tenant_denied';
  else
    raise exception 'external_api_denial_code_invalid'
      using errcode = '22023';
  end if;

  select principal.authorization_epoch
  into v_epoch
  from private.external_api_principals principal
  join private.external_api_credentials credential
    on credential.principal_id = principal.id
   and credential.company_id = principal.company_id
  where principal.id = p_principal_id
    and principal.company_id = p_company_id
    and credential.id = p_credential_id
  for share of principal, credential;

  if not found then
    raise exception 'external_api_denial_identity_invalid'
      using errcode = '42501';
  end if;

  perform private.append_external_api_security_event(
    p_company_id => p_company_id,
    p_event_type => v_event_type,
    p_principal_id => p_principal_id,
    p_credential_id => p_credential_id,
    p_reason_code => p_failure_code,
    p_authorization_epoch => v_epoch
  );

  return true;
end;
$function$;

create or replace function private.record_external_api_unsafe_upload()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_batch record;
begin
  if new.state = 'rejected'
    and new.safe_code = 'unsafe_content'
    and (
      old.state is distinct from new.state
      or old.safe_code is distinct from new.safe_code
    )
  then
    select
      batch.company_id,
      batch.principal_id,
      batch.credential_id,
      principal.authorization_epoch
    into v_batch
    from private.external_intake_upload_batches batch
    join private.external_api_principals principal
      on principal.id = batch.principal_id
     and principal.company_id = batch.company_id
    where batch.id = new.batch_id
      and batch.company_id = new.company_id
    for share of batch, principal;

    if found then
      perform private.append_external_api_security_event(
        p_company_id => v_batch.company_id,
        p_event_type => 'hostile_upload',
        p_principal_id => v_batch.principal_id,
        p_credential_id => v_batch.credential_id,
        p_reason_code => 'unsafe_content',
        p_authorization_epoch => v_batch.authorization_epoch
      );
    end if;
  end if;

  return new;
end;
$function$;

create trigger external_intake_upload_intents_security_event
after update of state, safe_code
on private.external_intake_upload_intents
for each row
execute function private.record_external_api_unsafe_upload();

create unique index notifications_external_api_security_dedupe
  on public.notifications (user_id, company_id, dedupe_key)
  where type = 'external_api_security';

create or replace function public.maintain_external_api_operations_as_system(
  p_idempotency_kids smallint[],
  p_limit integer default 100,
  p_now timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := least(
    coalesce(p_now, clock_timestamp()),
    clock_timestamp()
  );
  v_retention_token uuid := gen_random_uuid();
  v_referenced_kids smallint[];
  v_missing_kids smallint[];
  v_credentials_retired bigint := 0;
  v_network_purged bigint := 0;
  v_events_purged bigint := 0;
  v_projection_pruned bigint := 0;
  v_alerts_created bigint := 0;
  v_recipients_notified bigint := 0;
  v_health jsonb;
begin
  perform private.require_external_api_service_role();

  if p_limit is null
    or p_limit not between 1 and 500
    or p_idempotency_kids is null
    or cardinality(p_idempotency_kids) not between 1 and 32
    or array_position(p_idempotency_kids, null) is not null
    or exists (
      select 1
      from unnest(p_idempotency_kids) kid
      where kid <= 0
    )
    or (
      select count(*)
      from unnest(p_idempotency_kids) kid
    ) <> (
      select count(distinct kid)
      from unnest(p_idempotency_kids) kid
    )
  then
    raise exception 'external_api_operations_arguments_invalid'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(kid order by kid), '{}'::smallint[])
  into v_referenced_kids
  from (
    select distinct batch.idempotency_digest_version as kid
    from private.external_intake_upload_batches batch
    union
    select distinct replay.digest_version as kid
    from private.external_intake_submission_replay_digests replay
  ) retained;

  select coalesce(array_agg(kid order by kid), '{}'::smallint[])
  into v_missing_kids
  from unnest(v_referenced_kids) kid
  where not kid = any(p_idempotency_kids);

  if cardinality(v_missing_kids) > 0 then
    raise exception 'external_api_idempotency_key_missing'
      using
        errcode = '55000',
        detail = array_to_string(v_missing_kids, ',');
  end if;

  with due as (
    select credential.id
    from private.external_api_credentials credential
    where credential.status = 'overlap'
      and credential.overlap_until <= v_now
    order by credential.overlap_until, credential.id
    for update skip locked
    limit p_limit
  )
  update private.external_api_credentials credential
  set status = 'retired',
      retired_at = v_now,
      overlap_started_at = null,
      overlap_until = null,
      updated_at = v_now
  from due
  where credential.id = due.id;
  get diagnostics v_credentials_retired = row_count;

  select public.purge_external_api_network_fingerprints_as_system(
    v_now - interval '30 days'
  )
  into v_network_purged;

  insert into private.external_api_security_retention_tokens (
    transaction_id,
    token,
    expires_at
  ) values (
    txid_current(),
    v_retention_token,
    clock_timestamp() + interval '5 minutes'
  )
  on conflict (transaction_id)
  do update set
    token = excluded.token,
    expires_at = excluded.expires_at;

  perform set_config(
    'ops.external_api_security_retention_token',
    v_retention_token::text,
    true
  );

  with expired as (
    select event.id
    from private.external_api_security_events event
    where event.occurred_at < v_now - interval '365 days'
    order by event.occurred_at, event.id
    for update skip locked
    limit p_limit
  )
  delete from private.external_api_security_events event
  using expired
  where event.id = expired.id;
  get diagnostics v_events_purged = row_count;

  select public.prune_external_lead_projection_versions_as_system(v_now)
  into v_projection_pruned;

  with security_signals as (
    select
      event.company_id,
      'credential_attack'::text as signal_kind
    from private.external_api_security_events event
    where event.company_id is not null
      and event.event_type = 'credential_rejected'
      and event.occurred_at >= v_now - interval '15 minutes'
    group by event.company_id
    having count(*) >= 5
    union
    select distinct
      event.company_id,
      'access_denied'::text
    from private.external_api_security_events event
    where event.company_id is not null
      and event.event_type in ('cross_tenant_denied', 'source_denied')
      and event.occurred_at >= v_now - interval '15 minutes'
    union
    select distinct
      event.company_id,
      'unsafe_upload'::text
    from private.external_api_security_events event
    where event.company_id is not null
      and event.event_type = 'hostile_upload'
      and event.occurred_at >= v_now - interval '15 minutes'
  ),
  recipients as (
    select
      signal.company_id,
      signal.signal_kind,
      operator_user.id as user_id
    from security_signals signal
    join public.companies company
      on company.id = signal.company_id
     and company.deleted_at is null
    join public.users operator_user
      on operator_user.company_id = signal.company_id
     and operator_user.deleted_at is null
     and coalesce(operator_user.is_active, false)
     and (
       coalesce(operator_user.is_company_admin, false)
       or operator_user.id::text = company.account_holder_id
     )
  ),
  inserted as (
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
    select
      recipient.user_id::text,
      recipient.company_id::text,
      'external_api_security',
      case recipient.signal_kind
        when 'credential_attack' then 'Website key under attack'
        when 'access_denied' then 'Website access blocked'
        else 'Unsafe website upload blocked'
      end,
      case recipient.signal_kind
        when 'credential_attack'
          then 'Repeated rejected requests were detected. Rotate the website key and review the connection.'
        when 'access_denied'
          then 'A website request was blocked outside its approved access.'
        else 'An unsafe website upload was blocked before it reached a lead record.'
      end,
      false,
      true,
      '/settings?section=website',
      'Review connection',
      'external_api_security',
      'external-api-security:' || recipient.signal_kind || ':' ||
        recipient.company_id::text || ':' ||
        floor(extract(epoch from v_now) / 900)::bigint::text
    from recipients recipient
    on conflict do nothing
    returning dedupe_key
  )
  select
    count(distinct inserted.dedupe_key),
    count(*)
  into v_alerts_created, v_recipients_notified
  from inserted;

  select jsonb_build_object(
    'active_expired_upload_batches', least(
      (
        select count(*)
        from private.external_intake_upload_batches batch
        where batch.state = 'active'
          and batch.expires_at <= v_now
      ),
      1000000
    ),
    'overlap_credentials_due', least(
      (
        select count(*)
        from private.external_api_credentials credential
        where credential.status = 'overlap'
          and credential.overlap_until <= v_now
      ),
      1000000
    ),
    'expired_network_fingerprints', least(
      (
        select count(*)
        from private.external_api_network_fingerprints fingerprint
        where fingerprint.expires_at <= v_now
      ),
      1000000
    ),
    'expired_security_events', least(
      (
        select count(*)
        from private.external_api_security_events event
        where event.occurred_at < v_now - interval '365 days'
      ),
      1000000
    ),
    'expired_projection_versions', least(
      (
        select count(*)
        from private.external_lead_projection_versions version
        where version.projected_at < v_now - interval '30 days'
          and not exists (
            select 1
            from private.external_lead_projection_baselines baseline
            where baseline.version_id = version.id
              and baseline.company_id = version.company_id
          )
      ),
      1000000
    ),
    'pending_security_alerts', least(
      (
        select count(*)
        from (
          select event.company_id
          from private.external_api_security_events event
          where event.company_id is not null
            and event.event_type in (
              'credential_rejected',
              'cross_tenant_denied',
              'source_denied',
              'hostile_upload'
            )
            and event.occurred_at >= v_now - interval '15 minutes'
          group by event.company_id, event.event_type
        ) pending
      ),
      1000000
    )
  )
  into v_health;

  delete from private.external_api_security_retention_tokens token
  where token.transaction_id = txid_current()
     or token.expires_at < clock_timestamp();

  return jsonb_build_object(
    'credentials_retired', v_credentials_retired,
    'network_fingerprints_purged', v_network_purged,
    'security_events_purged', v_events_purged,
    'projection_versions_pruned', v_projection_pruned,
    'alerts_created', v_alerts_created,
    'recipients_notified', v_recipients_notified,
    'referenced_idempotency_kids', to_jsonb(v_referenced_kids),
    'missing_idempotency_kids', to_jsonb(v_missing_kids),
    'health', v_health
  );
end;
$function$;

revoke all on function public.record_external_api_authorization_denial_as_system(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.record_external_api_authorization_denial_as_system(
  uuid,
  uuid,
  uuid,
  text
) to service_role;

revoke all on function public.maintain_external_api_operations_as_system(
  smallint[],
  integer,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.maintain_external_api_operations_as_system(
  smallint[],
  integer,
  timestamptz
) to service_role;

revoke all on function private.record_external_api_unsafe_upload()
  from public, anon, authenticated, service_role;

revoke all on function private.reject_external_api_audit_mutation()
  from public, anon, authenticated, service_role;

commit;
