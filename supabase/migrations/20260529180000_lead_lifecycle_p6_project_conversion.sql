-- Lead Lifecycle P6 — Opportunity → Project conversion.
--
-- ADDITIVE ONLY (iOS-safe). `projects` is the core iOS-synced table — the
-- highest-stakes table in this initiative. This migration:
--   * adds three nullable conversion-payload columns on projects
--     (estimated_value numeric, source text, platform_metadata jsonb) — all
--     nullable, no default that changes existing-row semantics, no CHECK.
--   * adds a NORMALIZED uuid back-link projects.opportunity_ref -> opportunities(id)
--     (FK, on delete set null) ALONGSIDE the legacy text projects.opportunity_id,
--     which is KEPT and mirrored, never converted in place.
--   * defines one SECURITY DEFINER plpgsql RPC
--     (execute_opportunity_project_conversion_guarded) that performs the link
--     write + estimates re-link + disposition INSERT in a single transaction,
--     rolling back on ANY error (no half-conversion is reachable).
--
-- EXPLICITLY REJECTED (iOS-unsafe — do NOT do here):
--   * NO in-place text->uuid conversion of projects.opportunity_id, NO FK on it.
--     An older iOS client still writes a string into that column; an in-place
--     type change or uuid FK would reject those writes / break decode. The
--     normalization is done by adding the NEW opportunity_ref uuid column.
--   * NO new value added to opportunities_stage_check. Converted-ness lives in
--     the disposition row + the FK link, never in the stage enum. The won
--     opportunity STAYS at stage='won' (it is the preserved sales record).
--   * NO NOT NULL / CHECK tightening / rename / type change / column drop on any
--     existing projects column.
--
-- Ordered AFTER 20260529170000 (P5 disposition migration — opportunity_dispositions
-- table, disposition 'converted_to_project', decided_via 'project_conversion',
-- converted_project_ref column) and 20260529170100 (lifecycle disposition ext).
-- NOT APPLIED by the build session; reviewed + applied by the operator together
-- with the P5 migrations.

-- ════════════════════════════════════════════════════════════════════════════
-- 4.1 (a) — Conversion payload columns on projects (additive, nullable, no CHECK)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.projects
  add column if not exists estimated_value numeric;          -- carried sales value

alter table public.projects
  add column if not exists source text;                      -- carried lead source (NO CHECK — permissive, iOS-safe)

alter table public.projects
  add column if not exists platform_metadata jsonb;          -- carried platform provenance

-- ════════════════════════════════════════════════════════════════════════════
-- 4.1 (b) — Normalized uuid back-link, FK-enforced. ADDITIVE alongside the
-- legacy text projects.opportunity_id (kept and mirrored, never converted).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.projects
  add column if not exists opportunity_ref uuid
    references public.opportunities(id) on delete set null;

create index if not exists projects_opportunity_ref_idx
  on public.projects (opportunity_ref)
  where opportunity_ref is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- RPC: execute_opportunity_project_conversion_guarded
