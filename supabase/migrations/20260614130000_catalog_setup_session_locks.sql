-- Catalog Setup Wizard — single-session-per-company lock (plan Task 6.3 / spec
-- §16 "only one setup session at a time per company").
--
-- APPLIED to prod (ijeekuhbatykdomumfjx) 2026-06-15 — Jackson chose "apply + turn
-- the lock on" (verified: 6 cols, RLS on, both authenticated + anon bridge
-- policies, anon/authenticated CRUD grants). The lock hook is now on by default.
-- Substrate rationale (neither existing table fits cleanly):
--   • wizard_states has session+heartbeat columns (current_session_id /
--     last_active_at) but is USER-scoped (no company_id) and its RLS is
--     auth.uid()-based, which throws under the OPS Firebase bridge; web can't
--     use it without an additive company_id column AND a bridge policy.
--   • catalog_setup_save_requests is company-scoped with a working anon Firebase
--     bridge policy, but it is a per-commit idempotency LEDGER (no session /
--     heartbeat columns, append-per-commit) — wrong shape for a liveness lock.
-- This dedicated table is the cleanest option: one mutable row per company
-- (company_id PK → natural mutual exclusion via upsert), the exact columns the
-- pure predicate needs (session_id + heartbeat_at), and the same Firebase-bridge
-- RLS the commit ledger already proves works for the anon web role. It is a NET-
-- NEW table → fully additive and App-Store-safe (iOS never reads it).
--
-- The SQL is idempotent (create-if-not-exists / drop-policy-if-exists), so a
-- future `supabase db push` re-apply is a safe no-op. Kill-switch: set
-- NEXT_PUBLIC_CATALOG_SETUP_LOCK_ENABLED="false" to disable the lock hook.

create table if not exists public.catalog_setup_session_locks (
  company_id   uuid primary key references public.companies(id) on delete cascade,
  session_id   text        not null,
  user_id      text,
  heartbeat_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.catalog_setup_session_locks is
  'Advisory single-session lock for the Catalog Setup Wizard — one row per company; '
  'heartbeat_at older than ~120s is treated as stale/released by the client predicate.';

alter table public.catalog_setup_session_locks enable row level security;

-- App-layer auth runs as the anon role bridged from Firebase; mirror the policy
-- pair that catalog_setup_save_requests already proves works for both roles. The
-- bridge-safe resolver private.get_user_company_id() scopes by JWT email, so it
-- never trips the auth.uid()::uuid cast that breaks under the Firebase bridge.
drop policy if exists "company_isolation" on public.catalog_setup_session_locks;
create policy "company_isolation"
  on public.catalog_setup_session_locks
  for all
  to authenticated
  using (company_id = (select private.get_user_company_id()))
  with check (company_id = (select private.get_user_company_id()));

drop policy if exists "firebase bridge catalog setup session locks company isolation"
  on public.catalog_setup_session_locks;
create policy "firebase bridge catalog setup session locks company isolation"
  on public.catalog_setup_session_locks
  for all
  to anon
  using (company_id = private.get_user_company_id())
  with check (company_id = private.get_user_company_id());

grant select, insert, update, delete
  on public.catalog_setup_session_locks
  to anon, authenticated;
