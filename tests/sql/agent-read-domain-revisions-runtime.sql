-- Runtime contract for the private P2 read-domain revision kernel.
--
-- Run only against an isolated PostgreSQL 17 fixture after applying
-- 20260823072831_agent_read_domain_revisions.sql. Every mutation is rolled
-- back, and any failed assertion aborts the transaction.

-- Replay is part of the contract: the second apply must validate the existing
-- objects without changing any seeded revision.
\ir ../../supabase/migrations/20260823072831_agent_read_domain_revisions.sql

begin;

do $assert$
declare
  v_expected_domains constant text[] := array[
    'artifacts',
    'availability',
    'catalog',
    'company',
    'customer',
    'deck_designs',
    'expenses',
    'integrations',
    'payments',
    'purchasing',
    'sales_documents',
    'site_visits',
    'tasks',
    'team',
    'work_queue'
  ];
  v_seed_company uuid := '6a100000-0000-4000-8000-000000000001';
  v_role text;
  v_signature text;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'runtime_requires_postgresql_17';
  end if;

  if (
    select array_agg(domain.domain order by domain.domain)
    from private.agent_read_domains domain
  ) is distinct from v_expected_domains then
    raise exception 'closed_domain_vocabulary_mismatch';
  end if;

  if (
    select array_agg(revision.domain order by revision.domain)
    from private.agent_read_domain_revisions revision
    where revision.company_id = v_seed_company
  ) is distinct from v_expected_domains then
    raise exception 'existing_company_domain_seed_mismatch';
  end if;

  if exists (
    select 1
    from private.agent_read_domain_revisions revision
    where revision.company_id = v_seed_company
      and revision.source_revision <> 0
  ) then
    raise exception 'existing_company_seed_revision_churn';
  end if;

  if has_table_privilege(
      'anon',
      'private.agent_read_domain_revisions',
      'select,insert,update,delete'
    )
    or has_table_privilege(
      'authenticated',
      'private.agent_read_domain_revisions',
      'select,insert,update,delete'
    )
    or has_table_privilege(
      'service_role',
      'private.agent_read_domain_revisions',
      'select,insert,update,delete'
    ) then
    raise exception 'application_role_has_revision_table_access';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_signature in array array[
      'private.agent_read_domain_uuid_from_text(text)',
      'private.advance_agent_read_domain_revisions(uuid[],text)',
      'private.advance_agent_read_domain_revision(uuid,text)',
      'private.seed_agent_read_domain_revisions()',
      'private.bump_agent_read_domain_revision()'
    ] loop
      if has_function_privilege(v_role, v_signature, 'execute') then
        raise exception 'application_role_has_revision_helper_access:%:%',
          v_role,
          v_signature;
      end if;
    end loop;
  end loop;
end;
$assert$;

insert into public.companies (id, name)
values ('6a100000-0000-4000-8000-000000000002', 'Domain Revision Active');

insert into public.companies (id, name)
values ('6a100000-0000-4000-8000-000000000003', 'Domain Revision Deleted');

delete from public.companies
where id = '6a100000-0000-4000-8000-000000000003';

do $assert$
begin
  if (
    select count(*)
    from private.agent_read_domain_revisions revision
    where revision.company_id = '6a100000-0000-4000-8000-000000000002'
      and revision.source_revision = 0
  ) <> 15 then
    raise exception 'new_company_domain_seed_mismatch';
  end if;

  if (
    select count(*)
    from private.agent_read_domain_revisions revision
    where revision.company_id = '6a100000-0000-4000-8000-000000000003'
      and revision.source_revision = 0
  ) <> 15 then
    raise exception 'deleted_company_revision_tombstones_missing';
  end if;
end;
$assert$;

grant insert on public.companies to authenticated;
set local role authenticated;
insert into public.companies (id, name)
values ('6a100000-0000-4000-8000-000000000004', 'Domain Revision Authenticated');
reset role;

do $assert$
begin
  if (
    select count(*)
    from private.agent_read_domain_revisions revision
    where revision.company_id = '6a100000-0000-4000-8000-000000000004'
      and revision.source_revision = 0
  ) <> 15 then
    raise exception 'application_role_company_insert_did_not_seed';
  end if;
end;
$assert$;

create table public.agent_read_domain_revision_uuid_fixture (
  id uuid primary key,
  company_id uuid,
  payload text
);

create trigger agent_read_domain_revision_uuid_fixture_bump
after insert or update or delete
on public.agent_read_domain_revision_uuid_fixture
for each row execute function private.bump_agent_read_domain_revision(
  'tasks',
  'company_id'
);

create table public.agent_read_domain_revision_text_fixture (
  id uuid primary key,
  company_key text,
  payload text
);

create trigger agent_read_domain_revision_text_fixture_bump
after insert or update or delete
on public.agent_read_domain_revision_text_fixture
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits',
  'company_key'
);

create table public.agent_read_domain_revision_role_fixture (
  id uuid primary key,
  company_id uuid
);

create trigger agent_read_domain_revision_role_fixture_bump
after insert on public.agent_read_domain_revision_role_fixture
for each row execute function private.bump_agent_read_domain_revision(
  'catalog',
  'company_id'
);

grant insert on public.agent_read_domain_revision_role_fixture
  to authenticated;
set local role authenticated;
insert into public.agent_read_domain_revision_role_fixture (
  id,
  company_id
) values (
  '6a500000-0000-4000-8000-000000000001',
  '6a100000-0000-4000-8000-000000000001'
);
reset role;

