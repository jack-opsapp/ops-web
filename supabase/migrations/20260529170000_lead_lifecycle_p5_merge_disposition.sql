-- Lead Lifecycle P5 — Transactional merge, disposition / end-state model.
--
-- ADDITIVE ONLY (iOS-safe). This migration:
--   * adds nullable self-ref merge pointers on opportunities + clients
--   * adds the opportunity_merges audit table
--   * adds the opportunity_dispositions table (append-history, one active row)
--   * adds duplicate_reviews.migration_manifest jsonb
--   * defines two SECURITY DEFINER plpgsql merge RPCs
--     (execute_opportunity_merge_guarded, execute_client_merge_guarded)
--   * extends execute_opportunity_lifecycle_guarded_action's lost branch to
--     write a disposition row inside the same transaction
--
-- The `opportunities_stage_check` CHECK and every existing column type /
-- nullability are LEFT UNTOUCHED (iOS-sync constraint: only additive nullable
-- columns + new tables + new RPCs are safe between App Store releases).
--
-- NOT APPLIED by the build session; reviewed + applied by the operator.

-- ════════════════════════════════════════════════════════════════════════════
-- 3.3.1 — Self-ref merge pointers (additive, nullable)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.opportunities
  add column if not exists merged_into_opportunity_id uuid
    references public.opportunities(id) on delete set null;

alter table public.clients
  add column if not exists merged_into_client_id uuid
    references public.clients(id) on delete set null;

create index if not exists opportunities_merged_into_idx
  on public.opportunities (merged_into_opportunity_id)
  where merged_into_opportunity_id is not null;

create index if not exists clients_merged_into_idx
  on public.clients (merged_into_client_id)
  where merged_into_client_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 3.3.2 — Merge audit table (parity with opportunity_lifecycle_action_audit)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.opportunity_merges (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  entity_type     text not null check (entity_type in ('opportunity', 'client')),
  winner_id       uuid not null,
  loser_id        uuid not null,
  merge_key       text not null,
  review_id       uuid references public.duplicate_reviews(id) on delete set null,
  status          text not null check (status in ('applied', 'skipped', 'failed')),
  guard_reason    text,
  manifest        jsonb not null default '{}'::jsonb,
  field_fill      jsonb not null default '{}'::jsonb,
  field_overrides jsonb not null default '{}'::jsonb,
  resolved_by     uuid,
  run_id          text,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  constraint opportunity_merges_winner_ne_loser check (winner_id <> loser_id)
);

-- A given merge_key + loser can only be APPLIED once (idempotency anchor).
create unique index if not exists opportunity_merges_key_loser_applied_uidx
  on public.opportunity_merges (merge_key, loser_id)
  where status = 'applied';

create index if not exists opportunity_merges_company_idx
  on public.opportunity_merges (company_id, created_at desc);

create index if not exists opportunity_merges_winner_idx
  on public.opportunity_merges (entity_type, winner_id);

