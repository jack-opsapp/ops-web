-- Drop the superseded guarded conversion RPC.
--
-- public.execute_opportunity_project_conversion_guarded is fully replaced by the
-- unified public.convert_opportunity_to_project (won-conversion unification, #81).
-- Verified before drop (read-only): 0 code callers — OPS-Web ProjectConversionService
-- switched to the unified RPC in Phase 2 (only a stale generated type remained, removed
-- by regenerating database.types.ts in the paired commit) — and 0 in-DB dependents
-- (no other public/private routine references it). The unified path is deployed and
-- proven in production.
DROP FUNCTION IF EXISTS public.execute_opportunity_project_conversion_guarded(uuid, uuid, uuid, text, uuid, jsonb);
