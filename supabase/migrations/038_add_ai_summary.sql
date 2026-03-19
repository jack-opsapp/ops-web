-- 038: Add ai_summary column to opportunities
-- Stores a 1-2 sentence AI-generated summary of the opportunity,
-- refreshed each sync cycle that touches the thread.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS ai_summary TEXT;

COMMENT ON COLUMN opportunities.ai_summary IS 'AI-generated 1-2 sentence summary of the opportunity. Refreshed on each sync that evaluates the thread.';
