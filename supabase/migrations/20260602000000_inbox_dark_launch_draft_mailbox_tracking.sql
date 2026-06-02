-- Inbox dark-launch (T1): track the provider draft id when an AI draft is
-- placed in the user's Gmail/Outlook Drafts folder, so the push path (T3) can
-- update instead of duplicating, and the sync-based learning loop (T5) can
-- correlate the user's eventual sent reply back to the draft we generated.
--
-- Scope note (verified read-only against prod 2026-06-02): ai_draft_history
-- already carries created_at (the draft-placed anchor), sent_at, and a
-- free-text status whose values already encode provenance
-- (sent | sent_from_mailbox | superseded | discarded...). The originally
-- planned `final_source` and `mailbox_draft_created_at` columns are therefore
-- redundant and intentionally omitted (YAGNI). Only the genuinely-new
-- correlation key is added here.
--
-- Additive + nullable only → safe between iOS App Store releases. Rollback:
--   drop index if exists public.ai_draft_history_mailbox_pending_idx;
--   alter table public.ai_draft_history drop column if exists mailbox_draft_id;

alter table public.ai_draft_history
  add column if not exists mailbox_draft_id text;

comment on column public.ai_draft_history.mailbox_draft_id is
  'Provider draft id (Gmail draft id / M365 message id) when this AI draft was placed in the user mailbox Drafts folder. NULL = DB-only draft (never pushed to the mailbox).';

-- Supports the T3 idempotency lookup: find an unresolved mailbox draft for a
-- (connection, thread) so we update it rather than create a duplicate.
create index if not exists ai_draft_history_mailbox_pending_idx
  on public.ai_draft_history (connection_id, thread_id)
  where mailbox_draft_id is not null and status = 'auto_drafted';
