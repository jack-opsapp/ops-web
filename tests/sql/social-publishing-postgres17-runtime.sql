insert into public.companies (id, name)
values ('10000000-0000-4000-8000-000000000001', 'OPS Test');

insert into public.users (id, company_id, first_name, last_name, is_active)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Social',
  'Operator',
  true
);

insert into public.social_posts (
  id, idempotency_key, contract_version, source_type, story_type,
  visual_treatment, post_format, content, caption, alt_text, rendered_assets,
  status, publish_after, attempt_count, max_attempts, claim_token,
  claim_expires_at, publish_stage, render_version, selector_version,
  voice_reference_version, created_by, updated_by, updated_at
)
values
  (
    '30000000-0000-4000-8000-000000000001', 'stale-render', 'test', 'custom',
    'operator_protocol', 'operator_brief', 'single', '{}'::jsonb, 'caption', 'alt',
    '[]'::jsonb, 'rendering', now() - interval '1 hour', 0, 4, null, null, 'idle',
    'render-test', 'selector-test', 'voice-test', 'test', 'test', now() - interval '20 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000002', 'safe-reclaim', 'test', 'custom',
    'operator_protocol', 'operator_brief', 'single', '{}'::jsonb, 'caption', 'alt',
    '[{}]'::jsonb, 'publishing', now() - interval '1 hour', 1, 4,
    '40000000-0000-4000-8000-000000000001', now() - interval '1 minute', 'claimed',
    'render-test', 'selector-test', 'voice-test', 'test', 'test', now()
  ),
  (
    '30000000-0000-4000-8000-000000000003', 'attempts-exhausted', 'test', 'custom',
    'operator_protocol', 'operator_brief', 'single', '{}'::jsonb, 'caption', 'alt',
    '[{}]'::jsonb, 'publishing', now() - interval '1 hour', 4, 4,
    '40000000-0000-4000-8000-000000000002', now() - interval '1 minute', 'container_ready',
    'render-test', 'selector-test', 'voice-test', 'test', 'test', now()
  ),
  (
    '30000000-0000-4000-8000-000000000004', 'outcome-unknown', 'test', 'custom',
    'operator_protocol', 'operator_brief', 'single', '{}'::jsonb, 'caption', 'alt',
    '[{}]'::jsonb, 'publishing', now() - interval '1 hour', 1, 4,
    '40000000-0000-4000-8000-000000000003', now() - interval '1 minute', 'publish_requested',
    'render-test', 'selector-test', 'voice-test', 'test', 'test', now()
  ),
  (
    '30000000-0000-4000-8000-000000000005', 'ack-missing', 'test', 'custom',
    'operator_protocol', 'operator_brief', 'single', '{}'::jsonb, 'caption', 'alt',
    '[{}]'::jsonb, 'publishing', now() - interval '1 hour', 1, 4,
    '40000000-0000-4000-8000-000000000004', now() - interval '1 minute', 'publish_succeeded',
    'render-test', 'selector-test', 'voice-test', 'test', 'test', now()
  ),
  (
    '30000000-0000-4000-8000-000000000006', 'stage-ledger', 'test', 'custom',
    'operator_protocol', 'operator_brief', 'single', '{}'::jsonb, 'caption', 'alt',
    '[{}]'::jsonb, 'publishing', now() - interval '1 hour', 1, 4,
    '40000000-0000-4000-8000-000000000005', now() + interval '5 minutes', 'claimed',
    'render-test', 'selector-test', 'voice-test', 'test', 'test', now()
  );

do $$
declare
  v_claimed integer;
