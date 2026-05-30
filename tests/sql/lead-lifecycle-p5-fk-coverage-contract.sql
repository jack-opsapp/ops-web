-- Lead Lifecycle P5 — live FK-coverage contract (operator apply-gate check).
--
-- Run this READ-ONLY against the target DB BEFORE applying
-- 20260529170000_lead_lifecycle_p5_merge_disposition.sql. It re-derives the
-- complete reference graph to opportunities/clients live from pg_constraint
-- (enforced FKs) plus the documented unenforced mirror columns, and RAISES if
-- the live graph contains any reference NOT in the authoritative coverage set
-- the merge RPCs handle. This is the design §5.1 regression lock in its
-- authoritative (information_schema-derived) form — the vitest suite pins the
-- same set statically for CI, this asserts the set still matches the live DB.
--
-- The unit test lead-lifecycle-p5-merge-migration.test.ts asserts the RPC body
-- re-points/dedupes/supersedes/revokes every entry; this asserts the SET is
-- complete against the live schema. Both must agree.
--
-- Usage (read-only; makes no changes):
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f tests/sql/lead-lifecycle-p5-fk-coverage-contract.sql
-- A clean run prints NOTICE 'P5 FK-coverage contract: OK'. Any uncovered live
-- reference RAISES and aborts (ON_ERROR_STOP).

do $$
declare
  -- AUTHORITATIVE coverage set: every table.column the merge RPCs handle.
  -- Mirror of AUTHORITATIVE_*_REFS in the vitest suite. Keep the two in sync.
  v_opp_covered text[] := array[
    'activities.opportunity_id',
    'ai_draft_history.opportunity_id',
    'email_threads.opportunity_id',
    'estimates.opportunity_id',
    'follow_ups.opportunity_id',
    'invoices.opportunity_id',
    'opportunity_correspondence_events.opportunity_id',
    'opportunity_email_threads.opportunity_id',
    'opportunity_follow_up_drafts.opportunity_id',
    'opportunity_lifecycle_action_audit.opportunity_id',
    'opportunity_lifecycle_state.opportunity_id',
    'pending_auto_sends.opportunity_id',
    'site_visits.opportunity_id',
    'stage_transitions.opportunity_id',
    'projects.opportunity_id'  -- unenforced TEXT back-link
  ];
  v_client_covered text[] := array[
    'estimates.client_ref',
    'invoices.client_ref',
    'opportunities.client_ref',
    'site_visits.client_ref',
    'client_product_overrides.client_id',
    'email_threads.client_id',
    'projects.client_id',
    'sub_clients.client_id',
    'task_recurrences.client_id',
    'opportunities.client_id',
    'estimates.client_id',
    'invoices.client_id',
    'activities.client_id',
    'activities.suggested_client_id',
    'payments.client_id',
    'project_table_rows.client_id',
    'follow_ups.client_id',
    'site_visits.client_id',
    'portal_messages.client_id',  -- re-pointed (history)
    'portal_tokens.client_id',    -- revoked
    'portal_sessions.client_id'   -- revoked
  ];
  v_ref text;
  v_missing text[] := array[]::text[];
begin
  -- ── Enforced FKs to opportunities ──
  for v_ref in
    select src.relname || '.' || att.attname
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace n on n.oid = src.relnamespace
      join lateral unnest(con.conkey) with ordinality as ck(attnum, ord) on true
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ck.attnum
     where con.contype = 'f'
       and n.nspname = 'public'
       and tgt.relname = 'opportunities'
       and att.attname <> 'company_id'  -- composite tenant key half, not a child ref
  loop
    if not (v_ref = any(v_opp_covered)) then
      v_missing := v_missing || ('OPP ' || v_ref);
    end if;
  end loop;

  -- ── Enforced FKs to clients ──
  for v_ref in
    select src.relname || '.' || att.attname
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace n on n.oid = src.relnamespace
      join lateral unnest(con.conkey) with ordinality as ck(attnum, ord) on true
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ck.attnum
     where con.contype = 'f'
       and n.nspname = 'public'
       and tgt.relname = 'clients'
  loop
    if not (v_ref = any(v_client_covered)) then
      v_missing := v_missing || ('CLIENT ' || v_ref);
    end if;
  end loop;

  -- ── Unenforced client_id/opportunity_id-named columns that ACTUALLY hold a
  --    target id (dynamic value-match excludes portal/auth/answer columns). Any
  --    such column not in the covered set is a silent-orphan risk. ──
  for v_ref in
    select c.table_name || '.' || c.column_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name in ('client_id','suggested_client_id')
       -- not already an enforced client FK
       and not exists (
         select 1 from pg_constraint con
          join pg_class src on src.oid = con.conrelid
          join pg_class tgt on tgt.oid = con.confrelid
          join lateral unnest(con.conkey) with ordinality as ck(attnum, ord) on true
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ck.attnum
         where con.contype = 'f' and tgt.relname = 'clients'
           and src.relname = c.table_name and att.attname = c.column_name
       )
  loop
    -- Only flag columns whose populated values match a real clients.id.
    declare
      v_matches bigint;
      v_tbl text := split_part(v_ref, '.', 1);
      v_col text := split_part(v_ref, '.', 2);
    begin
      execute format(
        'select count(*) from public.%I t where t.%I is not null and t.%I::text <> '''' '
        || 'and exists (select 1 from public.clients cl where cl.id::text = t.%I::text)',
        v_tbl, v_col, v_col, v_col
      ) into v_matches;
      if v_matches > 0 and not (v_ref = any(v_client_covered)) then
        v_missing := v_missing || ('CLIENT(unenforced) ' || v_ref || ' [' || v_matches || ' live]');
      end if;
    end;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'P5 FK-coverage contract FAILED — uncovered references: %',
      array_to_string(v_missing, ', ');
  end if;

  raise notice 'P5 FK-coverage contract: OK';
end;
$$;