create index if not exists opportunity_merges_loser_idx
  on public.opportunity_merges (entity_type, loser_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3.3.3 — Disposition table (append-history; one ACTIVE row per opportunity)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.opportunity_dispositions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  disposition     text not null check (disposition in
                    ('won', 'lost', 'disqualified', 'discarded', 'merged', 'converted_to_project')),
  -- Q7: reason_code is a permissive text column (NO CHECK) so adding codes is
  -- code-only. The disposition column itself stays CHECK'd.
  reason_code     text,
  reason_notes    text,
  decided_via     text not null check (decided_via in
                    ('operator_manual', 'guarded_lifecycle', 'duplicate_merge', 'project_conversion')),
  decided_by      uuid,
  evidence        jsonb not null default '{}'::jsonb,
  merged_into_opportunity_id uuid references public.opportunities(id) on delete set null,
  converted_project_ref      uuid references public.projects(id) on delete set null,
  -- Q3: append history; an active disposition is superseded (not deleted) when
  -- the outcome is re-decided. superseded_at IS NULL ⇒ the active outcome.
  superseded_at   timestamptz,
  superseded_by   uuid references public.opportunity_dispositions(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Composite tenant FK (mirrors opportunity_correspondence_events). The target
-- unique index public.opportunities (company_id, id) already exists
-- (opportunities_company_id_id_uidx), so no UNIQUE needs to be added first.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.opportunity_dispositions'::regclass
       and conname = 'opportunity_dispositions_company_opp_fk'
  ) then
    alter table public.opportunity_dispositions
      add constraint opportunity_dispositions_company_opp_fk
      foreign key (company_id, opportunity_id)
      references public.opportunities(company_id, id)
      on delete cascade;
  end if;
end;
$$;

-- One ACTIVE terminal disposition per opportunity. A re-decided outcome
-- supersedes the prior (superseded_at set) and the new active row takes its
-- place. A merged loser's disposition is itself the active row for that loser
-- (the loser opportunity is soft-deleted, so it never carries another).
create unique index if not exists opportunity_dispositions_one_active_uidx
  on public.opportunity_dispositions (opportunity_id)
  where superseded_at is null;

create index if not exists opportunity_dispositions_company_idx
  on public.opportunity_dispositions (company_id, disposition, created_at desc);

create index if not exists opportunity_dispositions_opp_idx
  on public.opportunity_dispositions (opportunity_id, created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 3.3.4 — duplicate_reviews manifest (additive)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.duplicate_reviews
  add column if not exists migration_manifest jsonb not null default '{}'::jsonb;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS — company-scoped read, mirroring opportunity_lifecycle_action_audit.
-- Writes happen exclusively through SECURITY DEFINER RPCs (service-role).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.opportunity_merges enable row level security;
alter table public.opportunity_dispositions enable row level security;

drop policy if exists opportunity_merges_company_select on public.opportunity_merges;
create policy opportunity_merges_company_select
  on public.opportunity_merges
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

drop policy if exists opportunity_dispositions_company_select on public.opportunity_dispositions;
create policy opportunity_dispositions_company_select
  on public.opportunity_dispositions
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

-- ════════════════════════════════════════════════════════════════════════════
-- RPC: execute_opportunity_merge_guarded
--
-- One transaction. FOR UPDATE both rows (ordered by id). Idempotent on
-- merge_key + loser. Snapshot guard on stage. Fill-blank reconciliation
-- (re-validated in SQL) + operator-confirmed overrides only. Conflicts where
-- BOTH winner and loser are non-blank and differ are DETECTED and surfaced in
-- the manifest, never silently overwritten. Re-points the full §1.1 FK graph
-- with §2.4 de-dupe. Soft-deletes the loser + writes merged_into pointer +
-- disposition('merged') + opportunity_merges audit + duplicate_reviews update,
-- and cascades pending reviews in-transaction. RAISE on any error rolls back
-- the entire merge — no half-merge is reachable.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.execute_opportunity_merge_guarded(
  p_company_id            uuid,
  p_winner_id             uuid,
  p_loser_id              uuid,
  p_merge_key             text,
  p_review_id             uuid default null,
  p_expected_winner_stage text default null,
  p_expected_loser_stage  text default null,
  p_field_fill            jsonb default '{}'::jsonb,
  p_confirmed_overrides   jsonb default '{}'::jsonb,
  p_resolved_by           uuid default null,
  p_run_id                text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner          public.opportunities%rowtype;
  v_loser           public.opportunities%rowtype;
  v_first_id        uuid;
  v_second_id       uuid;
  v_existing_merge  uuid;
  v_merge_id        uuid;
  v_manifest        jsonb := '{}'::jsonb;
  v_conflicts       jsonb := '{}'::jsonb;
  v_fill_applied    jsonb := '{}'::jsonb;
  v_override_applied jsonb := '{}'::jsonb;
  v_allowed_fill    text[] := array[
    'contact_name', 'contact_email', 'contact_phone',
    'description', 'estimated_value', 'address'
  ];
  v_key             text;
  v_winner_json     jsonb;
  v_loser_json      jsonb;
  v_winner_val      text;
  v_loser_val       text;
  v_set_clause      text;
  v_n               bigint;
  v_repointed       bigint;
  v_deleted_dupes   bigint;
  v_superseded      bigint;
  v_disposition_id  uuid;
begin
  -- ── Step 1: auth / scope ──
  if coalesce(auth.role(), '') <> 'service_role'
    and p_company_id is distinct from (select private.get_user_company_id())
  then
    raise exception 'company scope mismatch'
      using errcode = '42501';
  end if;

  -- ── Step 2a: validate inputs ──
  if p_winner_id is null or p_loser_id is null then
    raise exception 'winner and loser ids are required'
      using errcode = '22023';
  end if;
  if p_winner_id = p_loser_id then
    raise exception 'winner and loser must differ'
      using errcode = '22023';
  end if;
  if p_merge_key is null or btrim(p_merge_key) = '' then
    raise exception 'merge key is required'
      using errcode = '22023';
  end if;

  -- ── Step 2b: lock both rows, ordered by id to avoid deadlock ──
  if p_winner_id < p_loser_id then
    v_first_id := p_winner_id;
    v_second_id := p_loser_id;
  else
    v_first_id := p_loser_id;
    v_second_id := p_winner_id;
  end if;

  perform 1
    from public.opportunities
   where company_id = p_company_id
     and id in (v_first_id, v_second_id)
   order by id
   for update;

  select * into v_winner
    from public.opportunities
   where company_id = p_company_id and id = p_winner_id;
  if not found then
    return public._record_opportunity_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'missing_winner', 'Winner opportunity not found in company scope.');
  end if;

  select * into v_loser
    from public.opportunities
   where company_id = p_company_id and id = p_loser_id;
  if not found then
    return public._record_opportunity_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'missing_loser', 'Loser opportunity not found in company scope.');
  end if;

  -- ── Step 3: idempotency (BEFORE the soft-deleted guards) ──
  -- A same-key retry of an already-applied merge must short-circuit with the
  -- documented 'duplicate_applied_merge' contract — not 'loser_deleted' (the
  -- loser is soft-deleted precisely because the prior run applied). Placing the
  -- idempotency lookup first keeps the retry data-safe AND audit-accurate.
  -- 'loser_deleted'/'winner_deleted' remain the guard for an UNRELATED key.
  select id into v_existing_merge
    from public.opportunity_merges
   where merge_key = p_merge_key
     and loser_id = p_loser_id
     and status = 'applied'
   limit 1;
  if v_existing_merge is not null then
    return jsonb_build_object(
      'applied', false,
      'merge_id', v_existing_merge,
      'winner_id', p_winner_id,
      'loser_id', p_loser_id,
      'guard_reason', 'duplicate_applied_merge',
      'error_code', 'duplicate_applied_merge');
  end if;

  if v_winner.deleted_at is not null then
    return public._record_opportunity_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'winner_deleted', 'Winner opportunity is already soft-deleted.');
  end if;
  if v_loser.deleted_at is not null then
    return public._record_opportunity_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'loser_deleted', 'Loser opportunity is already soft-deleted.');
  end if;

  -- ── Step 4: snapshot guard ──
  if (p_expected_winner_stage is not null
        and v_winner.stage is distinct from p_expected_winner_stage)
     or (p_expected_loser_stage is not null
        and v_loser.stage is distinct from p_expected_loser_stage)
  then
    return public._record_opportunity_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'snapshot_mismatch', 'Live opportunity stage no longer matches the approved snapshot.');
  end if;

  v_winner_json := to_jsonb(v_winner);
  v_loser_json := to_jsonb(v_loser);

  -- ── Step 5: field reconciliation ──
  -- Fill-blank (winner blank only, re-validated in SQL) + conflict detection.
  foreach v_key in array v_allowed_fill loop
    v_winner_val := nullif(btrim(coalesce(v_winner_json ->> v_key, '')), '');
    v_loser_val := nullif(btrim(coalesce(v_loser_json ->> v_key, '')), '');

    if v_loser_val is null then
      continue;  -- nothing to contribute from the loser
    end if;

    if v_winner_val is null then
      -- Winner blank ⇒ auto fill-blank if the client requested this field.
      if p_field_fill ? v_key then
        v_fill_applied := v_fill_applied
          || jsonb_build_object(v_key, v_loser_json -> v_key);
      end if;
    elsif v_winner_val is distinct from v_loser_val then
      -- Both non-blank and differ. Apply ONLY if explicitly confirmed; never
      -- silently overwrite. Unresolved conflicts are surfaced in the manifest.
      if p_confirmed_overrides ? v_key then
        v_override_applied := v_override_applied
          || jsonb_build_object(v_key, p_confirmed_overrides -> v_key);
      else
        v_conflicts := v_conflicts || jsonb_build_object(
          v_key,
          jsonb_build_object('winner', v_winner_json -> v_key,
                             'loser', v_loser_json -> v_key));
      end if;
    end if;
  end loop;

  -- Apply fill-blank (only to columns still blank — defence in depth).
  if v_fill_applied ? 'contact_name' then
    update public.opportunities set contact_name = (v_fill_applied ->> 'contact_name')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(contact_name, '')), '') is null;
  end if;
  if v_fill_applied ? 'contact_email' then
    update public.opportunities set contact_email = (v_fill_applied ->> 'contact_email')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(contact_email, '')), '') is null;
  end if;
  if v_fill_applied ? 'contact_phone' then
    update public.opportunities set contact_phone = (v_fill_applied ->> 'contact_phone')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(contact_phone, '')), '') is null;
  end if;
  if v_fill_applied ? 'description' then
    update public.opportunities set description = (v_fill_applied ->> 'description')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(description, '')), '') is null;
  end if;
  if v_fill_applied ? 'estimated_value' then
    update public.opportunities set estimated_value = (v_fill_applied ->> 'estimated_value')::numeric
     where id = p_winner_id and company_id = p_company_id
       and estimated_value is null;
  end if;
  if v_fill_applied ? 'address' then
    update public.opportunities set address = (v_fill_applied ->> 'address')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(address, '')), '') is null;
  end if;

  -- Apply operator-confirmed overrides (the only path allowed to overwrite a
  -- non-blank winner field). Only fields the operator explicitly chose.
  if v_override_applied ? 'contact_name' then
    update public.opportunities set contact_name = (v_override_applied ->> 'contact_name')
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'contact_email' then
    update public.opportunities set contact_email = (v_override_applied ->> 'contact_email')
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'contact_phone' then
    update public.opportunities set contact_phone = (v_override_applied ->> 'contact_phone')
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'description' then
    update public.opportunities set description = (v_override_applied ->> 'description')
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'estimated_value' then
    update public.opportunities set estimated_value = (v_override_applied ->> 'estimated_value')::numeric
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'address' then
    update public.opportunities set address = (v_override_applied ->> 'address')
     where id = p_winner_id and company_id = p_company_id;
  end if;

  -- ── Step 6: re-point every child (full §1.1 graph) ──

  -- Simple re-points (no dedupe).
  update public.activities set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('activities', v_n);

  update public.follow_ups set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('follow_ups', v_n);

  update public.stage_transitions set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('stage_transitions', v_n);

  update public.estimates set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('estimates', v_n);

  update public.email_threads set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('email_threads', v_n);

  update public.ai_draft_history set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('ai_draft_history', v_n);

  update public.opportunity_correspondence_events set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('opportunity_correspondence_events', v_n);

  update public.opportunity_lifecycle_action_audit set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('opportunity_lifecycle_action_audit', v_n);

  update public.pending_auto_sends set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('pending_auto_sends', v_n);

  update public.site_visits set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('site_visits', v_n);

  update public.invoices set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('invoices', v_n);

  -- §2.4 de-dupe: opportunity_email_threads (unique on thread_id, connection_id).
  -- Delete loser rows that collide with a winner row on (thread_id, connection_id),
  -- then re-point the remainder. This join table has NO company_id column;
  -- scope is enforced via opportunity_id (both ids were validated under
  -- p_company_id above).
  --
  -- NULL semantics MUST mirror the DB unique index. The index
  -- opportunity_email_threads_thread_id_connection_id_key is a STANDARD btree:
  -- NULL is DISTINCT, so two rows sharing thread_id with NULL connection_id do
  -- NOT collide and both are legal. We therefore treat rows as colliding only
  -- when BOTH connection_ids are non-null and equal; a loser row with a NULL
  -- connection_id is re-pointed (not deleted), exactly as the index permits —
  -- otherwise the loser's distinct row metadata would be silently lost.
  delete from public.opportunity_email_threads loser
   where loser.opportunity_id = p_loser_id
     and loser.connection_id is not null
     and exists (
       select 1 from public.opportunity_email_threads win
        where win.opportunity_id = p_winner_id
          and win.thread_id is not distinct from loser.thread_id
          and win.connection_id is not null
          and win.connection_id = loser.connection_id
     );
  get diagnostics v_deleted_dupes = row_count;

  update public.opportunity_email_threads set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id;
  get diagnostics v_repointed = row_count;
  v_manifest := v_manifest || jsonb_build_object(
    'opportunity_email_threads',
    jsonb_build_object('repointed', v_repointed, 'deleted_dupes', v_deleted_dupes));

  -- §2.4 de-dupe: opportunity_lifecycle_state (PK on opportunity_id ⇒ one row).
  -- Conservative merge (Q4): newest last_meaningful_at, MAX(unanswered_follow_up_count),
  -- furthest-future protected_until; then delete the loser row.
  if exists (select 1 from public.opportunity_lifecycle_state
              where opportunity_id = p_winner_id and company_id = p_company_id)
     and exists (select 1 from public.opportunity_lifecycle_state
              where opportunity_id = p_loser_id and company_id = p_company_id)
  then
    update public.opportunity_lifecycle_state win
       set last_meaningful_at = (
             select max(t) from (values
               (win.last_meaningful_at), (loser.last_meaningful_at)) v(t)),
           unanswered_follow_up_count = greatest(
             coalesce(win.unanswered_follow_up_count, 0),
             coalesce(loser.unanswered_follow_up_count, 0)),
           protected_until = (
             select max(t) from (values
               (win.protected_until), (loser.protected_until)) v(t)),
           updated_at = now()
      from public.opportunity_lifecycle_state loser
     where win.opportunity_id = p_winner_id and win.company_id = p_company_id
       and loser.opportunity_id = p_loser_id and loser.company_id = p_company_id;

    delete from public.opportunity_lifecycle_state
     where opportunity_id = p_loser_id and company_id = p_company_id;
    v_manifest := v_manifest || jsonb_build_object('opportunity_lifecycle_state', 'merged');
  else
    update public.opportunity_lifecycle_state set opportunity_id = p_winner_id
     where opportunity_id = p_loser_id and company_id = p_company_id;
    get diagnostics v_n = row_count;
    v_manifest := v_manifest || jsonb_build_object(
      'opportunity_lifecycle_state',
      case when v_n > 0 then 'repointed' else 'none' end);
  end if;

  -- §2.4 de-dupe: opportunity_follow_up_drafts. Partial unique index on
  -- (company_id, opportunity_id, origin) WHERE origin='template_follow_up'
  -- AND status='drafted'. If the winner already has an open template draft,
  -- supersede the loser's open template draft (move it out of the partial
  -- index) before re-pointing; re-point everything else directly.
  if exists (
    select 1 from public.opportunity_follow_up_drafts
     where opportunity_id = p_winner_id and company_id = p_company_id
       and origin = 'template_follow_up' and status = 'drafted'
  ) then
    update public.opportunity_follow_up_drafts
       set status = 'superseded', superseded_at = now()
     where opportunity_id = p_loser_id and company_id = p_company_id
       and origin = 'template_follow_up' and status = 'drafted';
    get diagnostics v_superseded = row_count;
  else
    v_superseded := 0;
  end if;

  update public.opportunity_follow_up_drafts set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_repointed = row_count;
  v_manifest := v_manifest || jsonb_build_object(
    'opportunity_follow_up_drafts',
    jsonb_build_object('repointed', v_repointed, 'superseded', v_superseded));

  -- Reverse back-link (TEXT column, no FK; P6 normalizes).
  update public.projects set opportunity_id = p_winner_id::text
   where opportunity_id = p_loser_id::text and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('projects_back_link', v_n);

  -- Record conflicts + reconciliation in the manifest.
  v_manifest := v_manifest || jsonb_build_object(
    'field_fill_applied', v_fill_applied,
    'field_overrides_applied', v_override_applied,
    'field_conflicts', v_conflicts);

  -- ── Step 7: soft-delete loser + write pointer ──
  update public.opportunities
     set deleted_at = now(),
         merged_into_opportunity_id = p_winner_id,
         updated_at = now()
   where id = p_loser_id and company_id = p_company_id
     and deleted_at is null;
  if not found then
    raise exception 'loser soft-delete matched zero rows'
      using errcode = 'P0002';
  end if;

  -- ── Step 8: disposition('merged') for the loser ──
  -- Supersede any active disposition on the loser, then insert the merged row.
  update public.opportunity_dispositions
     set superseded_at = now()
   where opportunity_id = p_loser_id and company_id = p_company_id
     and superseded_at is null;

  -- reason_code stays NULL: 'merged' is a structural outcome, not a failure
  -- reason. The §3.4 codes (incl. duplicate_non_merge) are discarded-bucket
  -- reasons; tagging a merged row with one would pollute lead/data-quality
  -- reporting. The winner pointer + evidence carry the merge provenance.
  insert into public.opportunity_dispositions (
    company_id, opportunity_id, disposition, reason_code, decided_via,
    decided_by, evidence, merged_into_opportunity_id)
  values (
    p_company_id, p_loser_id, 'merged', null, 'duplicate_merge',
    p_resolved_by,
    jsonb_build_object('review_id', p_review_id, 'merge_key', p_merge_key,
                       'winner_id', p_winner_id),
    p_winner_id)
  returning id into v_disposition_id;

  -- ── Step 9: merge audit ──
  insert into public.opportunity_merges (
    company_id, entity_type, winner_id, loser_id, merge_key, review_id,
    status, manifest, field_fill, field_overrides, resolved_by, run_id)
  values (
    p_company_id, 'opportunity', p_winner_id, p_loser_id, p_merge_key, p_review_id,
    'applied', v_manifest, coalesce(p_field_fill, '{}'::jsonb),
    coalesce(p_confirmed_overrides, '{}'::jsonb), p_resolved_by, p_run_id)
  returning id into v_merge_id;

  -- ── Step 10: update driving duplicate_review ──
  if p_review_id is not null then
    update public.duplicate_reviews
       set status = 'merged',
           winner_id = p_winner_id,
           resolved_by = p_resolved_by,
           resolved_at = now(),
           migration_manifest = v_manifest
     where id = p_review_id and company_id = p_company_id;
  end if;

  -- ── Step 11: cascade pending reviews referencing the loser (in-transaction) ──
  -- Self-references collapse (winner already paired with loser) ⇒ delete.
  delete from public.duplicate_reviews
   where company_id = p_company_id
     and entity_type = 'opportunity'
     and status = 'pending'
     and (entity_a_id = p_loser_id or entity_b_id = p_loser_id)
     and (entity_a_id = p_winner_id or entity_b_id = p_winner_id);

  -- Pre-dedupe before the re-point: duplicate_reviews has a NON-partial unique
  -- on (company_id, entity_type, entity_a_id, entity_b_id). A loser-paired
  -- pending review (loser, X) that would re-point to (winner, X) must not collide
  -- with a pre-existing pending review already pairing (winner, X) — otherwise
  -- the UPDATE below raises a unique violation and aborts a legitimate merge.
  -- Drop the loser-paired duplicates (the winner already has the review against X);
  -- the surviving (winner, X) row is kept untouched.
  delete from public.duplicate_reviews lo
   where lo.company_id = p_company_id
     and lo.entity_type = 'opportunity'
     and lo.status = 'pending'
     and (lo.entity_a_id = p_loser_id or lo.entity_b_id = p_loser_id)
     and not (lo.entity_a_id = p_winner_id or lo.entity_b_id = p_winner_id)
     and exists (
       select 1 from public.duplicate_reviews ex
        where ex.company_id = p_company_id
          and ex.entity_type = 'opportunity'
          and ex.status = 'pending'
          and ex.id <> lo.id
          and ex.entity_a_id = least(p_winner_id,
                case when lo.entity_a_id = p_loser_id then lo.entity_b_id else lo.entity_a_id end)
          and ex.entity_b_id = greatest(p_winner_id,
                case when lo.entity_a_id = p_loser_id then lo.entity_b_id else lo.entity_a_id end)
     );

  -- Remaining pending reviews: replace loser with winner, keep ordered pair.
  update public.duplicate_reviews
     set entity_a_id = least(p_winner_id,
            case when entity_a_id = p_loser_id then entity_b_id else entity_a_id end),
         entity_b_id = greatest(p_winner_id,
            case when entity_a_id = p_loser_id then entity_b_id else entity_a_id end)
   where company_id = p_company_id
     and entity_type = 'opportunity'
     and status = 'pending'
     and (entity_a_id = p_loser_id or entity_b_id = p_loser_id);

  -- ── Step 12: return manifest ──
  return jsonb_build_object(
    'applied', true,
    'merge_id', v_merge_id,
    'winner_id', p_winner_id,
    'loser_id', p_loser_id,
    'disposition_id', v_disposition_id,
    'manifest', v_manifest);