begin
  select count(*) into v_claimed
  from public.claim_due_social_posts(
    '50000000-0000-4000-8000-000000000001',
    10,
    180
  );
  if v_claimed <> 1 then
    raise exception 'social_runtime_expected_one_safe_reclaim';
  end if;

  if not exists (
    select 1 from public.social_posts
    where id = '30000000-0000-4000-8000-000000000002'
      and status = 'publishing'
      and publish_stage = 'claimed'
      and attempt_count = 2
      and claim_token = '50000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'social_runtime_safe_reclaim_failed';
  end if;

  if not exists (
    select 1 from public.social_posts
    where id = '30000000-0000-4000-8000-000000000003'
      and status = 'failed'
      and publish_stage = 'idle'
      and last_error_code = 'PUBLISH_ATTEMPTS_EXHAUSTED'
      and recovery_notification_pending
  ) then
    raise exception 'social_runtime_exhausted_lease_not_terminal';
  end if;

  if not exists (
    select 1 from public.social_posts
    where id = '30000000-0000-4000-8000-000000000004'
      and status = 'failed'
      and publish_stage = 'reconciliation_required'
      and last_error_code = 'PUBLISH_OUTCOME_UNKNOWN'
      and recovery_notification_pending
  ) then
    raise exception 'social_runtime_unknown_publish_not_quarantined';
  end if;

  if not exists (
    select 1 from public.social_posts
    where id = '30000000-0000-4000-8000-000000000005'
      and status = 'failed'
      and publish_stage = 'reconciliation_required'
      and last_error_code = 'PUBLISHED_ACK_NOT_PERSISTED'
      and recovery_notification_pending
  ) then
    raise exception 'social_runtime_ack_failure_not_quarantined';
  end if;

  if not exists (
    select 1 from public.social_posts
    where id = '30000000-0000-4000-8000-000000000001'
      and status = 'failed'
      and last_error_code = 'STALE_RENDERING'
      and recovery_notification_pending
  ) then
    raise exception 'social_runtime_stale_render_not_recovered';
  end if;

  if not public.record_social_publish_stage(
    '30000000-0000-4000-8000-000000000006',
    '40000000-0000-4000-8000-000000000005',
    'container_ready',
    'container-runtime',
    null
  ) then
    raise exception 'social_runtime_container_stage_failed';
  end if;
  if not public.record_social_publish_stage(
    '30000000-0000-4000-8000-000000000006',
    '40000000-0000-4000-8000-000000000005',
    'publish_requested',
    'container-runtime',
    null
  ) then
    raise exception 'social_runtime_publish_requested_stage_failed';
  end if;
  if not public.record_social_publish_stage(
    '30000000-0000-4000-8000-000000000006',
    '40000000-0000-4000-8000-000000000005',
    'publish_succeeded',
    'container-runtime',
    'media-runtime'
  ) then
    raise exception 'social_runtime_publish_succeeded_stage_failed';
  end if;
  if public.record_social_publish_stage(
    '30000000-0000-4000-8000-000000000006',
    '40000000-0000-4000-8000-000000000005',
    'container_ready',
    'container-runtime',
    null
  ) then
    raise exception 'social_runtime_stage_regression_was_accepted';
  end if;
end;
$$;

do $$
declare
  v_post public.social_posts%rowtype;
  v_count integer := 0;
begin
  for v_post in
    select * from public.claim_social_recovery_notifications(
      '60000000-0000-4000-8000-000000000001',
      10,
      180
    )
  loop
    v_count := v_count + 1;
    if not public.deliver_social_recovery_notification(
      v_post.id,
      '60000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001'
    ) then
      raise exception 'social_runtime_recovery_delivery_failed';
    end if;
  end loop;

  if v_count <> 4 then
    raise exception 'social_runtime_expected_four_recovery_notifications';
  end if;

  if (select count(*) from public.notifications where type = 'social_post_failed') <> 4 then
    raise exception 'social_runtime_notification_count_mismatch';
  end if;

  if exists (
    select 1 from public.social_posts where recovery_notification_pending
  ) then
    raise exception 'social_runtime_notification_outbox_not_acked';
  end if;

  if public.deliver_social_recovery_notification(
    '30000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'social_runtime_recovery_replay_not_zero';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.social_posts', 'select')
    or has_table_privilege('authenticated', 'public.social_posts', 'select')
    or not has_table_privilege('service_role', 'public.social_posts', 'select') then
    raise exception 'social_runtime_table_grants_invalid';
  end if;

  if has_function_privilege('anon', 'public.claim_due_social_posts(uuid,integer,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.claim_due_social_posts(uuid,integer,integer)', 'execute')
    or not has_function_privilege('service_role', 'public.claim_due_social_posts(uuid,integer,integer)', 'execute')
    or has_function_privilege('anon', 'public.claim_social_recovery_notifications(uuid,integer,integer)', 'execute')
    or not has_function_privilege('service_role', 'public.deliver_social_recovery_notification(uuid,uuid,uuid,uuid)', 'execute') then
    raise exception 'social_runtime_rpc_grants_invalid';
  end if;
end;
$$;

update public.social_posts
set status = 'cancelled', cancelled_at = now()
where id = '30000000-0000-4000-8000-000000000003';

do $$
begin
  if not exists (
    select 1
    from public.notifications
    where dedupe_key = 'social-recovery:30000000-0000-4000-8000-000000000003'
      and is_read
      and resolved_at is not null
  ) then
    raise exception 'social_runtime_delivered_recovery_not_resolved';
  end if;
end;
$$;

insert into public.social_posts (
  id, idempotency_key, contract_version, source_type, story_type,
  visual_treatment, post_format, content, caption, alt_text, rendered_assets,
  status, publish_after, attempt_count, max_attempts, publish_stage,
  recovery_notification_pending, recovery_notification_claim_token,
  recovery_notification_claim_expires_at, render_version, selector_version,
  voice_reference_version, created_by, updated_by
)
values (
  '30000000-0000-4000-8000-000000000007', 'pending-recovery-resolved', 'test',
  'custom', 'operator_protocol', 'operator_brief', 'single', '{}'::jsonb,
  'caption', 'alt', '[{}]'::jsonb, 'failed', now() - interval '1 hour', 4, 4,
  'idle', true, '60000000-0000-4000-8000-000000000002',
  now() + interval '3 minutes', 'render-test', 'selector-test', 'voice-test',
  'test', 'test'
);

update public.social_posts
set status = 'review'
where id = '30000000-0000-4000-8000-000000000007';

do $$
begin
  if exists (
    select 1
    from public.social_posts
    where id = '30000000-0000-4000-8000-000000000007'
      and (
        recovery_notification_pending
        or recovery_notification_claim_token is not null
        or recovery_notification_claim_expires_at is not null
      )
  ) then
    raise exception 'social_runtime_pending_recovery_not_cleared';
  end if;
end;
$$;

select 'SOCIAL_POSTGRES_RUNTIME_OK';
