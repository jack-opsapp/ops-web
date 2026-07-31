-- Make account deletion one PostgreSQL statement and therefore one transaction.
--
-- The API supplies the ordered company-data manifest as JSON. This function
-- validates that plan, materializes every parent scope before deleting any
-- parent, breaks the two declared foreign-key cycles, executes all hard and
-- soft deletes in order, and returns the committed per-table counts. Any error
-- is re-raised, so PostgreSQL rolls the entire invocation back.
--
-- SECURITY INVOKER is deliberate. service_role already has the ordinary table
-- privileges used here. The thirty tables it cannot delete remain behind the
-- narrow SECURITY DEFINER helper, public.purge_company_rows, whose allowlist is
-- re-asserted below. A caller-controlled plan therefore gains no new general
-- table privilege.

begin;

create or replace function public.purge_company_rows(
  p_table text,
  p_company_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_allowed constant text[] := array[
    'email_assignment_contact_form_draft_queue',
    'email_import_provider_operations',
    'email_outbound_edit_evidence',
    'email_outbound_edit_promotions',
    'email_outbound_learning_queue',
    'email_outbound_memory_evidence',
    'email_outbound_writing_samples',
    'email_provider_mutation_attempts',
    'opportunity_conversion_notification_deliveries',
    'phase_c_category_auto_send_acceptances',
    'project_status_lifecycle_outbox',
    'task_mutation_events',
    'task_schedule_automation_outbox',
    'unassigned_lead_assignment_deliveries',
    'user_permission_change_deliveries',
    'email_conversion_photo_jobs',
    'email_conversion_photo_objects',
    'email_ingestion_recovery_queue',
    'email_send_intents',
    'email_signature_notification_lifecycle_outbox',
    'email_signatures',
    'lead_intake_correction_runs',
    'opportunity_assignment_deliveries',
    'opportunity_assignment_events',
    'opportunity_assignment_suggestions',
    'opportunity_conversion_events',
    'opportunity_manual_outbound_cycle_receipts',
    'project_note_mention_events',
    'stage_transitions',
    'user_email_aliases'
  ];
  v_column_type text;
  v_deleted bigint;
begin
  if p_company_id is null then
    raise exception 'purge_company_rows: p_company_id is required'
      using errcode = '22004';
  end if;

  if not (p_table = any (v_allowed)) then
    raise exception 'purge_company_rows: % is not purgeable through this function', p_table
      using errcode = '42501';
  end if;

  select case
           when a.atttypid = 'uuid'::regtype then 'uuid'
           when a.atttypid in ('text'::regtype, 'varchar'::regtype) then 'text'
         end
    into v_column_type
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = p_table
     and a.attname = 'company_id'
     and a.attnum > 0
     and not a.attisdropped;

  if v_column_type is null then
    raise exception 'purge_company_rows: %.company_id is missing or unsupported', p_table
      using errcode = '42703';
  end if;

  execute pg_catalog.format(
    'delete from public.%I where company_id = $1::%s',
    p_table,
    v_column_type
  ) using p_company_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_company_rows(text, uuid) from public;
revoke all on function public.purge_company_rows(text, uuid) from anon;
revoke all on function public.purge_company_rows(text, uuid) from authenticated;
grant execute on function public.purge_company_rows(text, uuid) to service_role;

comment on function public.purge_company_rows(text, uuid) is
  'Deletes one company''s rows from one of thirty allowlisted company-data tables that service_role cannot purge directly.';

create or replace function public.purge_company_data(
  p_company_id uuid,
  p_plan jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_manifest_version text;
  v_steps jsonb;
  v_cycle_breakers jsonb;
  v_step jsonb;
  v_parent_step jsonb;
  v_breaker jsonb;
  v_table text;
  v_scope text;
  v_strategy text;
  v_company_column text;
  v_company_type text;
  v_parent_table text;
  v_parent_column text;
  v_parent_column_type text;
  v_breaker_column text;
  v_index integer := 0;
  v_total integer;
  v_required_parents integer;
  v_resolved_parents integer;
  v_progress integer;
  v_deleted bigint;
  v_deleted_counts jsonb := '{}'::jsonb;
  v_deleted_at timestamptz := pg_catalog.clock_timestamp();
  v_relation_ok boolean;
  v_error_state text;
  v_error_message text;
  v_error_detail text;
  v_error_hint text;
begin
  -- The expense/activity authority triggers deliberately treat empty claims as
  -- an internal maintenance operation. Keep the override transaction-local.
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  if p_company_id is null then
    raise exception 'purge_company_data: p_company_id is required'
      using errcode = '22004';
  end if;

  if p_plan is null or pg_catalog.jsonb_typeof(p_plan) <> 'object' then
    raise exception 'purge_company_data: p_plan must be a JSON object'
      using errcode = '22023';
  end if;

  v_manifest_version := nullif(p_plan ->> 'manifest_version', '');
  v_steps := p_plan -> 'steps';
  v_cycle_breakers := coalesce(p_plan -> 'cycle_breakers', '[]'::jsonb);

  if v_manifest_version is null then
    raise exception 'purge_company_data: manifest_version is required'
      using errcode = '22023';
  end if;
  if v_steps is null or pg_catalog.jsonb_typeof(v_steps) <> 'array' then
    raise exception 'purge_company_data: steps must be a JSON array'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_cycle_breakers) <> 'array' then
    raise exception 'purge_company_data: cycle_breakers must be a JSON array'
      using errcode = '22023';
  end if;

  v_total := pg_catalog.jsonb_array_length(v_steps);
  if v_total = 0 then
    raise exception 'purge_company_data: steps cannot be empty'
      using errcode = '22023';
  end if;

  if (
    select pg_catalog.count(*) <> pg_catalog.count(distinct entry ->> 'table')
      from pg_catalog.jsonb_array_elements(v_steps) entry
  ) then
    raise exception 'purge_company_data: every step table must be unique'
      using errcode = '22023';
  end if;

  -- Validate the whole plan before any mutation. This catches drift as one
  -- clean failure instead of discovering it after a preceding table changed.
  for v_step in
    select entry
      from pg_catalog.jsonb_array_elements(v_steps) entry
  loop
    v_table := nullif(v_step ->> 'table', '');
    v_scope := v_step ->> 'scope';
    v_strategy := v_step ->> 'deleteStrategy';

    if v_table is null or v_table !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'purge_company_data: invalid table name in plan'
        using errcode = '22023';
    end if;

    select c.relkind in ('r', 'p')
      into v_relation_ok
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = v_table;
    if not coalesce(v_relation_ok, false) then
      raise exception 'purge_company_data: public.% is not a base table', v_table
        using errcode = '42P01';
    end if;

    if v_scope not in ('company', 'parent') then
      raise exception 'purge_company_data: %.scope must be company or parent', v_table
        using errcode = '22023';
    end if;
    if v_strategy not in ('soft', 'hard') then
      raise exception 'purge_company_data: %.deleteStrategy must be soft or hard', v_table
        using errcode = '22023';
    end if;

    if v_strategy = 'soft' and not exists (
      select 1
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = v_table
         and a.attname = 'deleted_at'
         and a.attnum > 0
         and not a.attisdropped
    ) then
      raise exception 'purge_company_data: %.deleted_at does not exist', v_table
        using errcode = '42703';
    end if;

    if v_scope = 'company' then
      v_company_column := nullif(v_step ->> 'companyColumn', '');
      v_company_type := v_step ->> 'companyColumnType';
      if v_company_column is null or v_company_column !~ '^[a-z][a-z0-9_]*$' then
        raise exception 'purge_company_data: %.companyColumn is invalid', v_table
          using errcode = '22023';
      end if;
      if v_company_type not in ('uuid', 'text') then
        raise exception 'purge_company_data: %.companyColumnType is invalid', v_table
          using errcode = '22023';
      end if;
      if not exists (
        select 1
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = v_table
           and a.attname = v_company_column
           and a.attnum > 0
           and not a.attisdropped
           and (
             (v_company_type = 'uuid' and a.atttypid = 'uuid'::regtype)
             or
             (
               v_company_type = 'text'
               and a.atttypid in ('text'::regtype, 'varchar'::regtype)
             )
           )
      ) then
        raise exception 'purge_company_data: %.% is missing or does not match %',
          v_table, v_company_column, v_company_type
          using errcode = '42703';
      end if;
    else
      v_parent_table := nullif(v_step ->> 'parentTable', '');
      v_parent_column := nullif(v_step ->> 'parentColumn', '');
      if v_parent_table is null or v_parent_column is null
         or v_parent_table !~ '^[a-z][a-z0-9_]*$'
         or v_parent_column !~ '^[a-z][a-z0-9_]*$' then
        raise exception 'purge_company_data: % has an invalid parent scope', v_table
          using errcode = '22023';
      end if;
      if not exists (
        select 1
          from pg_catalog.jsonb_array_elements(v_steps) candidate
         where candidate ->> 'table' = v_parent_table
      ) then
        raise exception 'purge_company_data: % names missing parent table %',
          v_table, v_parent_table
          using errcode = '22023';
      end if;
      if not exists (
        select 1
          from pg_catalog.pg_constraint con
          join pg_catalog.pg_class child on child.oid = con.conrelid
          join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
          join pg_catalog.pg_class parent on parent.oid = con.confrelid
          join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
         where con.contype = 'f'
           and child_ns.nspname = 'public'
           and parent_ns.nspname = 'public'
           and child.relname = v_table
           and parent.relname = v_parent_table
           and pg_catalog.array_length(con.conkey, 1) = 1
           and pg_catalog.array_length(con.confkey, 1) = 1
           and (
             select a.attname
               from pg_catalog.pg_attribute a
              where a.attrelid = con.conrelid
                and a.attnum = con.conkey[1]
           ) = v_parent_column
           and (
             select a.attname
               from pg_catalog.pg_attribute a
              where a.attrelid = con.confrelid
                and a.attnum = con.confkey[1]
           ) = 'id'
      ) then
        raise exception 'purge_company_data: %.% is not a foreign key to %.id',
          v_table, v_parent_column, v_parent_table
          using errcode = '23503';
      end if;
    end if;

    if coalesce((v_step ->> 'definer_purged')::boolean, false)
       and not (
         v_scope = 'company'
         and v_company_column = 'company_id'
         and v_company_type in ('uuid', 'text')
         and v_strategy = 'hard'
       ) then
      raise exception 'purge_company_data: % is not eligible for definer purge', v_table
        using errcode = '22023';
    end if;
  end loop;

  v_step := v_steps -> (v_total - 1);
  if v_step ->> 'table' <> 'companies'
     or v_step ->> 'scope' <> 'company'
     or v_step ->> 'companyColumn' <> 'id'
     or v_step ->> 'companyColumnType' <> 'uuid'
     or v_step ->> 'deleteStrategy' <> 'soft' then
    raise exception 'purge_company_data: companies must be the final soft-delete step'
      using errcode = '22023';
  end if;

  create temporary table ops_company_purge_scope (
    table_name text not null,
    row_id text not null,
    primary key (table_name, row_id)
  ) on commit drop;

  create temporary table ops_company_purge_resolved (
    table_name text primary key
  ) on commit drop;

  select pg_catalog.count(distinct entry ->> 'parentTable')
    into v_required_parents
    from pg_catalog.jsonb_array_elements(v_steps) entry
   where entry ->> 'scope' = 'parent';

  -- Resolve every table used as a parent to a stable set of ids. Repeating to
  -- a fixpoint handles chains such as catalog items -> options -> values.
  loop
    v_progress := 0;

    for v_parent_table in
      select distinct entry ->> 'parentTable'
        from pg_catalog.jsonb_array_elements(v_steps) entry
       where entry ->> 'scope' = 'parent'
         and not exists (
           select 1
             from ops_company_purge_resolved r
            where r.table_name = entry ->> 'parentTable'
         )
    loop
      select entry
        into v_parent_step
        from pg_catalog.jsonb_array_elements(v_steps) entry
       where entry ->> 'table' = v_parent_table;

      if v_parent_step ->> 'scope' = 'company' then
        v_company_column := v_parent_step ->> 'companyColumn';
        v_company_type := v_parent_step ->> 'companyColumnType';

        execute pg_catalog.format(
          'insert into pg_temp.ops_company_purge_scope (table_name, row_id) '
          'select $1, id::text from public.%I where %I = $2::%s '
          'on conflict do nothing',
          v_parent_table,
          v_company_column,
          v_company_type
        ) using v_parent_table, p_company_id;

        insert into ops_company_purge_resolved (table_name)
        values (v_parent_table);
        v_progress := v_progress + 1;
      elsif exists (
        select 1
          from ops_company_purge_resolved r
         where r.table_name = v_parent_step ->> 'parentTable'
      ) then
        v_parent_column := v_parent_step ->> 'parentColumn';

        select pg_catalog.format_type(a.atttypid, a.atttypmod)
          into v_parent_column_type
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = v_parent_table
           and a.attname = v_parent_column
           and a.attnum > 0
           and not a.attisdropped;

        execute pg_catalog.format(
          'insert into pg_temp.ops_company_purge_scope (table_name, row_id) '
          'select $1, child.id::text '
          'from public.%I child '
          'join pg_temp.ops_company_purge_scope parent_scope '
          '  on parent_scope.table_name = $2 '
          ' and child.%I = parent_scope.row_id::%s '
          'on conflict do nothing',
          v_parent_table,
          v_parent_column,
          v_parent_column_type
        ) using v_parent_table, v_parent_step ->> 'parentTable';

        insert into ops_company_purge_resolved (table_name)
        values (v_parent_table);
        v_progress := v_progress + 1;
      end if;
    end loop;

    select pg_catalog.count(*)
      into v_resolved_parents
      from ops_company_purge_resolved;
    exit when v_resolved_parents = v_required_parents;
    if v_progress = 0 then
      raise exception 'purge_company_data: could not resolve every parent scope'
        using errcode = '22023';
    end if;
  end loop;

  -- Break only the cycles declared by the manifest. These updates remain part
  -- of this transaction and are rolled back with every later failure.
  for v_breaker in
    select entry
      from pg_catalog.jsonb_array_elements(v_cycle_breakers) entry
  loop
    v_table := nullif(v_breaker ->> 'table', '');
    v_breaker_column := nullif(v_breaker ->> 'column', '');
    v_company_column := nullif(v_breaker ->> 'companyColumn', '');

    select entry
      into v_step
      from pg_catalog.jsonb_array_elements(v_steps) entry
     where entry ->> 'table' = v_table;

    if v_step is null
       or v_step ->> 'scope' <> 'company'
       or v_company_column <> v_step ->> 'companyColumn'
       or v_breaker_column is null
       or not exists (
         select 1
           from pg_catalog.pg_attribute a
           join pg_catalog.pg_class c on c.oid = a.attrelid
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = v_table
            and a.attname = v_breaker_column
            and a.attnum > 0
            and not a.attisdropped
            and not a.attnotnull
       ) then
      raise exception 'purge_company_data: invalid cycle breaker for %',
        coalesce(v_table, '<missing>')
        using errcode = '22023';
    end if;

    execute pg_catalog.format(
      'update public.%I set %I = null '
      'where %I = $1::%s and %I is not null',
      v_table,
      v_breaker_column,
      v_company_column,
      v_step ->> 'companyColumnType',
      v_breaker_column
    ) using p_company_id;
  end loop;

  for v_step, v_index in
    select entry, ordinality::integer
      from pg_catalog.jsonb_array_elements(v_steps) with ordinality
        as planned(entry, ordinality)
     order by ordinality
  loop
    v_table := v_step ->> 'table';
    v_scope := v_step ->> 'scope';
    v_strategy := v_step ->> 'deleteStrategy';

    begin
      if coalesce((v_step ->> 'definer_purged')::boolean, false) then
        v_deleted := public.purge_company_rows(v_table, p_company_id);
      elsif v_scope = 'company' then
        v_company_column := v_step ->> 'companyColumn';
        v_company_type := v_step ->> 'companyColumnType';

        if v_strategy = 'soft' then
          execute pg_catalog.format(
            'update public.%I set deleted_at = $2 '
            'where %I = $1::%s and deleted_at is null',
            v_table,
            v_company_column,
            v_company_type
          ) using p_company_id, v_deleted_at;
        else
          execute pg_catalog.format(
            'delete from public.%I where %I = $1::%s',
            v_table,
            v_company_column,
            v_company_type
          ) using p_company_id;
        end if;
        get diagnostics v_deleted = row_count;
      else
        v_parent_table := v_step ->> 'parentTable';
        v_parent_column := v_step ->> 'parentColumn';

        select pg_catalog.format_type(a.atttypid, a.atttypmod)
          into v_parent_column_type
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = v_table
           and a.attname = v_parent_column
           and a.attnum > 0
           and not a.attisdropped;

        if v_strategy = 'soft' then
          execute pg_catalog.format(
            'update public.%I child set deleted_at = $2 '
            'from pg_temp.ops_company_purge_scope parent_scope '
            'where parent_scope.table_name = $1 '
            '  and child.%I = parent_scope.row_id::%s '
            '  and child.deleted_at is null',
            v_table,
            v_parent_column,
            v_parent_column_type
          ) using v_parent_table, v_deleted_at;
        else
          execute pg_catalog.format(
            'delete from public.%I child '
            'using pg_temp.ops_company_purge_scope parent_scope '
            'where parent_scope.table_name = $1 '
            '  and child.%I = parent_scope.row_id::%s',
            v_table,
            v_parent_column,
            v_parent_column_type
          ) using v_parent_table;
        end if;
        get diagnostics v_deleted = row_count;
      end if;
    exception when others then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint;

      raise exception using
        errcode = v_error_state,
        message = pg_catalog.format(
          'purge_company_data: step %s/%s (%s %s) failed: %s',
          v_index,
          v_total,
          case when v_strategy = 'soft' then 'soft-delete' else 'purge' end,
          v_table,
          v_error_message
        ),
        detail = pg_catalog.concat_ws(
          ' ',
          nullif(v_error_detail, ''),
          nullif(v_error_hint, ''),
          'The transaction was rolled back.'
        );
    end;

    v_deleted_counts := v_deleted_counts ||
      pg_catalog.jsonb_build_object(v_table, v_deleted);
  end loop;

  return pg_catalog.jsonb_build_object(
    'manifest_version', v_manifest_version,
    'deleted_counts', v_deleted_counts,
    'completed_steps', v_total,
    'total_steps', v_total
  );
end;
$$;

revoke all on function public.purge_company_data(uuid, jsonb) from public;
revoke all on function public.purge_company_data(uuid, jsonb) from anon;
revoke all on function public.purge_company_data(uuid, jsonb) from authenticated;
grant execute on function public.purge_company_data(uuid, jsonb) to service_role;

comment on function public.purge_company_data(uuid, jsonb) is
  'Executes the manifest-driven account-deletion plan in one transaction and returns committed per-table row counts. Any failed step rolls the entire invocation back.';

commit;
