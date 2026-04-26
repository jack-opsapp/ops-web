-- Align qa_bugs.status with the bug-triage spec vocabulary
-- (new / triaged / in_progress / resolved / closed / duplicate). The legacy
-- QA-flavored statuses (claimed, fixing, review, verified, wont_fix,
-- cannot_reproduce) were unique to qa_bugs and blocked the nightly orchestrator
-- (which writes status='in_progress' on claim).
--
-- Order of operations: drop the CHECK first so the backfill UPDATEs (which
-- write the new vocabulary) are accepted, then re-add the new CHECK.
--
-- Backfill mapping:
--   verified         (16 rows) -> resolved        (qa_bugs.verified bool already
--                                                  carries the QA-verification flag)
--   wont_fix         (12 rows) -> closed          (preserve original status in
--                                                  human_review_reason)
--   cannot_reproduce ( 1 row ) -> closed          (set false_positive=true and
--                                                  preserve reason)
--   new / closed              -> unchanged
--   claimed / fixing / review -> unused; dropped from CHECK

-- 1. Drop the legacy CHECK so we can write the new vocabulary.
ALTER TABLE public.qa_bugs DROP CONSTRAINT IF EXISTS qa_bugs_status_check;

-- 2. Backfill legacy statuses to the new vocabulary.
UPDATE public.qa_bugs
SET status = 'resolved'
WHERE status = 'verified';

UPDATE public.qa_bugs
SET status = 'closed',
    human_review_reason = COALESCE(human_review_reason, 'wont_fix')
WHERE status = 'wont_fix';

UPDATE public.qa_bugs
SET status = 'closed',
    false_positive = TRUE,
    human_review_reason = COALESCE(human_review_reason, 'cannot_reproduce')
WHERE status = 'cannot_reproduce';

-- 3. Add the new CHECK matching the spec (and matching bug_reports_status_check).
ALTER TABLE public.qa_bugs ADD CONSTRAINT qa_bugs_status_check
  CHECK (status IN ('new', 'triaged', 'in_progress', 'resolved', 'closed', 'duplicate'));