--
-- One transaction. SECURITY DEFINER, search_path='', service-role-only grant.
-- The project row is PRE-CREATED by ProjectService.createProject (so the
-- existing create path, RLS, defaults and downstream task-suggestion reuse
-- apply). This RPC then, atomically:
--   * auth/scope guard (service_role OR caller company match) — 42501
--   * locks the opportunity FOR UPDATE
--   * idempotency: if opportunities.project_ref IS NOT NULL → no-op return
--     { converted:false, guard_reason:'already_converted', project_id:<existing> }
--   * snapshot guard on stage (optional) + deleted_at IS NULL
--   * writes the FOUR-column link contract (projects.opportunity_ref +
--     legacy projects.opportunity_id text mirror + opportunities.project_ref +
--     legacy opportunities.project_id uuid mirror)
--   * re-links estimates.project_ref for the opportunity's estimates
--   * supersedes any prior active disposition, inserts
--     disposition='converted_to_project' decided_via='project_conversion'
--     with converted_project_ref = the new project
--   * RAISE on any failure rolls the whole conversion back.
--
-- Returns jsonb:
--   { converted, project_id, opportunity_id, disposition_id, relinked_estimates,
--     guard_reason? }
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.execute_opportunity_project_conversion_guarded(
  p_company_id     uuid,
  p_opportunity_id uuid,
  p_project_id     uuid,
  p_expected_stage text default null,
  p_decided_by     uuid default null,
  p_evidence       jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opportunity   public.opportunities%rowtype;
  v_project       public.projects%rowtype;
  v_disposition_id uuid;
  v_relinked      bigint;
begin
  -- ── Step 1: auth / scope (mirrors execute_opportunity_merge_guarded) ──
  if coalesce(auth.role(), '') <> 'service_role'
    and p_company_id is distinct from (select private.get_user_company_id())
  then
    raise exception 'company scope mismatch'
      using errcode = '42501';
  end if;

  -- ── Step 2a: validate inputs ──
  if p_company_id is null or p_opportunity_id is null or p_project_id is null then
    raise exception 'company, opportunity and project ids are required'
      using errcode = '22023';
  end if;

  -- ── Step 2b: lock the opportunity row ──
  select * into v_opportunity
    from public.opportunities
   where company_id = p_company_id
     and id = p_opportunity_id
   for update;

  if not found then
    raise exception 'opportunity not found in company scope'
      using errcode = 'P0002';
  end if;

  -- ── Step 3: idempotency (BEFORE any write) ──
  -- A re-win / re-run must NEVER create or link a second project. If the
  -- opportunity is already linked to a project (canonical FK forward link set),
  -- short-circuit as a no-op success and return the EXISTING project_ref. The
  -- caller treats this as success and opens the existing project; it also
  -- soft-deletes the just-created orphan project (created before this RPC) when
  -- p_project_id differs from the existing link.
  if v_opportunity.project_ref is not null then
    return jsonb_build_object(
      'converted', false,
      'guard_reason', 'already_converted',
      'opportunity_id', p_opportunity_id,
      'project_id', v_opportunity.project_ref,
      'requested_project_id', p_project_id);
  end if;

  -- ── Step 4: snapshot guard (immune to client races) ──
  if v_opportunity.deleted_at is not null then
    raise exception 'opportunity is soft-deleted'
      using errcode = '22023';
  end if;
  if p_expected_stage is not null
     and v_opportunity.stage is distinct from p_expected_stage
  then
    return jsonb_build_object(
      'converted', false,
      'guard_reason', 'snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'requested_project_id', p_project_id);
  end if;

  -- ── Step 5: confirm the pre-created project exists in scope (lock it) ──
  select * into v_project
    from public.projects
   where company_id = p_company_id
     and id = p_project_id
   for update;

  if not found then
    raise exception 'pre-created project not found in company scope'
      using errcode = 'P0002';
  end if;

  -- ── Step 6: write the FOUR-column link contract (atomic) ──
  -- (1) projects.opportunity_ref — NEW normalized canonical back-link (FK).
  -- (2) projects.opportunity_id  — legacy text mirror (iOS + legacy reads).
  update public.projects
     set opportunity_ref = p_opportunity_id,
         opportunity_id  = p_opportunity_id::text,
         updated_at      = now()
   where id = p_project_id
     and company_id = p_company_id;
  if not found then
    raise exception 'project link update matched zero rows'
      using errcode = 'P0002';
  end if;

  -- (3) opportunities.project_ref — canonical FK forward link.
  -- (4) opportunities.project_id  — legacy uuid mirror (lifecycle guard's
  --     p_expected_project_id check stays correct). Guarded on project_ref IS
  --     NULL so a concurrent winner cannot double-link (defence in depth on top
  --     of the FOR UPDATE lock above).
  update public.opportunities
     set project_ref = p_project_id,
         project_id  = p_project_id,
         updated_at  = now()
   where id = p_opportunity_id
     and company_id = p_company_id
     and project_ref is null;
  if not found then
    raise exception 'opportunity link update matched zero rows (concurrent conversion?)'
      using errcode = 'P0002';
  end if;

  -- ── Step 7: re-link estimates to the new project (FK-backed column only) ──
  -- The legacy estimates.project_id TEXT column is dead — do NOT propagate it.
  update public.estimates
     set project_ref = p_project_id
   where opportunity_id = p_opportunity_id
     and company_id = p_company_id;
  get diagnostics v_relinked = row_count;

  -- ── Step 8: disposition('converted_to_project') (same transaction) ──
  -- Supersede any prior active disposition first (Q3 append-history), then
  -- insert the converted row carrying the new project ref + evidence.
  update public.opportunity_dispositions
     set superseded_at = now()
   where opportunity_id = p_opportunity_id
     and company_id = p_company_id
     and superseded_at is null;

  insert into public.opportunity_dispositions (
    company_id, opportunity_id, disposition, reason_code, decided_via,
    decided_by, evidence, converted_project_ref)
  values (
    p_company_id, p_opportunity_id, 'converted_to_project', null, 'project_conversion',
    p_decided_by,
    coalesce(p_evidence, '{}'::jsonb)
      || jsonb_build_object('relinked_estimates', v_relinked),
    p_project_id)
  returning id into v_disposition_id;

  -- ── Step 9: return ──
  return jsonb_build_object(
    'converted', true,
    'opportunity_id', p_opportunity_id,
    'project_id', p_project_id,
    'disposition_id', v_disposition_id,
    'relinked_estimates', v_relinked);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Grants — service-role only (mirrors the P5 merge / lifecycle RPCs).
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on function public.execute_opportunity_project_conversion_guarded(
  uuid, uuid, uuid, text, uuid, jsonb) from public;
revoke execute on function public.execute_opportunity_project_conversion_guarded(
  uuid, uuid, uuid, text, uuid, jsonb) from anon;
revoke execute on function public.execute_opportunity_project_conversion_guarded(
  uuid, uuid, uuid, text, uuid, jsonb) from authenticated;
grant execute on function public.execute_opportunity_project_conversion_guarded(
  uuid, uuid, uuid, text, uuid, jsonb) to service_role;