end;
$$;

-- Helper: record a skipped opportunity merge (a guard short-circuit) and
-- return the standard skip envelope. Kept as a separate SECURITY DEFINER
-- function so both the merge RPC and its tests share one skip path.
create or replace function public._record_opportunity_merge_skip(
  p_company_id          uuid,
  p_winner_id           uuid,
  p_loser_id            uuid,
  p_merge_key           text,
  p_review_id           uuid,
  p_field_fill          jsonb,
  p_confirmed_overrides jsonb,
  p_resolved_by         uuid,
  p_run_id              text,
  p_guard_reason        text,
  p_error_message       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merge_id uuid;
begin
  insert into public.opportunity_merges (
    company_id, entity_type, winner_id, loser_id, merge_key, review_id,
    status, guard_reason, field_fill, field_overrides, resolved_by, run_id,
    error_code, error_message)
  values (
    p_company_id, 'opportunity', p_winner_id, p_loser_id, p_merge_key, p_review_id,
    'skipped', p_guard_reason, coalesce(p_field_fill, '{}'::jsonb),
    coalesce(p_confirmed_overrides, '{}'::jsonb), p_resolved_by, p_run_id,
    p_guard_reason, p_error_message)
  returning id into v_merge_id;

  return jsonb_build_object(
    'applied', false,
    'merge_id', v_merge_id,
    'winner_id', p_winner_id,
    'loser_id', p_loser_id,
    'guard_reason', p_guard_reason,
    'error_code', p_guard_reason,
    'error_message', p_error_message);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- RPC: execute_client_merge_guarded
--
-- Same transactional discipline. Re-points the full §1.2 client FK graph —
-- BOTH the enforced *_ref FK AND the legacy *_id mirror for estimates /
-- invoices / opportunities, plus activities.client_id / activities.suggested_client_id,
-- email_threads.client_id, payments, project_table_rows, site_visits (text
-- mirror + uuid client_ref), task_recurrences, client_product_overrides,
-- projects, sub_clients. Portal (Q6): re-point portal_messages (history),
-- revoke portal_tokens + portal_sessions (auth — never re-pointed). Snapshot
-- guards on deleted_at + updated_at (clients have no stage).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.execute_client_merge_guarded(
  p_company_id            uuid,
  p_winner_id             uuid,
  p_loser_id              uuid,
  p_merge_key             text,
  p_review_id             uuid default null,
  p_expected_winner_updated_at timestamptz default null,
  p_expected_loser_updated_at  timestamptz default null,
  p_field_fill            jsonb default '{}'::jsonb,
  p_confirmed_overrides   jsonb default '{}'::jsonb,
  p_resolved_by           uuid default null,
  p_run_id                text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner          public.clients%rowtype;
  v_loser           public.clients%rowtype;
  v_first_id        uuid;
  v_second_id       uuid;
  v_existing_merge  uuid;
  v_merge_id        uuid;
  v_manifest        jsonb := '{}'::jsonb;
  v_conflicts       jsonb := '{}'::jsonb;
  v_fill_applied    jsonb := '{}'::jsonb;
  v_override_applied jsonb := '{}'::jsonb;
  v_allowed_fill    text[] := array[
    'email', 'phone_number', 'address', 'latitude', 'longitude',
    'profile_image_url', 'notes'
  ];
  v_key             text;
  v_winner_json     jsonb;
  v_loser_json      jsonb;
  v_winner_val      text;
  v_loser_val       text;
  v_n               bigint;
  v_repointed       bigint;
  v_deleted_dupes   bigint;
  v_loser_text      text := p_loser_id::text;
  v_winner_text     text := p_winner_id::text;
begin
  -- ── Step 1: auth / scope ──
  if coalesce(auth.role(), '') <> 'service_role'
    and p_company_id is distinct from (select private.get_user_company_id())
  then
    raise exception 'company scope mismatch'
      using errcode = '42501';
  end if;

  -- ── Step 2a: validate ──
  if p_winner_id is null or p_loser_id is null then
    raise exception 'winner and loser ids are required' using errcode = '22023';
  end if;
  if p_winner_id = p_loser_id then
    raise exception 'winner and loser must differ' using errcode = '22023';
  end if;
  if p_merge_key is null or btrim(p_merge_key) = '' then
    raise exception 'merge key is required' using errcode = '22023';
  end if;

  -- ── Step 2b: lock both rows, ordered ──
  if p_winner_id < p_loser_id then
    v_first_id := p_winner_id; v_second_id := p_loser_id;
  else
    v_first_id := p_loser_id; v_second_id := p_winner_id;
  end if;

  perform 1 from public.clients
   where company_id = p_company_id and id in (v_first_id, v_second_id)
   order by id for update;

  select * into v_winner from public.clients
   where company_id = p_company_id and id = p_winner_id;
  if not found then
    return public._record_client_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'missing_winner', 'Winner client not found in company scope.');
  end if;

  select * into v_loser from public.clients
   where company_id = p_company_id and id = p_loser_id;
  if not found then
    return public._record_client_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'missing_loser', 'Loser client not found in company scope.');
  end if;

  -- ── Step 3: idempotency (BEFORE the soft-deleted guards; see opportunity RPC) ──
  select id into v_existing_merge
    from public.opportunity_merges
   where merge_key = p_merge_key and loser_id = p_loser_id and status = 'applied'
   limit 1;
  if v_existing_merge is not null then
    return jsonb_build_object(
      'applied', false, 'merge_id', v_existing_merge,
      'winner_id', p_winner_id, 'loser_id', p_loser_id,
      'guard_reason', 'duplicate_applied_merge', 'error_code', 'duplicate_applied_merge');
  end if;

  if v_winner.deleted_at is not null then
    return public._record_client_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'winner_deleted', 'Winner client is already soft-deleted.');
  end if;
  if v_loser.deleted_at is not null then
    return public._record_client_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'loser_deleted', 'Loser client is already soft-deleted.');
  end if;

  -- ── Step 4: snapshot guard (deleted_at + updated_at) ──
  if (p_expected_winner_updated_at is not null
        and v_winner.updated_at is distinct from p_expected_winner_updated_at)
     or (p_expected_loser_updated_at is not null
        and v_loser.updated_at is distinct from p_expected_loser_updated_at)
  then
    return public._record_client_merge_skip(
      p_company_id, p_winner_id, p_loser_id, p_merge_key, p_review_id,
      p_field_fill, p_confirmed_overrides, p_resolved_by, p_run_id,
      'snapshot_mismatch', 'Live client updated_at no longer matches the approved snapshot.');
  end if;

  v_winner_json := to_jsonb(v_winner);
  v_loser_json := to_jsonb(v_loser);

  -- ── Step 5: field reconciliation (fill-blank + conflict detection) ──
  foreach v_key in array v_allowed_fill loop
    v_winner_val := nullif(btrim(coalesce(v_winner_json ->> v_key, '')), '');
    v_loser_val := nullif(btrim(coalesce(v_loser_json ->> v_key, '')), '');
    if v_loser_val is null then
      continue;
    end if;
    if v_winner_val is null then
      if p_field_fill ? v_key then
        v_fill_applied := v_fill_applied || jsonb_build_object(v_key, v_loser_json -> v_key);
      end if;
    elsif v_winner_val is distinct from v_loser_val then
      if p_confirmed_overrides ? v_key then
        v_override_applied := v_override_applied || jsonb_build_object(v_key, p_confirmed_overrides -> v_key);
      else
        v_conflicts := v_conflicts || jsonb_build_object(
          v_key, jsonb_build_object('winner', v_winner_json -> v_key, 'loser', v_loser_json -> v_key));
      end if;
    end if;
  end loop;

  if v_fill_applied ? 'email' then
    update public.clients set email = (v_fill_applied ->> 'email')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(email, '')), '') is null;
  end if;
  if v_fill_applied ? 'phone_number' then
    update public.clients set phone_number = (v_fill_applied ->> 'phone_number')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(phone_number, '')), '') is null;
  end if;
  if v_fill_applied ? 'address' then
    update public.clients set address = (v_fill_applied ->> 'address')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(address, '')), '') is null;
  end if;
  if v_fill_applied ? 'latitude' then
    update public.clients set latitude = (v_fill_applied ->> 'latitude')::double precision
     where id = p_winner_id and company_id = p_company_id and latitude is null;
  end if;
  if v_fill_applied ? 'longitude' then
    update public.clients set longitude = (v_fill_applied ->> 'longitude')::double precision
     where id = p_winner_id and company_id = p_company_id and longitude is null;
  end if;
  if v_fill_applied ? 'profile_image_url' then
    update public.clients set profile_image_url = (v_fill_applied ->> 'profile_image_url')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(profile_image_url, '')), '') is null;
  end if;
  if v_fill_applied ? 'notes' then
    update public.clients set notes = (v_fill_applied ->> 'notes')
     where id = p_winner_id and company_id = p_company_id
       and nullif(btrim(coalesce(notes, '')), '') is null;
  end if;

  if v_override_applied ? 'email' then
    update public.clients set email = (v_override_applied ->> 'email')
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'phone_number' then
    update public.clients set phone_number = (v_override_applied ->> 'phone_number')
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'address' then
    update public.clients set address = (v_override_applied ->> 'address')
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'latitude' then
    update public.clients set latitude = (v_override_applied ->> 'latitude')::double precision
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'longitude' then
    update public.clients set longitude = (v_override_applied ->> 'longitude')::double precision
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'profile_image_url' then
    update public.clients set profile_image_url = (v_override_applied ->> 'profile_image_url')
     where id = p_winner_id and company_id = p_company_id;
  end if;
  if v_override_applied ? 'notes' then
    update public.clients set notes = (v_override_applied ->> 'notes')
     where id = p_winner_id and company_id = p_company_id;
  end if;

  -- ── Step 6: re-point every child (full §1.2 graph) ──

  -- opportunities: enforced client_ref FK + legacy client_id mirror.
  update public.opportunities set client_ref = p_winner_id
   where client_ref = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('opportunities__client_ref', v_n);
  update public.opportunities set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('opportunities__client_id', v_n);

  -- estimates: enforced client_ref FK + legacy client_id mirror.
  update public.estimates set client_ref = p_winner_id
   where client_ref = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('estimates__client_ref', v_n);
  update public.estimates set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('estimates__client_id', v_n);

  -- invoices: enforced client_ref FK + legacy client_id mirror.
  update public.invoices set client_ref = p_winner_id
   where client_ref = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('invoices__client_ref', v_n);
  update public.invoices set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('invoices__client_id', v_n);

  -- site_visits: enforced client_ref (uuid) + legacy client_id (TEXT mirror).
  update public.site_visits set client_ref = p_winner_id
   where client_ref = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('site_visits__client_ref', v_n);
  update public.site_visits set client_id = v_winner_text
   where client_id = v_loser_text and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('site_visits__client_id', v_n);

  -- projects.client_id (enforced FK).
  update public.projects set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('projects', v_n);

  -- email_threads.client_id (enforced FK).
  update public.email_threads set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('email_threads', v_n);

  -- task_recurrences.client_id (enforced FK).
  update public.task_recurrences set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('task_recurrences', v_n);

  -- follow_ups.client_id (unenforced uuid mirror; no FK ⇒ a soft-deleted loser
  -- fires no SET NULL/CASCADE, so a left-behind row is a hard orphan — the same
  -- mechanism as the activities.client_id orphans this build eliminates).
  update public.follow_ups set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('follow_ups', v_n);

  -- client_product_overrides.client_id (enforced FK).
  update public.client_product_overrides set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('client_product_overrides', v_n);

  -- activities.client_id + activities.suggested_client_id (unenforced).
  update public.activities set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('activities__client_id', v_n);
  update public.activities set suggested_client_id = p_winner_id
   where suggested_client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('activities__suggested_client_id', v_n);

  -- payments.client_id (unenforced).
  update public.payments set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('payments', v_n);

  -- project_table_rows.client_id (unenforced).
  update public.project_table_rows set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('project_table_rows', v_n);

  -- sub_clients (enforced FK, CASCADE). De-dupe: delete loser sub-clients that
  -- duplicate a winner sub-client (same normalized name + email), then re-point.
  delete from public.sub_clients loser
   where loser.client_id = p_loser_id
     and loser.company_id = p_company_id
     and loser.deleted_at is null
     and exists (
       select 1 from public.sub_clients win
        where win.client_id = p_winner_id
          and win.company_id = p_company_id
          and win.deleted_at is null
          and lower(btrim(coalesce(win.name, ''))) = lower(btrim(coalesce(loser.name, '')))
          and lower(btrim(coalesce(win.email, ''))) = lower(btrim(coalesce(loser.email, '')))
     );
  get diagnostics v_deleted_dupes = row_count;
  update public.sub_clients set client_id = p_winner_id
   where client_id = p_loser_id and company_id = p_company_id;
  get diagnostics v_repointed = row_count;
  v_manifest := v_manifest || jsonb_build_object(
    'sub_clients', jsonb_build_object('repointed', v_repointed, 'deleted_dupes', v_deleted_dupes));

  -- Portal (Q6): re-point portal_messages (history) to the winner; REVOKE
  -- portal_tokens + portal_sessions for the merged-away client (auth artifacts
  -- are never re-pointed). client_id columns are TEXT here.
  update public.portal_messages set client_id = v_winner_text
   where client_id = v_loser_text;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('portal_messages', v_n);

  update public.portal_tokens set revoked_at = now()
   where client_id = v_loser_text and revoked_at is null;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('portal_tokens_revoked', v_n);

  delete from public.portal_sessions where client_id = v_loser_text;
  get diagnostics v_n = row_count;
  v_manifest := v_manifest || jsonb_build_object('portal_sessions_revoked', v_n);

  v_manifest := v_manifest || jsonb_build_object(
    'field_fill_applied', v_fill_applied,
    'field_overrides_applied', v_override_applied,
    'field_conflicts', v_conflicts);

  -- ── Step 7: soft-delete loser + pointer ──
  update public.clients
     set deleted_at = now(),
         merged_into_client_id = p_winner_id,
         updated_at = now()
   where id = p_loser_id and company_id = p_company_id
     and deleted_at is null;
  if not found then
    raise exception 'loser client soft-delete matched zero rows' using errcode = 'P0002';
  end if;

  -- ── Step 8: merge audit ──
  insert into public.opportunity_merges (
    company_id, entity_type, winner_id, loser_id, merge_key, review_id,
    status, manifest, field_fill, field_overrides, resolved_by, run_id)
  values (
    p_company_id, 'client', p_winner_id, p_loser_id, p_merge_key, p_review_id,
    'applied', v_manifest, coalesce(p_field_fill, '{}'::jsonb),
    coalesce(p_confirmed_overrides, '{}'::jsonb), p_resolved_by, p_run_id)
  returning id into v_merge_id;

  -- ── Step 9: update driving duplicate_review ──
  if p_review_id is not null then
    update public.duplicate_reviews
       set status = 'merged', winner_id = p_winner_id, resolved_by = p_resolved_by,
           resolved_at = now(), migration_manifest = v_manifest
     where id = p_review_id and company_id = p_company_id;
  end if;

  -- ── Step 10: cascade pending reviews referencing the loser (in-transaction) ──
  delete from public.duplicate_reviews
   where company_id = p_company_id and entity_type = 'client' and status = 'pending'
     and (entity_a_id = p_loser_id or entity_b_id = p_loser_id)
     and (entity_a_id = p_winner_id or entity_b_id = p_winner_id);

  -- Pre-dedupe before the re-point (see the opportunity RPC for the rationale):
  -- duplicate_reviews has a NON-partial unique on
  -- (company_id, entity_type, entity_a_id, entity_b_id); a loser-paired review
  -- whose re-pointed pair already exists for the winner must be dropped, not
  -- re-pointed, or the UPDATE raises a unique violation and aborts the merge.
  delete from public.duplicate_reviews lo
   where lo.company_id = p_company_id
     and lo.entity_type = 'client'
     and lo.status = 'pending'
     and (lo.entity_a_id = p_loser_id or lo.entity_b_id = p_loser_id)
     and not (lo.entity_a_id = p_winner_id or lo.entity_b_id = p_winner_id)
     and exists (
       select 1 from public.duplicate_reviews ex
        where ex.company_id = p_company_id
          and ex.entity_type = 'client'
          and ex.status = 'pending'
          and ex.id <> lo.id
          and ex.entity_a_id = least(p_winner_id,
                case when lo.entity_a_id = p_loser_id then lo.entity_b_id else lo.entity_a_id end)
          and ex.entity_b_id = greatest(p_winner_id,
                case when lo.entity_a_id = p_loser_id then lo.entity_b_id else lo.entity_a_id end)
     );

  update public.duplicate_reviews
     set entity_a_id = least(p_winner_id,
            case when entity_a_id = p_loser_id then entity_b_id else entity_a_id end),
         entity_b_id = greatest(p_winner_id,
            case when entity_a_id = p_loser_id then entity_b_id else entity_a_id end)
   where company_id = p_company_id and entity_type = 'client' and status = 'pending'
     and (entity_a_id = p_loser_id or entity_b_id = p_loser_id);

  return jsonb_build_object(
    'applied', true, 'merge_id', v_merge_id,
    'winner_id', p_winner_id, 'loser_id', p_loser_id, 'manifest', v_manifest);
