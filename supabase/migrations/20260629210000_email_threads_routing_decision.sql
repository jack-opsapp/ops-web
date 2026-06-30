-- Phase 3 (Inbox Clean-State Layer): persist the deterministic router decision.
--
-- The conversation-state router already decides routing
-- ('draft' | 'update_lead_only' | 'require_human_review'), a 0..1 confidence, and
-- human-readable reasons per thread — but only the in-memory accept->stage and
-- autonomy gates read it. Persisting it lets the inbox SURFACE why a thread is
-- held for review (so a held thread is explainable), and lets cheap "show held
-- threads" queries run without rebuilding state.
--
-- Columns (all nullable; NULL = not yet evaluated, correct for every pre-Phase-3
-- row): routing, routing_reasons (the reason strings), router_confidence, and
-- router_computed_at (when the decision was last computed). A partial index keys
-- the held-threads query.
--
-- ADDITIVE / iOS-SAFE: four new nullable columns + one partial index on
-- email_threads. No changes to existing objects. iOS reads them as optional and
-- ignores them.
--
-- Rollback (sentinel):
--   drop index if exists email_threads_held_for_review_idx;
--   alter table public.email_threads drop column if exists router_computed_at;
--   alter table public.email_threads drop column if exists router_confidence;
--   alter table public.email_threads drop column if exists routing_reasons;
--   alter table public.email_threads drop column if exists routing;

alter table public.email_threads
  add column if not exists routing text
    check (routing in ('draft', 'update_lead_only', 'require_human_review')),
  add column if not exists routing_reasons text[],
  add column if not exists router_confidence numeric(3, 2),
  add column if not exists router_computed_at timestamptz;

create index if not exists email_threads_held_for_review_idx
  on public.email_threads (company_id)
  where routing = 'require_human_review';

comment on column public.email_threads.routing is
  'Deterministic conversation-state router decision (draft | update_lead_only | require_human_review). NULL = not yet evaluated. Phase 3, Inbox Clean-State Layer.';
comment on column public.email_threads.routing_reasons is
  'Human-readable reasons the router produced for this routing decision — surfaced in the inbox when a thread is held for review.';
comment on column public.email_threads.router_confidence is
  '0.00–1.00 deterministic confidence; below the 0.50 floor forces require_human_review.';
comment on column public.email_threads.router_computed_at is
  'When the routing decision was last computed (persisted at sync/draft time).';
