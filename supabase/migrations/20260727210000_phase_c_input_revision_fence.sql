begin;

set local lock_timeout = '5s';

alter table public.catalog_guided_setup_sessions
  add column if not exists input_revision integer not null default 0,
  add column if not exists processed_input_revision integer not null default 0,
  add column if not exists input_ledger jsonb not null default '[]'::jsonb,
  add column if not exists capability_manifest_revision text not null
    default 'phase-c-capabilities/2026-07-27.1';

alter table public.catalog_guided_setup_sessions
  drop constraint if exists catalog_guided_setup_sessions_input_revisions_valid,
  drop constraint if exists catalog_guided_setup_sessions_input_ledger_shape,
  drop constraint if exists catalog_guided_setup_sessions_capability_revision_valid;

alter table public.catalog_guided_setup_sessions
  add constraint catalog_guided_setup_sessions_input_revisions_valid check (
    input_revision >= 0
    and processed_input_revision >= 0
    and processed_input_revision <= input_revision
  ),
  add constraint catalog_guided_setup_sessions_input_ledger_shape check (
    jsonb_typeof(input_ledger) = 'array'
    and jsonb_array_length(input_ledger) <= 200
  ),
  add constraint catalog_guided_setup_sessions_capability_revision_valid check (
    char_length(btrim(capability_manifest_revision)) between 1 and 128
  );

comment on column public.catalog_guided_setup_sessions.input_revision is
  'Monotonic operator-input revision. Increments for append, edit, and remove.';

comment on column public.catalog_guided_setup_sessions.processed_input_revision is
  'Newest input revision atomically accepted into Phase C facts and conversation state.';

comment on column public.catalog_guided_setup_sessions.input_ledger is
  'Bounded durable operator-input ledger. Superseded and removed entries remain audit state but are hidden from the normal transcript.';

comment on column public.catalog_guided_setup_sessions.capability_manifest_revision is
  'Build-owned Phase C capability contract used to fence generation, review, and commit.';

commit;