end;
$$;

create or replace function public._record_client_merge_skip(
  p_company_id          uuid,
  p_winner_id           uuid,
  p_loser_id            uuid,
  p_merge_key           text,
  p_review_id           uuid,
  p_field_fill          jsonb,
  p_confirmed_overrides jsonb,
  p_resolved_by         uuid,
  p_run_id              text,
  p_guard_reason        text,
  p_error_message       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merge_id uuid;
begin
  insert into public.opportunity_merges (
    company_id, entity_type, winner_id, loser_id, merge_key, review_id,
    status, guard_reason, field_fill, field_overrides, resolved_by, run_id,
    error_code, error_message)
  values (
    p_company_id, 'client', p_winner_id, p_loser_id, p_merge_key, p_review_id,
    'skipped', p_guard_reason, coalesce(p_field_fill, '{}'::jsonb),
    coalesce(p_confirmed_overrides, '{}'::jsonb), p_resolved_by, p_run_id,
    p_guard_reason, p_error_message)
  returning id into v_merge_id;

  return jsonb_build_object(
    'applied', false, 'merge_id', v_merge_id,
    'winner_id', p_winner_id, 'loser_id', p_loser_id,
    'guard_reason', p_guard_reason, 'error_code', p_guard_reason,
    'error_message', p_error_message);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Grants — service-role only (mirrors execute_opportunity_lifecycle_guarded_action).
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text) from public;
revoke execute on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text) from anon;
revoke execute on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text) from authenticated;
grant execute on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text) to service_role;

revoke execute on function public.execute_client_merge_guarded(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text) from public;
revoke execute on function public.execute_client_merge_guarded(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text) from anon;
revoke execute on function public.execute_client_merge_guarded(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text) from authenticated;
grant execute on function public.execute_client_merge_guarded(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text) to service_role;

revoke execute on function public._record_opportunity_merge_skip(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public._record_opportunity_merge_skip(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, uuid, text, text, text) to service_role;

revoke execute on function public._record_client_merge_skip(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public._record_client_merge_skip(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, uuid, text, text, text) to service_role;
