-- P0-B (Inbox Clean-State Layer): persist a clean email body at ingestion.
--
-- `body_text` stays the RAW provider body (verbatim, for audit). This new column
-- holds the quote- and signature-stripped clean body computed at the single
-- ingestion chokepoint (sync-engine.createActivity). The conversation-state
-- clean-state layer reads it as the provider-clean base before any AI runs.
--
-- ADDITIVE / iOS-SAFE: a new nullable column with no default — a metadata-only
-- change in Postgres (no table rewrite, no data lock). Existing reads/writes are
-- unaffected; the iOS app ignores unknown columns. Rows ingested before this
-- column existed remain NULL (the clean-state layer falls back to deriving the
-- clean body from body_text when body_text_clean is NULL).
--
-- Rollback (sentinel): alter table public.activities drop column if exists body_text_clean;

alter table public.activities
  add column if not exists body_text_clean text;

comment on column public.activities.body_text_clean is
  'Quote- and signature-stripped clean body, computed at email ingestion (sync-engine.createActivity). Raw provider body remains in body_text. Consumed by the conversation-state clean-state layer. Nullable/additive (iOS-safe); NULL for rows ingested before this column existed.';
