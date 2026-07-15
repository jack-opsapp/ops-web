begin;

-- Reconcile the original Phase C migration with the schema already proven in
-- production. This file deliberately runs before the outbound-learning queue,
-- whose apply RPC relies on these exact column types and conflict arbiters.

-- The production identity columns are text. Preserve every existing UUID value
-- byte-for-byte as text, dropping only foreign keys that cannot remain valid
-- across a UUID-to-text type change.
do $$
declare
  v_constraint record;
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.agent_memories'::regclass
      and a.attname = 'user_id'
      and not a.attisdropped
      and pg_catalog.format_type(a.atttypid, a.atttypmod) <> 'text'
  ) then
    for v_constraint in
      select c.conname
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.agent_memories'::regclass
        and c.contype = 'f'
        and exists (
          select 1
          from unnest(c.conkey::smallint[]) as key_column(attnum)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.conrelid
           and a.attnum = key_column.attnum
          where a.attname = 'user_id'
        )
    loop
      execute pg_catalog.format(
        'alter table public.agent_memories drop constraint %I',
        v_constraint.conname
      );
    end loop;

    alter table public.agent_memories
      alter column user_id type text
      using user_id::text;
  end if;
end
$$;

do $$
declare
  v_constraint record;
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.agent_writing_profiles'::regclass
      and a.attname = 'user_id'
      and not a.attisdropped
      and pg_catalog.format_type(a.atttypid, a.atttypmod) <> 'text'
  ) then
    for v_constraint in
      select c.conname
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.agent_writing_profiles'::regclass
        and c.contype = 'f'
        and exists (
          select 1
          from unnest(c.conkey::smallint[]) as key_column(attnum)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.conrelid
           and a.attnum = key_column.attnum
          where a.attname = 'user_id'
        )
    loop
      execute pg_catalog.format(
        'alter table public.agent_writing_profiles drop constraint %I',
        v_constraint.conname
      );
    end loop;

    alter table public.agent_writing_profiles
      alter column user_id type text
      using user_id::text;
  end if;
end
$$;

-- The baseline used halfvec while every writer and the live schema use
-- vector(1536). Rebuild the HNSW index with the matching vector opclass only
-- when a type conversion is actually required.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_type t
      on t.oid = a.atttypid
    where a.attrelid = 'public.agent_memories'::regclass
      and a.attname = 'embedding'
      and not a.attisdropped
      and not (t.typname = 'vector' and a.atttypmod = 1536)
  ) then
    drop index if exists public.idx_am_embedding;

    alter table public.agent_memories
      alter column embedding type vector(1536)
      using embedding::text::vector(1536);
  end if;
end
$$;

create index if not exists idx_am_embedding
  on public.agent_memories using hnsw (embedding vector_cosine_ops);

alter table public.agent_memories
  add column if not exists updated_at timestamptz not null default now();

