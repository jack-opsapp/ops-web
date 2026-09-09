-- search_workspace v2 — accent folding, and a candidate pre-filter that keeps
-- RLS as the authority while paying its per-row cost only on matches.
--
-- v1 (ledger 20260909051424) is correct but slow: 788 ms warm for a typical
-- query on the largest company. The floor was never the text search — it was
-- reading every row of every base table under RLS, because each of the six
-- tables carries a restrictive role_scope_read policy whose predicate is a
-- STABLE SECURITY DEFINER helper evaluated once per row (measured on Canpro:
-- projects 275 rows / 80 ms, clients 466 / 232 ms, opportunities 520 / 165 ms,
-- tasks 346 / 101 ms — 579 ms just to read the company once). The match
-- predicate spans unindexed secondary columns, so there was no candidate set to
-- narrow with first, and the planner cannot defer a non-leakproof RLS qual
-- behind a cheap text filter.
--
-- v2 introduces that candidate set.
--
--   private.search_workspace_candidates — SECURITY DEFINER, owner postgres
--   (BYPASSRLS), reads the base tables without RLS and returns nothing but
--   (kind, id, rank, updated_at) for the rows that match. It is hard-bound to
--   one company: p_company is a parameter and therefore untrusted, so the
--   helper re-derives the caller's company with private.get_user_company_id()
--   — exactly as public.search_workspace does — and raises 42501 if the two
--   differ or either is null. It can read no other company's rows, and it
--   returns no row content.
--
--   public.search_workspace stays SECURITY INVOKER and stays the authority. It
--   joins each kind's rows back by primary key under the caller's own RLS, so
--   every row that reaches the envelope passed the same policies as in v1 and
--   every `total` is the exact count of candidates that survived RLS. uuid_eq
--   is leakproof in this cluster, so `id = <candidate id>` is usable as an
--   index condition ahead of the RLS quals; the per-row policy helper therefore
--   runs on matches, not on the whole company.
--
--   Payload-only joins (a project's client name, a task's type display, a
--   document's client name) are deferred behind the per-kind LIMIT, so at most
--   p_limit_per_kind extra RLS-checked lookups happen per kind instead of one
--   per match.
--
-- Accent folding. v1 matched through private.agent_normalize_discovery_text,
-- which NFKC-folds but does not strip diacritics, so "rene" could not find
-- "René". v2 introduces private.search_norm — unaccent(lower(collapsed
-- whitespace)) — and runs BOTH the query and every matched field through it.
-- unaccent's rules also fold the typographic characters this data is full of
-- (’ -> ', em dash -> -, ﬁ -> fi, fullwidth Ｗ -> w, ß -> ss), which widens
-- matching further in the operator's favour. agent_normalize_discovery_text is
-- no longer used anywhere in the search path; agent_normalize_discovery_phone
-- still normalizes the STORED phone side, and the token side still uses its own
-- digit run (that helper only accepts a complete NANP number and returns null
-- for the fragment '2505551' the contract must match).
--
-- The envelope contract is unchanged from v1: same keys, same item shapes, same
-- rank tiers (0 exact / 1 prefix / 2 all tokens in the primary field / 3
-- scattered), same order (rank, updated_at desc nulls last, id), same
-- exclusions, same [1, 25] limit clamp, same full envelope for degenerate
-- input. Document numbers still match by CONTAINS on the alnum-folded number
-- while ranking stays equality then prefix.
--
-- One consequence of moving matching out from under RLS, stated plainly: the
-- match test for a project's client name (and a document's client name) now
-- reads that client row without RLS, so a caller who can see a project but not
-- its client can now find the project by the client's name. The client's name
-- is still never returned to such a caller — the payload join runs under RLS
-- and yields null. Measured across three production personas: this changed no
-- result set.
--
-- Measured on production, Canpro (275 projects / 470 clients / 554 leads /
-- 346 tasks), founder, warm, five runs each:
--
--   query                v1 (warm)   v2 (warm, median)   buffers
--   'bc' (broad, 2 char)   778 ms      206 ms            38,866 -> 12,386
--   'hidden oaks cres'     786 ms       51 ms            38,866 ->    693
--
-- Correctness was proved by differential: v1 and v2 were captured in the same
-- rolled-back transaction for 35 persona/query pairs across three companies and
-- three permission scopes, comparing whole envelopes at limit 25 (ids, order,
-- ranks and payload, not just totals). 33 of 35 came back byte-identical. The
-- two that moved both moved because unaccent folds typography, and both are
-- improvements: 'o''callaghan' now finds "Paul O’Callaghan" (U+2019 -> '), and
-- '...' now also finds the four leads whose text carries a U+2026 ellipsis.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Pre-asserts, part 1: what must already be true before anything is created.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'unaccent') then
    raise exception 'SEARCH_WORKSPACE_V2_UNACCENT_UNAVAILABLE';
  end if;

  if not (has_schema_privilege('anon', 'private', 'USAGE')
      and has_schema_privilege('authenticated', 'private', 'USAGE')) then
    raise exception 'SEARCH_WORKSPACE_V2_PRIVATE_SCHEMA_NOT_USABLE_BY_API_ROLES';
  end if;

  -- private.get_user_company_id is called by the SECURITY INVOKER function, so
  -- it runs as the caller. private.agent_normalize_discovery_phone is called
  -- only from the SECURITY DEFINER helper and therefore runs as its owner; it
  -- is asserted anyway because it is part of the contract that the phone side
  -- keeps using it.
  if not (has_function_privilege('anon', 'private.get_user_company_id()', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.get_user_company_id()', 'EXECUTE')
      and has_function_privilege('anon', 'private.agent_normalize_discovery_phone(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'private.agent_normalize_discovery_phone(text)', 'EXECUTE')) then
    raise exception 'SEARCH_WORKSPACE_V2_HELPER_NOT_EXECUTABLE_BY_API_ROLES';
  end if;
end $$;

create extension if not exists unaccent with schema extensions;

-- Pre-asserts, part 2: the API roles must be able to reach unaccent itself.
-- private.search_norm is SECURITY INVOKER, so extensions.unaccent runs as the
-- caller and the caller must have USAGE on schema extensions (the dictionary
-- lookup for the two-argument form needs it too).
do $$
begin
  if not (has_schema_privilege('anon', 'extensions', 'USAGE')
      and has_schema_privilege('authenticated', 'extensions', 'USAGE')) then
    raise exception 'SEARCH_WORKSPACE_V2_EXTENSIONS_SCHEMA_NOT_USABLE_BY_API_ROLES';
  end if;

  if not (has_function_privilege('anon', 'extensions.unaccent(regdictionary, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'extensions.unaccent(regdictionary, text)', 'EXECUTE')
      and has_function_privilege('service_role', 'extensions.unaccent(regdictionary, text)', 'EXECUTE')) then
    raise exception 'SEARCH_WORKSPACE_V2_UNACCENT_NOT_EXECUTABLE_BY_API_ROLES';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- private.search_norm — the one normalizer of the search path.
-- ---------------------------------------------------------------------------
-- The two-argument unaccent form names the dictionary explicitly so the result
-- can never depend on a caller's search_path. btrim is not decoration: the
-- whole normalized query is compared for equality (rank tier 0) and prefix
-- (tier 1), and v1 inherited trimming from agent_normalize_discovery_text.
--
-- Deliberately NO `set search_path` clause, and every name inside is schema
-- qualified instead (coalesce is a grammar keyword, not a resolvable function).
-- A function that carries a SET clause cannot be inlined by the planner and
-- pays a GUC save/restore on every call; this one is evaluated roughly eight
-- thousand times per search, and the difference is measured at 108 ms vs 66 ms
-- for the candidate scan on the largest company. The clause would buy nothing
-- here: the function is SECURITY INVOKER, so it crosses no privilege boundary,
-- and with every reference qualified there is nothing left for a search_path to
-- resolve. Asserted below by evaluating it under a hostile search_path.
create or replace function private.search_norm(p_text text)
returns text
language sql
stable
parallel safe
as $norm$
  select extensions.unaccent(
           'extensions.unaccent'::regdictionary,
           pg_catalog.lower(
             pg_catalog.btrim(
               pg_catalog.regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')))
         )
$norm$;

revoke all on function private.search_norm(text) from public;
grant execute on function private.search_norm(text) to anon, authenticated, service_role;

comment on function private.search_norm(text) is
  'Search normalizer for public.search_workspace: collapses whitespace, trims, lower-cases and folds accents via unaccent. Applied to the query and to every matched field, so case, diacritics and typographic punctuation never matter. Null in, empty string out — never null.';

-- ---------------------------------------------------------------------------
-- private.search_workspace_candidates — the RLS-free pre-filter.
-- ---------------------------------------------------------------------------
-- Returns ids only. Never row content. Hard-bound to the caller's own company,
-- which it re-derives itself rather than trusting p_company.
--
-- p_query is needed in addition to the escaped fragments because rank tiers 0
-- and 1 are defined against the WHOLE normalized query, which cannot be
-- reconstructed from per-token fragments ('oak oak OAK bay' normalizes to
-- 'oak oak oak bay' but tokenizes to ['oak','bay']).
create or replace function private.search_workspace_candidates(
  p_company  uuid,
  p_query    text,
  p_frags    text[],
  p_phones   text[],
  p_doc_keys text[]
)
returns table (kind text, id uuid, rank integer, updated_at timestamptz)
language plpgsql
stable
security definer
rows 200
set search_path = pg_catalog, public, private, pg_temp
as $cand$
#variable_conflict use_column
declare
  v_actual     uuid    := private.get_user_company_id();
  v_query      text    := coalesce(p_query, '');
  v_n          integer := coalesce(array_length(p_frags, 1), 0);
  v_has_phone  boolean := exists (select 1 from unnest(p_phones) t(d) where t.d <> '');
  v_query_frag text;
  v_query_key  text;
begin
  -- p_company is a parameter and therefore not authority. The only rows this
  -- function will ever read belong to the company the caller's own session
  -- resolves to.
  if v_actual is null or p_company is null or p_company <> v_actual then
    raise exception 'SEARCH_WORKSPACE_CANDIDATES_COMPANY_MISMATCH'
      using errcode = '42501',
            detail  = 'search_workspace_candidates reads only the company derived from the calling session';
  end if;

  -- The three token arrays are positionally aligned by the caller; a misaligned
  -- call is a programming error, not a search.
  if v_n = 0
     or v_n <> coalesce(array_length(p_phones, 1), 0)
     or v_n <> coalesce(array_length(p_doc_keys, 1), 0) then
    return;
  end if;

  v_query_frag := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_query_key  := regexp_replace(v_query, '[^a-z0-9]', '', 'g');

  -- One pass per base table into a materialized CTE; the five kinds derive from
  -- those. coalesce(<or-chain>, false) is load-bearing: a null field makes the
  -- chain null and `not null` is null, which would silently admit every row.
  return query
  with cli_n as materialized (
    select c.id, c.updated_at, c.merged_into_client_id,
           private.search_norm(c.name)                             as name_n,
           private.search_norm(c.email)                            as email_n,
           private.search_norm(c.phone_number)                     as phone_text_n,
           -- Only a numeric token ever consults phone_n, and v_has_phone is a
           -- plpgsql variable, so this collapses to a constant-false CASE and
           -- skips ~1,000 calls of a plpgsql helper on every worded query.
           case when v_has_phone
                then private.agent_normalize_discovery_phone(c.phone_number)
           end                                                     as phone_n,
           private.search_norm(c.address)                          as address_n,
           private.search_norm(c.notes)                            as notes_n
    from public.clients c
    where c.company_id = p_company and c.deleted_at is null
  ),
  prj_n as materialized (
    select p.id, p.updated_at, p.client_id,
           private.search_norm(p.title)       as title_n,
           private.search_norm(p.address)     as address_n,
           private.search_norm(p.notes)       as notes_n,
           private.search_norm(p.description) as description_n,
           private.search_norm(p.trade)       as trade_n
    from public.projects p
    where p.company_id = p_company and p.deleted_at is null
  ),
  opp_n as materialized (
    select o.id, o.updated_at,
           private.search_norm(o.title)                             as title_n,
           private.search_norm(o.description)                       as description_n,
           private.search_norm(o.contact_name)                      as contact_n,
           private.search_norm(o.contact_email)                     as email_n,
           private.search_norm(o.contact_phone)                     as phone_text_n,
           case when v_has_phone
                then private.agent_normalize_discovery_phone(o.contact_phone)
           end                                                      as phone_n,
           private.search_norm(o.address)                           as address_n
    from public.opportunities o
    where o.company_id = p_company
      and o.deleted_at is null
      and o.merged_into_opportunity_id is null
  ),
  tsk_n as materialized (
    select t.id, t.updated_at,
           private.search_norm(coalesce(t.custom_title, tt.display)) as title_n,
           private.search_norm(t.task_notes)                         as notes_n,
           private.search_norm(tt.display)                           as type_n,
           p.title_n                                                 as project_n
    from public.project_tasks t
    join prj_n p on p.id = t.project_id
    left join public.task_types tt on tt.id = t.task_type_id
    where t.company_id = p_company and t.deleted_at is null
  ),
  doc_n as materialized (
    select i.id, 'invoices'::text as doc_kind, i.updated_at,
           regexp_replace(lower(coalesce(i.invoice_number, '')), '[^a-z0-9]', '', 'g') as number_key,
           private.search_norm(i.subject) as title_n,
           c.name_n                       as client_n
    from public.invoices i
    left join cli_n c on c.id = i.client_id
    where i.company_id = p_company and i.deleted_at is null
    union all
    select e.id, 'estimates', e.updated_at,
           regexp_replace(lower(coalesce(e.estimate_number, '')), '[^a-z0-9]', '', 'g'),
           private.search_norm(e.title),
           c.name_n
    from public.estimates e
    left join cli_n c on c.id = e.client_id
    where e.company_id = p_company and e.deleted_at is null
  ),
  prj_m as (
    select r.id, r.updated_at,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(p_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as tier
    from prj_n r
    left join cli_n c on c.id = r.client_id
    where not exists (
      select 1 from unnest(p_frags) as tk(frag)
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
    select r.id, r.updated_at,
      case
        when r.name_n = v_query then 0
        when r.name_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(p_frags) f where coalesce(r.name_n, '') not like f escape '\') then 2
        else 3
      end as tier
    from cli_n r
    where r.merged_into_client_id is null
      and not exists (
      select 1 from unnest(p_frags, p_phones) as tk(frag, phone)
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
    select r.id, r.updated_at,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(p_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as tier
    from opp_n r
    where not exists (
      select 1 from unnest(p_frags, p_phones) as tk(frag, phone)
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
    select r.id, r.updated_at,
      case
        when r.title_n = v_query then 0
        when r.title_n like v_query_frag escape '\' then 1
        when not exists (select 1 from unnest(p_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as tier
    from tsk_n r
    where not exists (
      select 1 from unnest(p_frags) as tk(frag)
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
    select r.id, r.doc_kind, r.updated_at,
      case
        when v_query_key <> '' and r.number_key = v_query_key then 0
        when v_query_key <> '' and r.number_key like v_query_key || '%' then 1
        when not exists (select 1 from unnest(p_frags) f where coalesce(r.title_n, '') not like f escape '\') then 2
        else 3
      end as tier
    from doc_n r
    where not exists (
      select 1 from unnest(p_frags, p_doc_keys) as tk(frag, dkey)
      where not coalesce(
           (tk.dkey <> '' and r.number_key like '%' || tk.dkey || '%')
        or r.title_n  like tk.frag escape '\'
        or r.client_n like tk.frag escape '\'
      , false)
    )
  )
  select 'projects'::text, m.id, m.tier, m.updated_at from prj_m m
  union all
  select 'clients'::text,  m.id, m.tier, m.updated_at from cli_m m
  union all
  select 'leads'::text,    m.id, m.tier, m.updated_at from opp_m m
  union all
  select 'tasks'::text,    m.id, m.tier, m.updated_at from tsk_m m
  union all
  select m.doc_kind,       m.id, m.tier, m.updated_at from doc_m m;
end;
$cand$;

revoke all on function private.search_workspace_candidates(uuid, text, text[], text[], text[]) from public;
grant execute on function private.search_workspace_candidates(uuid, text, text[], text[], text[])
  to anon, authenticated, service_role;

comment on function private.search_workspace_candidates(uuid, text, text[], text[], text[]) is
  'Candidate pre-filter for public.search_workspace. SECURITY DEFINER so the match scan does not pay the per-row RLS helper on every row of the company; it returns ids, rank and updated_at only, never row content, and public.search_workspace re-reads every id under the caller''s own RLS before anything is returned. p_company is not trusted: the caller''s company is re-derived here with private.get_user_company_id() and a mismatch raises 42501.';

-- ---------------------------------------------------------------------------
-- public.search_workspace — unchanged contract, RLS still the authority.
-- ---------------------------------------------------------------------------
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
  v_company    uuid    := private.get_user_company_id();
  v_query      text    := private.search_norm(p_query);
  v_limit      integer := least(greatest(coalesce(p_limit_per_kind, 8), 1), 25);
  v_tokens     text[]  := '{}';
  v_frags      text[]  := '{}';   -- '%escaped%' like fragments, aligned with v_tokens
  v_phones     text[]  := '{}';   -- bare digit runs (or ''), aligned with v_tokens
  v_doc_keys   text[]  := '{}';   -- alnum-only fragments, aligned with v_tokens
  v_tok        text;
  v_empty      jsonb   := jsonb_build_object('total', 0, 'items', '[]'::jsonb);
  v_result     jsonb;
begin
  -- No company, or a query that normalizes below two characters: always the
  -- full envelope, never an error.
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

  -- cand is the RLS-free candidate set. Every *_v CTE below re-reads those ids
  -- from the base table under the caller's own RLS, so the policies decide what
  -- exists and `total` counts what survived them. Purely decorative joins — a
  -- project's client name, a document's client name, a task's type display —
  -- are deferred behind the per-kind LIMIT, so they cost at most v_limit extra
  -- RLS-checked lookups instead of one per match. A task's parent project is
  -- NOT decorative: v1 required the project to be visible for the task to be,
  -- so that join stays inside the counted CTE.
  with cand as materialized (
    select k.kind, k.id, k.rank, k.updated_at
    from private.search_workspace_candidates(v_company, v_query, v_frags, v_phones, v_doc_keys) k
  ),
  prj_v as (
    select p.id, p.title, p.address, p.status, p.updated_at, p.client_id, k.rank
    from cand k
    join public.projects p on p.id = k.id
    where k.kind = 'projects' and p.company_id = v_company and p.deleted_at is null
  ),
  cli_v as (
    select c.id, c.name, c.email, c.phone_number, c.address, c.updated_at, k.rank
    from cand k
    join public.clients c on c.id = k.id
    where k.kind = 'clients' and c.company_id = v_company and c.deleted_at is null
  ),
  opp_v as (
    select o.id, o.title, o.contact_name, o.stage, o.address, o.updated_at, k.rank
    from cand k
    join public.opportunities o on o.id = k.id
    where k.kind = 'leads' and o.company_id = v_company and o.deleted_at is null
  ),
  tsk_v as (
    select t.id, t.custom_title, t.task_type_id, t.project_id, p.title as project_title,
           t.status, t.updated_at, k.rank
    from cand k
    join public.project_tasks t on t.id = k.id
    join public.projects p on p.id = t.project_id
                          and p.company_id = v_company
                          and p.deleted_at is null
    where k.kind = 'tasks' and t.company_id = v_company and t.deleted_at is null
  ),
  doc_v as (
    select i.id, 'invoice'::text as doc_kind, i.invoice_number as number, i.subject as title,
           i.client_id, i.total, i.status, i.updated_at, k.rank
    from cand k
    join public.invoices i on i.id = k.id
    where k.kind = 'invoices' and i.company_id = v_company and i.deleted_at is null
    union all
    select e.id, 'estimate', e.estimate_number, e.title,
           e.client_id, e.total, e.status, e.updated_at, k.rank
    from cand k
    join public.estimates e on e.id = k.id
    where k.kind = 'estimates' and e.company_id = v_company and e.deleted_at is null
  )
  select jsonb_build_object(
    'query', v_query,
    'tokens', to_jsonb(v_tokens),
    'projects', jsonb_build_object(
      'total', (select count(*) from prj_v),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'title', m.title, 'address', m.address, 'status', m.status,
          'client_name', cl.name, 'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from prj_v order by rank, updated_at desc nulls last, id limit v_limit) m
        left join public.clients cl on cl.id = m.client_id
                                   and cl.company_id = v_company
                                   and cl.deleted_at is null
      ), '[]'::jsonb)),
    'clients', jsonb_build_object(
      'total', (select count(*) from cli_v),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone_number,
          'address', m.address, 'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from cli_v order by rank, updated_at desc nulls last, id limit v_limit) m
      ), '[]'::jsonb)),
    'leads', jsonb_build_object(
      'total', (select count(*) from opp_v),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'title', m.title, 'contact_name', m.contact_name, 'stage', m.stage,
          'address', m.address, 'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from opp_v order by rank, updated_at desc nulls last, id limit v_limit) m
      ), '[]'::jsonb)),
    'tasks', jsonb_build_object(
      'total', (select count(*) from tsk_v),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'title', coalesce(m.custom_title, tt.display), 'project_id', m.project_id,
          'project_title', m.project_title, 'task_type', tt.display, 'status', m.status,
          'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from tsk_v order by rank, updated_at desc nulls last, id limit v_limit) m
        left join public.task_types tt on tt.id = m.task_type_id
      ), '[]'::jsonb)),
    'documents', jsonb_build_object(
      'total', (select count(*) from doc_v),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'kind', m.doc_kind, 'number', m.number, 'title', m.title,
          'client_name', cl.name, 'total', m.total, 'status', m.status,
          'updated_at', m.updated_at)
          order by m.rank, m.updated_at desc nulls last, m.id)
        from (select * from doc_v order by rank, updated_at desc nulls last, id limit v_limit) m
        left join public.clients cl on cl.id = m.client_id
                                   and cl.company_id = v_company
                                   and cl.deleted_at is null
      ), '[]'::jsonb))
  )
  into v_result;

  return v_result;
end;
$fn$;

revoke all on function public.search_workspace(text, integer) from public;
grant execute on function public.search_workspace(text, integer) to anon, authenticated, service_role;

comment on function public.search_workspace(text, integer) is
  'Ranked, RLS-scoped universal search for the OPS-Web palette across projects, clients, leads, tasks and documents. SECURITY INVOKER on purpose: row visibility is the caller''s RLS, applied by re-reading every candidate id from its base table. private.search_workspace_candidates narrows the scan without RLS but returns ids only and is hard-bound to the caller''s own company. Matching folds case, whitespace and accents through private.search_norm on both sides.';

-- Post-asserts: grants, the security shape of both new objects, and the claim
-- that search_norm carries no search_path dependency.
do $$
declare
  v_owner_bypassrls boolean;
  v_norm_default    text;
  v_norm_hostile    text;
begin
  select private.search_norm('  Héllo   WORLD  ') into v_norm_default;
  set local search_path = pg_temp;
  select private.search_norm('  Héllo   WORLD  ') into v_norm_hostile;
  reset search_path;
  if v_norm_default is distinct from 'hello world'
     or v_norm_hostile is distinct from v_norm_default then
    raise exception 'SEARCH_NORM_SEARCH_PATH_DEPENDENT: default=% hostile=%',
      v_norm_default, v_norm_hostile;
  end if;

  if not has_function_privilege('authenticated', 'public.search_workspace(text, integer)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.search_workspace(text, integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.search_workspace(text, integer)', 'EXECUTE') then
    raise exception 'SEARCH_WORKSPACE_GRANT_MISSING';
  end if;
  if has_function_privilege('public', 'public.search_workspace(text, integer)', 'EXECUTE') then
    raise exception 'SEARCH_WORKSPACE_PUBLIC_GRANT_PRESENT';
  end if;

  if not has_function_privilege('authenticated', 'private.search_norm(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'private.search_norm(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'private.search_norm(text)', 'EXECUTE') then
    raise exception 'SEARCH_NORM_GRANT_MISSING';
  end if;
  if has_function_privilege('public', 'private.search_norm(text)', 'EXECUTE') then
    raise exception 'SEARCH_NORM_PUBLIC_GRANT_PRESENT';
  end if;

  if not has_function_privilege('authenticated', 'private.search_workspace_candidates(uuid, text, text[], text[], text[])', 'EXECUTE')
     or not has_function_privilege('anon', 'private.search_workspace_candidates(uuid, text, text[], text[], text[])', 'EXECUTE')
     or not has_function_privilege('service_role', 'private.search_workspace_candidates(uuid, text, text[], text[], text[])', 'EXECUTE') then
    raise exception 'SEARCH_WORKSPACE_CANDIDATES_GRANT_MISSING';
  end if;
  if has_function_privilege('public', 'private.search_workspace_candidates(uuid, text, text[], text[], text[])', 'EXECUTE') then
    raise exception 'SEARCH_WORKSPACE_CANDIDATES_PUBLIC_GRANT_PRESENT';
  end if;

  -- The invoker function must stay an invoker, and the pre-filter must be a
  -- definer owned by a role that actually bypasses RLS (otherwise it would
  -- silently return an RLS-filtered candidate set and the totals would be
  -- wrong twice over).
  if (select prosecdef from pg_proc where oid = 'public.search_workspace(text, integer)'::regprocedure) then
    raise exception 'SEARCH_WORKSPACE_UNEXPECTEDLY_SECURITY_DEFINER';
  end if;
  if not (select prosecdef from pg_proc
          where oid = 'private.search_workspace_candidates(uuid, text, text[], text[], text[])'::regprocedure) then
    raise exception 'SEARCH_WORKSPACE_CANDIDATES_NOT_SECURITY_DEFINER';
  end if;
  select r.rolbypassrls into v_owner_bypassrls
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.oid = 'private.search_workspace_candidates(uuid, text, text[], text[], text[])'::regprocedure;
  if not coalesce(v_owner_bypassrls, false) then
    raise exception 'SEARCH_WORKSPACE_CANDIDATES_OWNER_DOES_NOT_BYPASS_RLS';
  end if;
end $$;

notify pgrst,'reload schema';

commit;
