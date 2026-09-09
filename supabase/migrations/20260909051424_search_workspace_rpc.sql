-- Universal search for the OPS-Web command palette (⌘K).
--
-- The palette used to download every project, client, task and opportunity in
-- the company and substring-filter them in the browser (Canpro: 13 requests,
-- ~1,600 rows, 2.2 s). This function replaces that with one ranked, RLS-scoped
-- round trip across five kinds: projects, clients, leads (opportunities), tasks
-- and documents (invoices ∪ estimates).
--
-- SECURITY INVOKER on purpose: row visibility is the caller's own RLS
-- (company_isolation + the restrictive role_scope_read policies). The
-- company_id predicate inside each CTE is a planner hint, never the authority.
-- Because it runs as the caller, every function it names must be executable by
-- anon and authenticated (bible ch03 § execution grants) — asserted below.
-- private.agent_escape_like_literal and private.agent_discovery_prefix_upper_bound
-- are postgres-only and are deliberately NOT called; escaping is inline.
--
-- Matching reuses private.agent_normalize_discovery_text on both sides so case,
-- width and whitespace never matter. That normalizer lower-cases and NFKC-folds
-- but does NOT strip diacritics (unaccent is not installed in this project), so
-- "rene" does not find "René"; "RENÉ" does.
--
-- Exception, for a measured reason: the long free-text bodies (projects.notes,
-- projects.description, clients.notes, opportunities.description,
-- project_tasks.task_notes) are matched with lower(), not the normalizer.
-- agent_normalize_discovery_text validates its input one character at a time
-- (agent_discovery_unicode15_text_is_supported walks generate_series over every
-- character and tests it against a ~700-range multirange), which is fine for the
-- short identity fields the discovery indexes are built on and ruinous for a
-- 10 KB lead description: normalizing the leads CTE on Canpro cost 4,649 ms
-- against 257 ms with lower() — the same rows, an 18x difference. Every primary
-- (ranking) field and every field covered by a *_agent_discovery_*_trgm index
-- still uses the normalizer, so index-expression parity and the tier 0/1
-- semantics are unchanged; only secondary, match-only body text differs, where
-- NFKC folding buys nothing for a substring test.
--
-- Shape: every base table is read exactly ONCE into a materialized CTE and the
-- five kinds are derived from those. Row visibility is enforced by per-row
-- SECURITY DEFINER RLS helpers, which dominate the cost (measured on Canpro:
-- projects 275 rows / 80 ms, clients 466 / 232 ms, opportunities 520 / 165 ms,
-- tasks 346 / 101 ms — ~579 ms just to read the company once). Re-reading any
-- of those tables per kind multiplies that, so the single-pass shape is
-- load-bearing, not stylistic.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception 'SEARCH_WORKSPACE_PG_TRGM_MISSING';
  end if;

  if not (has_schema_privilege('anon', 'private', 'USAGE')
      and has_schema_privilege('authenticated', 'private', 'USAGE')) then
    raise exception 'SEARCH_WORKSPACE_PRIVATE_SCHEMA_NOT_USABLE_BY_API_ROLES';
  end if;

  -- Every helper reachable from the function body, including the two that
  -- agent_normalize_discovery_text calls internally (it is SECURITY INVOKER,
  -- so those run as the caller too).
  if not (has_function_privilege('anon', 'private.get_user_company_id()', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.get_user_company_id()', 'EXECUTE')
      and has_function_privilege('anon', 'private.agent_normalize_discovery_text(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.agent_normalize_discovery_text(text)', 'EXECUTE')
      and has_function_privilege('anon', 'private.agent_normalize_discovery_phone(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.agent_normalize_discovery_phone(text)', 'EXECUTE')
      and has_function_privilege('anon', 'private.agent_discovery_unicode15_text_is_supported(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.agent_discovery_unicode15_text_is_supported(text)', 'EXECUTE')
      and has_function_privilege('anon', 'private.agent_trim_discovery_display_text(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.agent_trim_discovery_display_text(text)', 'EXECUTE')) then
    raise exception 'SEARCH_WORKSPACE_HELPER_NOT_EXECUTABLE_BY_API_ROLES';
  end if;
end $$;

create or replace function public.search_workspace(
  p_query text,
  p_limit_per_kind integer default 8
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, private, pg_temp
as $fn$
declare
  v_company     uuid    := private.get_user_company_id();
  v_query       text    := private.agent_normalize_discovery_text(p_query);
  v_limit       integer := least(greatest(coalesce(p_limit_per_kind, 8), 1), 25);
  v_tokens      text[]  := '{}';
  v_frags       text[]  := '{}';   -- '%escaped%' like fragments, aligned with v_tokens
  v_phones      text[]  := '{}';   -- bare digit runs (or ''), aligned with v_tokens
  v_doc_keys    text[]  := '{}';   -- alnum-only fragments, aligned with v_tokens
  v_query_frag  text;
  v_query_key   text;
  v_tok         text;
  v_empty       jsonb   := jsonb_build_object('total', 0, 'items', '[]'::jsonb);
  v_result      jsonb;
begin
  -- No company, unusable input, or a query that normalizes below two
  -- characters: always the full envelope, never an error.
  if v_company is null or v_query is null or length(v_query) < 2 then
    return jsonb_build_object(
      'query', coalesce(v_query, ''), 'tokens', '[]'::jsonb,
      'projects', v_empty, 'clients', v_empty, 'leads', v_empty,
      'tasks', v_empty, 'documents', v_empty);
  end if;

  -- Tokenize: split, drop empties, de-duplicate preserving order, cap at 8.
  foreach v_tok in array regexp_split_to_array(v_query, '\s+') loop
    continue when v_tok = '' or v_tok = any(v_tokens);
    exit when coalesce(array_length(v_tokens, 1), 0) >= 8;
    v_tokens := v_tokens || v_tok;
    v_frags  := v_frags || ('%' || replace(replace(replace(v_tok, '\', '\\'), '%', '\%'), '_', '\_') || '%');
    -- A phone fragment is the token's own digit run, not
    -- agent_normalize_discovery_phone(token): that helper only accepts a
    -- complete NANP number and returns null for a fragment like '2505551',
    -- which the contract requires to match '(250) 555-1234'. The stored side
    -- still goes through the helper, so the fragment is matched against
    -- the canonical +1XXXXXXXXXX form.
    v_phones := v_phones || (case
                              when v_tok ~ '^[+0-9(). -]+$'
                               and length(regexp_replace(v_tok, '[^0-9]', '', 'g')) >= 3
                              then regexp_replace(v_tok, '[^0-9]', '', 'g')
                              else ''
                            end);
    v_doc_keys := v_doc_keys || regexp_replace(v_tok, '[^a-z0-9]', '', 'g');
  end loop;

  if coalesce(array_length(v_tokens, 1), 0) = 0 then
    return jsonb_build_object(
      'query', v_query, 'tokens', '[]'::jsonb,
      'projects', v_empty, 'clients', v_empty, 'leads', v_empty,
      'tasks', v_empty, 'documents', v_empty);
  end if;

  v_query_frag := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_query_key  := regexp_replace(v_query, '[^a-z0-9]', '', 'g');

  -- One statement, one pass per base table. The *_n CTEs are the visible rows
  -- with their searchable text normalized once; the *_m CTEs apply the
  -- all-tokens predicate and the rank tier.
  --
  -- coalesce(<or-chain>, false) is load-bearing: a null field makes the chain
  -- null and `not null` is null, which would silently admit every row.
  with cli_n as materialized (
    select c.id, c.name, c.email, c.phone_number, c.address, c.updated_at,
           c.merged_into_client_id,
           private.agent_normalize_discovery_text(c.name)          as name_n,
           private.agent_normalize_discovery_text(c.email)         as email_n,
           private.agent_normalize_discovery_text(c.phone_number)  as phone_text_n,
           private.agent_normalize_discovery_phone(c.phone_number) as phone_n,
           private.agent_normalize_discovery_text(c.address)       as address_n,
           lower(c.notes)                                          as notes_n
    from public.clients c
    where c.company_id = v_company and c.deleted_at is null
  ),
  prj_n as materialized (
    select p.id, p.title, p.address, p.status, p.updated_at, p.client_id,
           private.agent_normalize_discovery_text(p.title)       as title_n,
           private.agent_normalize_discovery_text(p.address)     as address_n,
           lower(p.notes)                                        as notes_n,
           lower(p.description)                                  as description_n,
           private.agent_normalize_discovery_text(p.trade)       as trade_n
    from public.projects p
    where p.company_id = v_company and p.deleted_at is null
  ),
  opp_n as materialized (
    select o.id, o.title, o.contact_name, o.stage, o.address, o.updated_at,
           private.agent_normalize_discovery_text(o.title)          as title_n,
           lower(o.description)                                     as description_n,
           private.agent_normalize_discovery_text(o.contact_name)   as contact_n,
           private.agent_normalize_discovery_text(o.contact_email)  as email_n,
           private.agent_normalize_discovery_text(o.contact_phone)  as phone_text_n,
           private.agent_normalize_discovery_phone(o.contact_phone) as phone_n,
           private.agent_normalize_discovery_text(o.address)        as address_n
    from public.opportunities o
    where o.company_id = v_company and o.deleted_at is null and o.merged_into_opportunity_id is null
  ),
  ttype_n as materialized (
    select tt.id, tt.display,
           private.agent_normalize_discovery_text(tt.display) as display_n
    from public.task_types tt
  ),
  tsk_n as materialized (
    select t.id, coalesce(t.custom_title, tt.display) as title, t.project_id,
           p.title as project_title, tt.display as task_type, t.status, t.updated_at,
           private.agent_normalize_discovery_text(coalesce(t.custom_title, tt.display)) as title_n,
           lower(t.task_notes) as notes_n,
           tt.display_n as type_n,
           p.title_n    as project_n
    from public.project_tasks t
    join prj_n p on p.id = t.project_id
    left join ttype_n tt on tt.id = t.task_type_id
    where t.company_id = v_company and t.deleted_at is null
  ),
  doc_n as materialized (
    select i.id, 'invoice'::text as kind, i.invoice_number as number, i.subject as title,
           c.name as client_name, i.total, i.status, i.updated_at,
           regexp_replace(lower(coalesce(i.invoice_number, '')), '[^a-z0-9]', '', 'g') as number_key,
           private.agent_normalize_discovery_text(i.subject) as title_n,
           c.name_n as client_n
    from public.invoices i
    left join cli_n c on c.id = i.client_id
    where i.company_id = v_company and i.deleted_at is null
    union all
    select e.id, 'estimate', e.estimate_number, e.title,
           c.name, e.total, e.status, e.updated_at,
           regexp_replace(lower(coalesce(e.estimate_number, '')), '[^a-z0-9]', '', 'g'),
           private.agent_normalize_discovery_text(e.title),
           c.name_n
    from public.estimates e
    left join cli_n c on c.id = e.client_id
    where e.company_id = v_company and e.deleted_at is null
  ),
  prj_m as (
    select r.id, r.title, r.address, r.status, r.updated_at, c.name as client_name,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(v_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as rank
    from prj_n r
    left join cli_n c on c.id = r.client_id
    where not exists (
      select 1 from unnest(v_frags) as tk(frag)
      where not coalesce(
           r.title_n       like tk.frag escape '\'
        or r.address_n     like tk.frag escape '\'
        or r.notes_n       like tk.frag escape '\'
        or r.description_n like tk.frag escape '\'
        or r.trade_n       like tk.frag escape '\'
        or c.name_n        like tk.frag escape '\'
      , false)
    )
  ),
  cli_m as (
    select r.id, r.name, r.email, r.phone_number, r.address, r.updated_at,
      case
        when r.name_n = v_query then 0
        when r.name_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(v_frags) f where coalesce(r.name_n, '') not like f escape '\') then 2
        else 3
      end as rank
    from cli_n r
    where r.merged_into_client_id is null
      and not exists (
      select 1 from unnest(v_frags, v_phones) as tk(frag, phone)
      where not coalesce(
           r.name_n       like tk.frag escape '\'
        or r.email_n      like tk.frag escape '\'
        or r.phone_text_n like tk.frag escape '\'
        or (tk.phone <> '' and r.phone_n like '%' || tk.phone || '%')
        or r.address_n    like tk.frag escape '\'
        or r.notes_n      like tk.frag escape '\'
      , false)
    )
  ),
  opp_m as (
    select r.id, r.title, r.contact_name, r.stage, r.address, r.updated_at,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(v_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as rank
    from opp_n r
    where not exists (
      select 1 from unnest(v_frags, v_phones) as tk(frag, phone)
      where not coalesce(
           r.title_n       like tk.frag escape '\'
        or r.description_n like tk.frag escape '\'
        or r.contact_n     like tk.frag escape '\'
        or r.email_n       like tk.frag escape '\'
        or r.phone_text_n  like tk.frag escape '\'
        or (tk.phone <> '' and r.phone_n like '%' || tk.phone || '%')
        or r.address_n     like tk.frag escape '\'
      , false)
    )
  ),
  tsk_m as (
    select r.id, r.title, r.project_id, r.project_title, r.task_type, r.status, r.updated_at,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(v_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as rank
    from tsk_n r
    where not exists (
      select 1 from unnest(v_frags) as tk(frag)
      where not coalesce(
           r.title_n   like tk.frag escape '\'
        or r.notes_n   like tk.frag escape '\'
        or r.type_n    like tk.frag escape '\'
        or r.project_n like tk.frag escape '\'
      , false)
    )
  ),
  -- The number predicate is a contains, not a prefix: the contract requires the
  -- numeric part alone ('104') to find 'INV-1042', and '104' is not a prefix of
  -- 'inv1042'. Ranking still uses equality/prefix, so 'inv104' outranks '104'.
  doc_m as (
    select r.id, r.kind, r.number, r.title, r.client_name, r.total, r.status, r.updated_at,
      case
        when v_query_key <> '' and r.number_key = v_query_key then 0
        when v_query_key <> '' and r.number_key like v_query_key || '%' then 1
        when not exists (select 1 from unnest(v_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as rank
    from doc_n r
    where not exists (
      select 1 from unnest(v_frags, v_doc_keys) as tk(frag, dkey)
      where not coalesce(
           (tk.dkey <> '' and r.number_key like '%' || tk.dkey || '%')
        or r.title_n  like tk.frag escape '\'
        or r.client_n like tk.frag escape '\'
      , false)
    )
  )
  select jsonb_build_object(
    'query', v_query,
    'tokens', to_jsonb(v_tokens),
    'projects', jsonb_build_object(
      'total', (select count(*) from prj_m),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'title', m.title, 'address', m.address, 'status', m.status,
          'client_name', m.client_name, 'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from prj_m order by rank, updated_at desc nulls last, id limit v_limit) m
      ), '[]'::jsonb)),
    'clients', jsonb_build_object(
      'total', (select count(*) from cli_m),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone_number,
          'address', m.address, 'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from cli_m order by rank, updated_at desc nulls last, id limit v_limit) m
      ), '[]'::jsonb)),
    'leads', jsonb_build_object(
      'total', (select count(*) from opp_m),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'title', m.title, 'contact_name', m.contact_name, 'stage', m.stage,
          'address', m.address, 'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from opp_m order by rank, updated_at desc nulls last, id limit v_limit) m
      ), '[]'::jsonb)),
    'tasks', jsonb_build_object(
      'total', (select count(*) from tsk_m),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'title', m.title, 'project_id', m.project_id, 'project_title', m.project_title,
          'task_type', m.task_type, 'status', m.status, 'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from tsk_m order by rank, updated_at desc nulls last, id limit v_limit) m
      ), '[]'::jsonb)),
    'documents', jsonb_build_object(
      'total', (select count(*) from doc_m),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'kind', m.kind, 'number', m.number, 'title', m.title,
          'client_name', m.client_name, 'total', m.total, 'status', m.status,
          'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from doc_m order by rank, updated_at desc nulls last, id limit v_limit) m
      ), '[]'::jsonb))
  )
  into v_result;

  return v_result;
end;
$fn$;

revoke all on function public.search_workspace(text, integer) from public;
grant execute on function public.search_workspace(text, integer) to anon, authenticated, service_role;

comment on function public.search_workspace(text, integer) is
  'Ranked, RLS-scoped universal search for the OPS-Web palette across projects, clients, leads, tasks and documents. SECURITY INVOKER on purpose: row visibility is the caller''s RLS. Every helper it calls is executable by anon/authenticated (asserted in the migration).';

do $$
begin
  if not has_function_privilege('authenticated', 'public.search_workspace(text, integer)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.search_workspace(text, integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.search_workspace(text, integer)', 'EXECUTE') then
    raise exception 'SEARCH_WORKSPACE_GRANT_MISSING';
  end if;
  if has_function_privilege('public', 'public.search_workspace(text, integer)', 'EXECUTE') then
    raise exception 'SEARCH_WORKSPACE_PUBLIC_GRANT_PRESENT';
  end if;
end $$;

notify pgrst,'reload schema';

commit;
