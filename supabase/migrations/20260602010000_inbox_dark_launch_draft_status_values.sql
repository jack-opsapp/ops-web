-- Inbox dark-launch (T5 fix): the sync-based learning reconciliation
-- (reconcilePendingMailboxDrafts) writes two mailbox-provenance status values —
-- 'sent_from_mailbox' (user sent our draft from their mailbox) and
-- 'discarded_in_mailbox' (draft deleted, never sent) — that the existing
-- ai_draft_history_status_check did NOT allow. Without this, those status
-- transitions are rejected on prod and the learning loop silently stalls.
--
-- Additive: widens the allowed value set. All existing rows are 'drafted' and
-- remain valid. Pure DDL, no data write.
-- Rollback: re-add the constraint without the two mailbox values (no rows use
-- them yet).

alter table public.ai_draft_history
  drop constraint if exists ai_draft_history_status_check;

alter table public.ai_draft_history
  add constraint ai_draft_history_status_check
  check (status = any (array[
    'drafted', 'sent', 'discarded', 'auto_drafted', 'superseded',
    'sent_from_mailbox', 'discarded_in_mailbox'
  ]));
