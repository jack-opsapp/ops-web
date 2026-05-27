-- SPEC Phase 1 — Stage F.2.b: Operator-only internal notes table.
--
-- Source spec: ops-software-bible/SPEC/05_ADMIN_UX.md § Tab 11 — Notes.
--   "Jackson's internal notes (textarea, autosave). Markdown supported.
--    Timestamped revisions visible."
--
-- Storage model: append-only revision log. Each save writes a new row; the UI
-- renders the latest body and exposes prior revisions on demand. This is
-- intentional — Phase 1 prioritizes traceability of what Jackson knew when,
-- over storage efficiency. The blob is small (operator alone writes it).
--
-- Visibility: operator-only via `private.is_spec_operator()`. Never exposed to
-- the customer side; not surfaced in the Phase 2 customer portal.
--
-- Mirrored in ops-software-bible/migrations/ for reference parity.

create table public.spec_internal_notes (
  id uuid primary key default gen_random_uuid(),
  spec_project_id uuid not null
    references public.spec_projects(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null
    references public.users(id) on delete set null,
  is_test boolean not null default false
);

create index spec_internal_notes_project_idx
  on public.spec_internal_notes (spec_project_id, created_at desc);

alter table public.spec_internal_notes enable row level security;

create policy "spec_internal_notes operator all"
  on public.spec_internal_notes
  for all
  using (private.is_spec_operator())
  with check (private.is_spec_operator());

-- service_role grants — every other write path is operator-gated via the
-- server action layer; this is for the worker/cron lane consistency with the
-- rest of the SPEC tables.
grant select, insert, update, delete on public.spec_internal_notes to service_role;
