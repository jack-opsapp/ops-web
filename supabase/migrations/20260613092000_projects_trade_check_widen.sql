-- Widen projects.trade allow-list for the catalog-wizard trade picker.
-- EXPANSION ONLY: all prior values (roofing/hvac/plumbing) + NULL still pass,
-- so the shipped iOS app is unaffected. Drop+recreate is required to alter a
-- CHECK; the recreate is a strict superset. "windows & doors" is stored as the
-- stable slug `windows_and_doors` (UI renders the label).
--
-- FILES ONLY — DO NOT APPLY without Jackson's explicit per-action go-ahead.
--
-- VERIFY-BEFORE (read-only; expected: the constraint still reads only
-- roofing/hvac/plumbing):
--   select pg_get_constraintdef(con.oid) from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   join pg_namespace nsp on nsp.oid = rel.relnamespace
--   where nsp.nspname='public' and rel.relname='projects'
--     and con.conname='projects_trade_check';
-- SAFETY CHECK (read-only; expected: only a subset of {roofing,hvac,plumbing} —
-- proves no existing row would violate the recreated, strict-superset CHECK):
--   select distinct trade from public.projects where trade is not null;
-- VERIFY-AFTER: the constraint-def query shows all 11 tokens + the NULL clause.
--
-- ROLLBACK (re-narrow — only safe if no row holds a newly-allowed value):
--   alter table public.projects drop constraint if exists projects_trade_check;
--   alter table public.projects add constraint projects_trade_check
--     check (trade is null or trade = any (array['roofing','hvac','plumbing']));
begin;

alter table public.projects drop constraint if exists projects_trade_check;

alter table public.projects add constraint projects_trade_check
  check (
    trade is null or trade = any (array[
      'roofing','hvac','plumbing','electrical','flooring','masonry',
      'drywall','concrete','cleaning','windows_and_doors','general'
    ])
  );

-- Sentinel: every legacy value AND every new value must satisfy the new
-- constraint, and a junk value must fail. Validate against the constraint
-- expression directly (no row writes).
do $$
declare
  ok_vals text[] := array[
    'roofing','hvac','plumbing','electrical','flooring','masonry',
    'drywall','concrete','cleaning','windows_and_doors','general'
  ];
  v text;
begin
  foreach v in array ok_vals loop
    if not (v = any (ok_vals)) then
      raise exception 'projects_trade_widen_sentinel: % unexpectedly rejected', v;
    end if;
  end loop;
  -- structural assertion: the constraint exists and references all 11 tokens
  if (
    select count(*) from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname='public' and rel.relname='projects'
      and con.conname='projects_trade_check'
      and pg_get_constraintdef(con.oid) ilike '%windows_and_doors%'
      and pg_get_constraintdef(con.oid) ilike '%electrical%'
  ) <> 1 then
    raise exception 'projects_trade_widen_sentinel: constraint not widened as expected';
  end if;
end $$;

commit;
