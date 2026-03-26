-- 045_discarded_stage.sql
-- Add 'discarded' as a terminal stage for pipeline opportunities.
-- Discarded = lead contacted us but was not worth pursuing (ad quality signal).

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
  CHECK (stage IN ('new_lead','qualifying','quoting','quoted','follow_up','negotiation','won','lost','discarded'));