do $assert$
begin
  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = '6a100000-0000-4000-8000-000000000001'
      and domain = 'catalog'
  ) <> 1 then
    raise exception 'application_role_source_insert_did_not_advance';
  end if;
end;
$assert$;

insert into public.agent_read_domain_revision_uuid_fixture (
  id,
  company_id,
  payload
) values (
  '6a200000-0000-4000-8000-000000000001',
  '6a100000-0000-4000-8000-000000000001',
  'insert'
);

update public.agent_read_domain_revision_uuid_fixture
set payload = 'same company update'
where id = '6a200000-0000-4000-8000-000000000001';

update public.agent_read_domain_revision_uuid_fixture
set company_id = '6a100000-0000-4000-8000-000000000002',
    payload = 'cross company move'
where id = '6a200000-0000-4000-8000-000000000001';

delete from public.agent_read_domain_revision_uuid_fixture
where id = '6a200000-0000-4000-8000-000000000001';

do $assert$
begin
  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = '6a100000-0000-4000-8000-000000000001'
      and domain = 'tasks'
  ) <> 3 then
    raise exception 'old_company_insert_update_move_revision_mismatch';
  end if;

  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = '6a100000-0000-4000-8000-000000000002'
      and domain = 'tasks'
  ) <> 2 then
    raise exception 'new_company_move_delete_revision_mismatch';
  end if;
end;
$assert$;

insert into public.agent_read_domain_revision_text_fixture (
  id,
  company_key,
  payload
) values
  (
    '6a300000-0000-4000-8000-000000000001',
    'not-a-uuid',
    'malformed insert must remain writable'
  ),
  (
    '6a300000-0000-4000-8000-000000000003',
    '{6a100000-0000-4000-8000-000000000001}',
    'noncanonical braced uuid must remain writable but inert'
  ),
  (
    '6a300000-0000-4000-8000-000000000002',
    '6A100000-0000-4000-8000-000000000001',
    'valid legacy tenant'
  );

update public.agent_read_domain_revision_text_fixture
set company_key = 'still-not-a-uuid',
    payload = 'malformed update must remain writable'
where id = '6a300000-0000-4000-8000-000000000001';

update public.agent_read_domain_revision_text_fixture
set company_key = '6a100000-0000-4000-8000-000000000002',
    payload = 'legacy cross-company move'
where id = '6a300000-0000-4000-8000-000000000002';

delete from public.agent_read_domain_revision_text_fixture
where id = '6a300000-0000-4000-8000-000000000002';

do $assert$
begin
  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = '6a100000-0000-4000-8000-000000000001'
      and domain = 'site_visits'
  ) <> 2 then
    raise exception 'legacy_old_company_revision_mismatch';
  end if;

  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = '6a100000-0000-4000-8000-000000000002'
      and domain = 'site_visits'
  ) <> 2 then
    raise exception 'legacy_new_company_revision_mismatch';
  end if;
end;
$assert$;

create table public.agent_read_domain_revision_bad_domain_fixture (
  id uuid primary key,
  company_id uuid
);

create trigger agent_read_domain_revision_bad_domain_fixture_bump
after insert on public.agent_read_domain_revision_bad_domain_fixture
for each row execute function private.bump_agent_read_domain_revision(
  'unknown',
  'company_id'
);

create table public.agent_read_domain_revision_bad_key_fixture (
  id uuid primary key,
  company_id uuid
);

create trigger agent_read_domain_revision_bad_key_fixture_bump
after insert on public.agent_read_domain_revision_bad_key_fixture
for each row execute function private.bump_agent_read_domain_revision(
  'tasks',
  'missing_company_key'
);

do $assert$
begin
  begin
    insert into public.agent_read_domain_revision_bad_domain_fixture (
      id,
      company_id
    ) values (
      '6a400000-0000-4000-8000-000000000001',
      '6a100000-0000-4000-8000-000000000001'
    );
    raise exception 'unknown_trigger_domain_was_accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  if exists (
    select 1
    from public.agent_read_domain_revision_bad_domain_fixture
  ) then
    raise exception 'rejected_domain_trigger_left_source_row';
  end if;

  begin
    insert into public.agent_read_domain_revision_bad_key_fixture (
      id,
      company_id
    ) values (
      '6a400000-0000-4000-8000-000000000002',
      '6a100000-0000-4000-8000-000000000001'
    );
    raise exception 'missing_trigger_company_key_was_accepted';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;

  if exists (
    select 1
    from public.agent_read_domain_revision_bad_key_fixture
  ) then
    raise exception 'rejected_key_trigger_left_source_row';
  end if;
end;
$assert$;

do $assert$
begin
  begin
    perform private.advance_agent_read_domain_revision(
      '6a100000-0000-4000-8000-000000000001',
      'unknown'
    );
    raise exception 'unknown_domain_was_accepted';
  exception
    when sqlstate '22023' then
      null;
  end;

  update private.agent_read_domain_revisions
  set source_revision = 9007199254740991
  where company_id = '6a100000-0000-4000-8000-000000000001'
    and domain = 'integrations';

  begin
    perform private.advance_agent_read_domain_revisions(
      array[
        '6a100000-0000-4000-8000-000000000002'::uuid,
        '6a100000-0000-4000-8000-000000000001'::uuid
      ],
      'integrations'
    );
    raise exception 'safe_integer_ceiling_wrapped';
  exception
    when numeric_value_out_of_range then
      null;
  end;

  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = '6a100000-0000-4000-8000-000000000002'
      and domain = 'integrations'
  ) <> 0 then
    raise exception 'batch_exhaustion_partially_advanced_other_company';
  end if;
end;
$assert$;

rollback;
