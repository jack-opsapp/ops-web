begin;

set local lock_timeout = '5s';

alter table public.catalog_guided_setup_sessions
  add column if not exists conversation jsonb not null default '[]'::jsonb;

alter table public.catalog_guided_setup_sessions
  drop constraint if exists catalog_guided_setup_sessions_conversation_shape;

alter table public.catalog_guided_setup_sessions
  add constraint catalog_guided_setup_sessions_conversation_shape check (
    jsonb_typeof(conversation) = 'array'
    and jsonb_array_length(conversation) <= 200
  );

comment on column public.catalog_guided_setup_sessions.conversation is
  'Bounded operator-visible Phase C transcript. Updated atomically with the session version and interview state.';

commit;
