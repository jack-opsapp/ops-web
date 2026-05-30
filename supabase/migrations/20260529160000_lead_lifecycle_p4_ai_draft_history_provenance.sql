-- Lead Lifecycle P4-B — ai_draft_history draft-provenance expansion
--
-- ADDITIVE ONLY. `ai_draft_history` is a web-only table (zero references in
-- ops-ios/ or the OPS/ Swift stub — verified 2026-05-29), so even beyond the
-- additive-nullable-only iOS-sync rule this ALTER cannot break any installed
-- iOS build: the table is never synced to the device.
--
-- What this adds:
--   * subject            — the generated/edited subject line for the draft
--   * subject_source     — 'generated' | 'operator' (field-provenance convention)
--   * source_message_id  — the provider message id the draft is replying to
--                          (distinct from thread_id, which is the provider thread)
--   * origin             — mirrors opportunity_follow_up_drafts.origin vocab so the
--                          two draft tables share a provenance vocabulary
--   * edited_at          — stamped when final_version diverges from original_draft
--   * discarded_at       — stamped when a draft is discarded or superseded
--
-- And widens the status CHECK to add 'superseded' (a draft retired by a newer
-- one), aligning the status vocab with opportunity_follow_up_drafts.
--
-- All new columns are nullable with no defaults, so the existing rows stay
-- valid unchanged (status 'drafted', origin NULL). No backfill is performed —
-- backfilling the existing Phase C auto-drafts to origin='phase_c' is an
-- optional, dry-run-first data step intentionally left out of this migration.

ALTER TABLE public.ai_draft_history
  ADD COLUMN IF NOT EXISTS subject            text,
  ADD COLUMN IF NOT EXISTS subject_source     text,
  ADD COLUMN IF NOT EXISTS source_message_id  text,
  ADD COLUMN IF NOT EXISTS origin             text,
  ADD COLUMN IF NOT EXISTS edited_at          timestamptz,
  ADD COLUMN IF NOT EXISTS discarded_at       timestamptz;

-- Recreate the status CHECK to add 'superseded'. The live constraint name is
-- 'ai_draft_history_status_check' (verified via pg_constraint 2026-05-29).
ALTER TABLE public.ai_draft_history
  DROP CONSTRAINT IF EXISTS ai_draft_history_status_check;

ALTER TABLE public.ai_draft_history
  ADD CONSTRAINT ai_draft_history_status_check
  CHECK (status = ANY (ARRAY['drafted', 'sent', 'discarded', 'auto_drafted', 'superseded']));

-- origin CHECK aligned to the local-draft vocab. Nullable, so legacy rows
-- (origin IS NULL) stay valid.
ALTER TABLE public.ai_draft_history
  DROP CONSTRAINT IF EXISTS ai_draft_history_origin_check;

ALTER TABLE public.ai_draft_history
  ADD CONSTRAINT ai_draft_history_origin_check
  CHECK (origin IS NULL OR origin = ANY (ARRAY['operator', 'template_follow_up', 'phase_c', 'system_handoff']));

-- subject_source CHECK — field-provenance convention. Nullable.
ALTER TABLE public.ai_draft_history
  DROP CONSTRAINT IF EXISTS ai_draft_history_subject_source_check;

ALTER TABLE public.ai_draft_history
  ADD CONSTRAINT ai_draft_history_subject_source_check
  CHECK (subject_source IS NULL OR subject_source = ANY (ARRAY['generated', 'operator']));

COMMENT ON COLUMN public.ai_draft_history.subject IS 'Generated/edited subject line for the draft (P4-B).';
COMMENT ON COLUMN public.ai_draft_history.subject_source IS 'Provenance of the subject: generated | operator (P4-B). Operator subject edits are RECORDED but never auto-promote the voice profile.';
COMMENT ON COLUMN public.ai_draft_history.source_message_id IS 'Provider message id the draft replies to — distinct from thread_id (P4-B).';
COMMENT ON COLUMN public.ai_draft_history.origin IS 'Draft origin, mirrors opportunity_follow_up_drafts.origin vocab (P4-B).';
COMMENT ON COLUMN public.ai_draft_history.edited_at IS 'Stamped when final_version diverges from original_draft (P4-B).';
COMMENT ON COLUMN public.ai_draft_history.discarded_at IS 'Stamped when a draft is discarded or superseded (P4-B).';
