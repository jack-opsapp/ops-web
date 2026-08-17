begin;

-- Replace the derived financial-memory projection in one transaction. A
-- weekly approval action may already be committed when this projection is
-- retried, so delete + insert must never expose a partially erased state.
create or replace function public.replace_financial_analysis_memories(
  p_company_id uuid,
  p_memories jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_inserted integer := 0;
begin
  if pg_catalog.coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_memories is null
     or pg_catalog.jsonb_typeof(p_memories) <> 'array'
     or pg_catalog.jsonb_array_length(p_memories) > 10 then
    raise exception 'financial memory replacement payload is invalid'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_memories) as memory(
      memory_type text,
      category text,
      content text,
      confidence double precision
    )
    where memory.memory_type <> 'fact'
       or memory.category not in ('pricing', 'seasonal_pattern')
       or pg_catalog.nullif(pg_catalog.btrim(memory.content), '') is null
       or pg_catalog.length(memory.content) > 2000
       or memory.confidence is null
       or memory.confidence < 0
       or memory.confidence > 1
  ) then
    raise exception 'financial memory replacement item is invalid'
      using errcode = '22023';
  end if;

  perform 1
  from public.companies as company
  where company.id = p_company_id
    and company.deleted_at is null
  for update;
  if not found then
    raise exception 'financial memory company is unavailable'
      using errcode = '23503';
  end if;

  delete from public.agent_memories as memory
  where memory.company_id = p_company_id
    and memory.source = 'financial_analysis';

  insert into public.agent_memories (
    company_id,
    memory_type,
    category,
    content,
    confidence,
    source
  )
  select
    p_company_id,
    memory.memory_type,
    memory.category,
    pg_catalog.btrim(memory.content),
    memory.confidence,
    'financial_analysis'
  from pg_catalog.jsonb_to_recordset(p_memories) as memory(
    memory_type text,
    category text,
    content text,
    confidence double precision
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$function$;

revoke all on function public.replace_financial_analysis_memories(
  uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_financial_analysis_memories(
  uuid, jsonb
) to service_role;

commit;