-- ALTER COLUMN ... USING cannot contain the set-returning JSONB expansion
-- directly. This transaction-local helper is created and dropped in the same
-- transaction, so it is never visible after the migration commits.
create or replace function public._ops_reconcile_20260713204500_jsonb_text_array(
  value jsonb
)
returns text[]
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select case pg_catalog.jsonb_typeof(value)
    when 'array' then coalesce(
      array(select pg_catalog.jsonb_array_elements_text(value)),
      '{}'::text[]
    )
    when 'null' then '{}'::text[]
    else array[value #>> '{}']
  end
$$;

do $$
declare
  v_type text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into v_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.agent_writing_profiles'::regclass
    and a.attname = 'greeting_patterns'
    and not a.attisdropped;

  if v_type = 'jsonb' then
    alter table public.agent_writing_profiles
      alter column greeting_patterns drop default;
    alter table public.agent_writing_profiles
      alter column greeting_patterns type text[]
      using public._ops_reconcile_20260713204500_jsonb_text_array(greeting_patterns);
    alter table public.agent_writing_profiles
      alter column greeting_patterns set default '{}'::text[];
  elsif v_type is distinct from 'text[]' then
    raise exception
      'agent_writing_profiles.greeting_patterns has unsupported type %',
      coalesce(v_type, '<missing>');
  end if;
end
$$;

do $$
declare
  v_type text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into v_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.agent_writing_profiles'::regclass
    and a.attname = 'closing_patterns'
    and not a.attisdropped;

  if v_type = 'jsonb' then
    alter table public.agent_writing_profiles
      alter column closing_patterns drop default;
    alter table public.agent_writing_profiles
      alter column closing_patterns type text[]
      using public._ops_reconcile_20260713204500_jsonb_text_array(closing_patterns);
    alter table public.agent_writing_profiles
      alter column closing_patterns set default '{}'::text[];
  elsif v_type is distinct from 'text[]' then
    raise exception
      'agent_writing_profiles.closing_patterns has unsupported type %',
      coalesce(v_type, '<missing>');
  end if;
end
$$;

drop function public._ops_reconcile_20260713204500_jsonb_text_array(jsonb);

alter table public.agent_knowledge_graph
  add column if not exists updated_at timestamptz not null default now();

-- ON CONFLICT in Phase C names these six columns. Accept any already-valid,
-- non-partial unique index with the exact key set, regardless of name or order.
-- If legacy non-null duplicates exist, stop without deleting or merging data.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index i
    where i.indrelid = 'public.agent_knowledge_graph'::regclass
      and i.indisunique
      and i.indimmediate
      and i.indisvalid
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts = 6
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(i.indkey::smallint[]) with ordinality
          as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute a
          on a.attrelid = i.indrelid
         and a.attnum = key_column.attnum
        where key_column.ordinality <= i.indnkeyatts
      ) = array[
        'company_id',
        'object_id',
        'object_type',
        'predicate',
        'subject_id',
        'subject_type'
      ]
  ) then
    if exists (
      select 1
      from public.agent_knowledge_graph
      where company_id is not null
        and subject_type is not null
        and subject_id is not null
        and predicate is not null
        and object_type is not null
        and object_id is not null
      group by
        company_id,
        subject_type,
        subject_id,
        predicate,
        object_type,
        object_id
      having count(*) > 1
    ) then
      raise exception
        'Cannot add agent knowledge graph conflict arbiter: duplicate non-null subject/object edges exist'
        using hint = 'Reconcile the duplicate edges explicitly, then rerun this migration. No rows were deleted.';
    end if;

    alter table public.agent_knowledge_graph
      add constraint agent_knowledge_graph_subject_object_unique
      unique (
        company_id,
        subject_type,
        subject_id,
        predicate,
        object_type,
        object_id
      );
  end if;
end
$$;

-- Re-parse the retrieval function against vector(1536), then restore the
-- hardened search_path that the later security migration established.
create or replace function public.match_memories(
  query_embedding vector(1536),
  match_company_id uuid,
  match_threshold double precision default 0.3,
  match_count integer default 20
)
returns table (
  id uuid,
  memory_type text,
  category text,
  content text,
  confidence double precision,
  source text,
  decay_score double precision,
  entity_id uuid,
  access_count integer,
  similarity double precision
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  return query
  select
    am.id,
    am.memory_type,
    am.category,
    am.content,
    am.confidence,
    am.source,
    am.decay_score,
    am.entity_id,
    am.access_count,
    1 - (am.embedding <=> query_embedding) as similarity
  from public.agent_memories am
  where am.company_id = match_company_id
    and am.embedding is not null
    and am.decay_score > 0.1
    and 1 - (am.embedding <=> query_embedding) > match_threshold
  order by am.embedding <=> query_embedding
  limit match_count;
end;
$$;

alter function public.match_memories(vector, uuid, double precision, integer)
  set search_path = public, pg_temp;

commit;
