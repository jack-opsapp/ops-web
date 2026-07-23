-- Cast site_visits.company_id to text in the opportunity-merge re-point.
--
-- Prod's `site_visits.company_id` is a legacy TEXT column (Bubble-era), unlike
-- every other table this function re-points (all uuid). The site_visits
-- re-point compared that text column directly to the uuid parameter
-- `p_company_id`, so Postgres raised `operator does not exist: text = uuid`
-- (SQLSTATE 42883) and aborted the whole function, failing every opportunity
-- merge. Discovered 2026-07-22 while running the outage-repair duplicate merge
-- in production.
--
-- Fix: add an explicit `::text` cast to the parameter in the site_visits WHERE
-- clause, mirroring the pattern the adjacent `projects` back-link already uses
-- for its own legacy text column. This is the ONLY hazard column the function
-- touches; a full prod audit confirmed all other referenced tables use uuid ids
-- and `projects` is already casted. CREATE OR REPLACE preserves the function's
-- existing ACLs (no grant/revoke changes).

begin;

CREATE OR REPLACE FUNCTION public.execute_opportunity_merge_guarded_internal(p_company_id uuid, p_winner_id uuid, p_loser_id uuid, p_merge_key text, p_review_id uuid DEFAULT NULL::uuid, p_expected_winner_stage text DEFAULT NULL::text, p_expected_loser_stage text DEFAULT NULL::text, p_field_fill jsonb DEFAULT '{}'::jsonb, p_confirmed_overrides jsonb DEFAULT '{}'::jsonb, p_resolved_by uuid DEFAULT NULL::uuid, p_run_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   where opportunity_id = p_loser_id and company_id = p_company_id::text;
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
$function$;

commit;
