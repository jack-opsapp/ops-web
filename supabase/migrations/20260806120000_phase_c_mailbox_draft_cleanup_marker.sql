-- Phase C orphaned mailbox draft cleanup — settled marker.
--
-- When the operator lifts an AI draft's wording into a fresh compose and sends
-- that, the API draft object we placed survives the send. The history row goes
-- terminal, the per-thread reconciler stops looking at it, and the orphan sits
-- in the Drafts folder reading like an unsent reply — send it again and the
-- customer receives the same message twice (bug be648d50).
--
-- The terminal-orphan sweep in draft-reconciliation.ts closes that gap. This
-- column is its settled marker: the sweep stamps a row once the provider draft
-- object it names has been resolved for good — deleted by us, confirmed already
-- gone, or present with no admissible proof its wording was ever delivered (a
-- draft the operator simply ignored, which we must never delete). A terminal
-- row's verdict cannot change, so "leave this one alone" is as final as
-- "deleted", and either way the object never needs reading from the provider
-- again. Transient provider failures deliberately leave the row NULL so the
-- next sweep retries it.
--
-- Additive and nullable. iOS reads ai_draft_history without this column and is
-- unaffected. No data write: every existing row starts NULL, which is what
-- feeds the historical backlog through the sweep on the next syncs.
--
-- Rollback: drop the index, then the column.

alter table public.ai_draft_history
  add column if not exists mailbox_draft_cleanup_at timestamptz;

comment on column public.ai_draft_history.mailbox_draft_cleanup_at is
  'Set when the terminal-orphan sweep settled the provider draft named by mailbox_draft_id (deleted, already gone, or intentionally left in place). NULL means unresolved — the sweep will read it from the provider.';

-- Drives the sweep''s candidate query: one connection''s unsettled terminal
-- rows, newest first. Partial so it stays tiny — rows leave the index for good
-- the moment they are stamped.
create index if not exists ai_draft_history_mailbox_cleanup_pending_idx
  on public.ai_draft_history (connection_id, created_at desc)
  where mailbox_draft_id is not null
    and mailbox_draft_cleanup_at is null
    and status in ('sent_from_mailbox', 'superseded');
