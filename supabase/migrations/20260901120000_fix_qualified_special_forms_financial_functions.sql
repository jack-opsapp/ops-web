begin;

-- COALESCE and NULLIF are SQL parser special forms. Qualifying them under the
-- pg_catalog schema compiles at CREATE FUNCTION time but fails at runtime with
-- 42883 because no such pg_proc entries exist -- the parser never resolves a
-- special form through the catalog (bug f5ee8dc5: weekly financial digest;
-- the prose here deliberately avoids the qualified spelling so the
-- tests/unit/supabase/qualified-special-forms-guard.test.ts tripwire stays
-- strict over the whole file, comments included; same defect class in
-- merge_company_invoice_settings, which backs /api/settings/invoice and the
-- financial-intelligence settings write path — see bug 541e3dad interaction).
-- This forward migration re-creates both functions with the special forms
-- unqualified. All genuine pg_catalog functions keep their qualification.

-- 1) Weekly financial digest memory projection (SECURITY DEFINER).
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
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
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
       or nullif(pg_catalog.btrim(memory.content), '') is null
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

-- 2) Invoice-settings JSON merge (same defect class; called by
--    /api/settings/invoice and financial-intelligence settings writes).
--    Body matches the live definition except the three unqualified COALESCEs.
create or replace function public.merge_company_invoice_settings(
  p_company_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_settings jsonb;
begin
  if p_company_id is null then
    raise exception 'merge_company_invoice_settings: company_id is required';
  end if;

  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'merge_company_invoice_settings: patch must be a json object';
  end if;

  update public.companies
  set invoice_settings =
    coalesce(invoice_settings, '{}'::jsonb)
    || (p_patch - 'financial_intelligence')
    || case
      when p_patch ? 'financial_intelligence' then pg_catalog.jsonb_build_object(
        'financial_intelligence',
        coalesce(invoice_settings -> 'financial_intelligence', '{}'::jsonb)
        || coalesce(p_patch -> 'financial_intelligence', '{}'::jsonb)
      )
      else '{}'::jsonb
    end
  where id = p_company_id
  returning invoice_settings into v_settings;

  if not found then
    raise exception 'merge_company_invoice_settings: company not found';
  end if;

  return v_settings;
end;
$function$;

commit;
