-- Widen `lead_classification_reviews.review_reason` for the borderline band.
--
-- Bug d1eaebe1. Until now only a feedback-prior outcome could send an unmatched
-- inbound to review. A classifier verdict that landed BETWEEN the review floor
-- (0.5) and the auto-create threshold (0.7) with no feedback history was
-- discarded in silence — the message left no record anywhere and the mailbox
-- cursor moved past it forever.
--
-- `borderline_confidence` is that middle band: not confident enough to create a
-- lead, not weak enough to throw away. A person decides.
--
-- Additive only: every existing reason stays valid, so no row is invalidated
-- and no backfill is required.

alter table public.lead_classification_reviews
  drop constraint if exists lead_classification_reviews_review_reason_check;

alter table public.lead_classification_reviews
  add constraint lead_classification_reviews_review_reason_check
  check (review_reason = any (array[
    'feedback_boundary',
    'duplicate_feedback',
    'neutral_feedback',
    'positive_feedback_conflict',
    'borderline_confidence'
  ]));
