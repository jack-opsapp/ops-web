-- Lead Lifecycle CW1 — trigger-function search_path hardening.
--
-- Resolves the `function_search_path_mutable` security advisor (lint 0011) for
-- the two CW1 blank-provider rewrite trigger functions introduced in
-- 20260529120000_lead_lifecycle_p5_blank_provider_rewrite_trigger.sql:
--   - public.email_threads_rewrite_blank_provider()
--   - public.opportunity_email_threads_rewrite_blank_thread()
--
-- Both functions are flagged because they carry a role-mutable search_path. This
-- migration CREATE OR REPLACEs each with `set search_path = ''` pinned on the
-- function. The bodies reference ONLY built-in functions (btrim, coalesce) and
-- the trigger NEW record — no schema-qualified objects, no table/sequence/type
-- lookups — so an empty search_path resolves everything safely and changes no
-- behavior. The triggers themselves are untouched (the function bodies are
-- byte-for-byte identical to the originals apart from the added SET clause).
--
-- Additive + idempotent: CREATE OR REPLACE leaves the existing triggers bound to
-- the same function names; re-running is a no-op. iOS-safe — no schema/constraint
-- change, the functions still NEVER raise or reject (they only rewrite a blank
-- provider id in place to a deterministic `legacy:<uuid>`).
--
-- NOTE: This migration is written but intentionally NOT applied by the authoring
-- session. Apply it as part of the normal coordinated lead-lifecycle release.

create or replace function public.email_threads_rewrite_blank_provider()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Defensive: NOT NULL is already enforced, so this guards the empty-string
  -- and all-whitespace cases. coalesce keeps the predicate null-safe.
  if btrim(coalesce(new.provider_thread_id, '')) = '' then
    new.provider_thread_id := 'legacy:' || new.id::text;
  end if;
  return new;
end;
$$;

create or replace function public.opportunity_email_threads_rewrite_blank_thread()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if btrim(coalesce(new.thread_id, '')) = '' then
    new.thread_id := 'legacy:' || new.id::text;
  end if;
  return new;
end;
$$;
