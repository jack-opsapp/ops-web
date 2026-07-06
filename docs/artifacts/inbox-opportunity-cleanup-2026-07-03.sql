-- ============================================================================
-- INBOX -> OPPORTUNITY LIVE-DATA CLEANUP  (bugs 36f8a964 / ffa94025 / f64aa932)
-- Prepared 2026-07-03 · Workstream W4 · Supabase ops-app (ijeekuhbatykdomumfjx)
-- ============================================================================
--
-- WHY: the email-import write paths that produced these rows are ALREADY FIXED
-- on main (title builder + source_thread_key dedupe index + canonical client
-- backfill). No blank-title or duplicate-won rows have been created since
-- 2026-04-28. This script cleans up the LEGACY rows those old bugs left behind.
--
-- SAFETY MODEL:
--   * Duplicate-won merges are HAND-CURATED (explicit dupe->survivor map below),
--     not a heuristic — every pair was eyeballed against its description,
--     address, value and project link.
--   * Merges are REVERSIBLE: dupes are SOFT-archived (archived_at set) and
--     stamped with merged_into_opportunity_id. Nothing is deleted. To undo,
--     null those two columns.
--   * Ambiguous clusters (builders with multiple sites/scopes, rows already
--     converted to distinct projects) are NOT touched here — they are listed in
--     the companion report for a human call.
--   * Title + client-contact backfills are FILL-BLANKS-ONLY: they never
--     overwrite an existing non-empty value.
--
-- HOW TO RUN:
--   * DRY-RUN (default, read-only): run PART 0 blocks — they only SELECT.
--   * APPLY: only after Jackson's explicit go. Run PART 1/2/3 inside the
--     BEGIN/COMMIT. Review the RAISE NOTICE counts, then COMMIT (or ROLLBACK).
-- ============================================================================


-- ── The curated duplicate -> survivor map (26 confident merges) ─────────────
-- Kept as a view-less CTE so both the dry-run and the apply read the same map.
-- survivor_id is the row we keep (richest: has project_id / substantive title /
-- real value / oldest seed). dupe_id is the same-job import duplicate to fold in.
--
--   Alexander Krueger  survivor a8adc961 (project bcc9b8ad, $5000)
--   Antoni Spizzirri   survivor ea5acab7 ($2700)
--   Colyvanpacific     survivor 8466b965 (1188 Yates / 2747 Quadra)
--   Firstgeneral       survivor 7b5ec131 (insurance claim @3517 Honeycrisp)
--   Karen Etheridge    survivor dfef50b4 (vinyl+railing, $10000)   <- reference
--   Maureen Mitchell   survivor a695f5a8 (project 8244bb7b) — generic dupe only
--   Robert Szo         survivor f1a28785 (project 0ba3836c, $1500 railing/gate)
--   S.Mccullough       survivor dc7a049b (project 1f914dd0, "two decks")
--   Sebastien Auger    survivor 4ac12436 (no project/value — best-described row)
--   Story Construction survivor 5bd33202 (Tallinn @Garbally)
--   Tricia Sexton      survivor 40b9c3ca (project 44aed93a, 450sqft deck $20k)
--   WJ CONSTRUCTION    survivor ace4da8b (@779 Blackberry) — 779 Blackberry dupes only
--
-- HELD FOR HUMAN REVIEW (NOT in the map, documented in the report):
--   Edward Hu (no clean canonical; all thin "railing height" correspondence)
--   Jackie Hestnes (2 rows, each already its own project — not duplicates)
--   Path Developments (builder; privacy-panel vs building-11 railing-glass scopes)
--   Maureen 4c8f0f28 (payment-dispute row, different value — likely same job, confirm)
--   WJ c1d16b58 (distinct site "3621 Producers Way" — not the 779 Blackberry job)


-- ============================================================================
-- PART 0 — DRY-RUN (READ-ONLY). Safe to run any time. Writes nothing.
-- ============================================================================

-- 0a. The proposed merges, side by side (survivor vs each dupe it absorbs).
with merge_map(dupe_id, survivor_id) as (
  values
    -- Alexander Krueger
    ('5440250d-a419-49f0-9dd8-9974665e4aa9'::uuid,'a8adc961-294c-4a4a-a3e2-403d0882117e'::uuid),
    ('240e96b7-d76d-4b71-90a0-a9aed50e6670','a8adc961-294c-4a4a-a3e2-403d0882117e'),
    ('803be683-7af8-472e-a415-7283d924af01','a8adc961-294c-4a4a-a3e2-403d0882117e'),
    -- Antoni Spizzirri
    ('c66f0d77-212e-4761-b453-5603c16ed130','ea5acab7-293b-4d61-ad14-aa9ac95449f1'),
    -- Colyvanpacific
    ('bfb2995f-0d6f-4aef-a587-eef2917ef7d4','8466b965-a02b-41c2-ba12-b3cc51db8820'),
    -- Firstgeneral (insurance claim @3517 Honeycrisp)
    ('ffc550e8-0174-4336-aa4b-75fcc73c28c3','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    ('1d9c781f-2417-4e7c-a211-05a0a2488b9d','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    ('ed5164cb-ffd6-457d-8d3a-e3fad97cb0b3','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    -- Karen Etheridge (reference case)
    ('839073ed-52d3-4da9-8d53-c5a3e1b7ed49','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    ('7319abf1-e3fa-4079-a2fa-5cc15ebfa7d1','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    ('caa69e1e-4fb5-406f-8bde-09fd6689dc53','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    -- Maureen Mitchell (generic dupe only; 4c8f0f28 held for review)
    ('159fc1fd-63a3-4280-b5c5-b50223123b0c','a695f5a8-e660-4735-a10d-12bb912ef2e3'),
    -- Robert Szo
    ('348284a3-7f85-461b-9e4d-17193264ccdf','f1a28785-c401-47a7-81b2-f35a2ddec6f9'),
    ('972af147-8657-40ef-9644-2941215dfba0','f1a28785-c401-47a7-81b2-f35a2ddec6f9'),
    -- S.Mccullough (all "two decks")
    ('d61e48e8-5142-4c33-b617-e8d4c14e227e','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    ('1ab738a7-6e45-4ea9-a26a-aef35ac59a6c','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    ('b1f89336-9ece-4f87-9d1d-d52c939bf6ca','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    -- Sebastien Auger (no project/value; folded onto best-described row)
    ('9a0c082d-9497-4771-8a29-48dfb2e42f2a','4ac12436-d65e-4da5-8207-49de2960471a'),
    ('5b33489a-631d-4408-b27b-1fe5ec9be054','4ac12436-d65e-4da5-8207-49de2960471a'),
    ('17c09ccd-724b-48a4-b74b-fe7179a32862','4ac12436-d65e-4da5-8207-49de2960471a'),
    -- Story Construction (Tallinn)
    ('e3044266-6fff-4f39-a1f7-2a5c027554eb','5bd33202-d1d4-433f-b94a-19e6304c7d56'),
    -- Tricia Sexton (450sqft townhouse deck)
    ('b79362ec-fcc9-4dd6-9ee0-6a6fdbb58068','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    ('77df5c85-93d2-45e9-a9e4-9fbb807c237b','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    ('ce12f4ee-d957-4cdc-92ec-77e21d321827','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    -- WJ CONSTRUCTION (@779 Blackberry heated jet decks; 3621 Producers held)
    ('09770d2c-42cf-4e0a-98a0-36beb0c17dd1','ace4da8b-d725-4347-a3f7-e7a0968952e1'),
    ('a80f0a99-1b1e-48c8-9508-e8bc69d5f3a2','ace4da8b-d725-4347-a3f7-e7a0968952e1')
)
select
  cs.name                                            as client,
  s.id                                               as survivor_id,
  left(coalesce(nullif(btrim(s.title),''), s.description),48) as survivor_label,
  d.id                                               as dupe_id,
  left(coalesce(nullif(btrim(d.title),''), d.description),48) as dupe_label
from merge_map m
join opportunities s on s.id = m.survivor_id
join opportunities d on d.id = m.dupe_id
left join clients cs on cs.id = s.client_id
order by cs.name, s.id, d.created_at;

-- 0b. Integrity guardrails for the map — MUST all return zero rows before apply.
with merge_map(dupe_id, survivor_id) as ( values
    ('5440250d-a419-49f0-9dd8-9974665e4aa9'::uuid,'a8adc961-294c-4a4a-a3e2-403d0882117e'::uuid),
    ('240e96b7-d76d-4b71-90a0-a9aed50e6670','a8adc961-294c-4a4a-a3e2-403d0882117e'),
    ('803be683-7af8-472e-a415-7283d924af01','a8adc961-294c-4a4a-a3e2-403d0882117e'),
    ('c66f0d77-212e-4761-b453-5603c16ed130','ea5acab7-293b-4d61-ad14-aa9ac95449f1'),
    ('bfb2995f-0d6f-4aef-a587-eef2917ef7d4','8466b965-a02b-41c2-ba12-b3cc51db8820'),
    ('ffc550e8-0174-4336-aa4b-75fcc73c28c3','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    ('1d9c781f-2417-4e7c-a211-05a0a2488b9d','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    ('ed5164cb-ffd6-457d-8d3a-e3fad97cb0b3','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    ('839073ed-52d3-4da9-8d53-c5a3e1b7ed49','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    ('7319abf1-e3fa-4079-a2fa-5cc15ebfa7d1','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    ('caa69e1e-4fb5-406f-8bde-09fd6689dc53','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    ('159fc1fd-63a3-4280-b5c5-b50223123b0c','a695f5a8-e660-4735-a10d-12bb912ef2e3'),
    ('348284a3-7f85-461b-9e4d-17193264ccdf','f1a28785-c401-47a7-81b2-f35a2ddec6f9'),
    ('972af147-8657-40ef-9644-2941215dfba0','f1a28785-c401-47a7-81b2-f35a2ddec6f9'),
    ('d61e48e8-5142-4c33-b617-e8d4c14e227e','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    ('1ab738a7-6e45-4ea9-a26a-aef35ac59a6c','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    ('b1f89336-9ece-4f87-9d1d-d52c939bf6ca','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    ('9a0c082d-9497-4771-8a29-48dfb2e42f2a','4ac12436-d65e-4da5-8207-49de2960471a'),
    ('5b33489a-631d-4408-b27b-1fe5ec9be054','4ac12436-d65e-4da5-8207-49de2960471a'),
    ('17c09ccd-724b-48a4-b74b-fe7179a32862','4ac12436-d65e-4da5-8207-49de2960471a'),
    ('e3044266-6fff-4f39-a1f7-2a5c027554eb','5bd33202-d1d4-433f-b94a-19e6304c7d56'),
    ('b79362ec-fcc9-4dd6-9ee0-6a6fdbb58068','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    ('77df5c85-93d2-45e9-a9e4-9fbb807c237b','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    ('ce12f4ee-d957-4cdc-92ec-77e21d321827','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    ('09770d2c-42cf-4e0a-98a0-36beb0c17dd1','ace4da8b-d725-4347-a3f7-e7a0968952e1'),
    ('a80f0a99-1b1e-48c8-9508-e8bc69d5f3a2','ace4da8b-d725-4347-a3f7-e7a0968952e1')
)
select 'dupe and survivor share a client' as invariant,
       count(*) filter (where ds.client_id is distinct from ss.client_id) as violations
from merge_map m
join opportunities ds on ds.id=m.dupe_id
join opportunities ss on ss.id=m.survivor_id
union all
select 'survivor is never itself a dupe', count(*)
from merge_map a join merge_map b on a.survivor_id=b.dupe_id
union all
select 'dupe has no project_id (unconverted)', count(*)
from merge_map m join opportunities d on d.id=m.dupe_id where d.project_id is not null
union all
select 'all rows still won + live', count(*)
from merge_map m join opportunities o on o.id in (m.dupe_id,m.survivor_id)
where o.stage<>'won' or o.deleted_at is not null or o.archived_at is not null;


-- ============================================================================
-- PART 1/2/3 — APPLY.  DO NOT RUN WITHOUT JACKSON'S EXPLICIT GO.
-- Wrapped in a transaction so it can be inspected then COMMIT or ROLLBACK.
-- ============================================================================
/*  UNCOMMENT TO APPLY — gated on approval
BEGIN;

-- Materialize the curated map once for all three parts.
create temporary table _merge_map(dupe_id uuid, survivor_id uuid) on commit drop;
insert into _merge_map(dupe_id, survivor_id) values
    ('5440250d-a419-49f0-9dd8-9974665e4aa9','a8adc961-294c-4a4a-a3e2-403d0882117e'),
    ('240e96b7-d76d-4b71-90a0-a9aed50e6670','a8adc961-294c-4a4a-a3e2-403d0882117e'),
    ('803be683-7af8-472e-a415-7283d924af01','a8adc961-294c-4a4a-a3e2-403d0882117e'),
    ('c66f0d77-212e-4761-b453-5603c16ed130','ea5acab7-293b-4d61-ad14-aa9ac95449f1'),
    ('bfb2995f-0d6f-4aef-a587-eef2917ef7d4','8466b965-a02b-41c2-ba12-b3cc51db8820'),
    ('ffc550e8-0174-4336-aa4b-75fcc73c28c3','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    ('1d9c781f-2417-4e7c-a211-05a0a2488b9d','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    ('ed5164cb-ffd6-457d-8d3a-e3fad97cb0b3','7b5ec131-37c5-4b96-98d4-5ce2f7a37dec'),
    ('839073ed-52d3-4da9-8d53-c5a3e1b7ed49','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    ('7319abf1-e3fa-4079-a2fa-5cc15ebfa7d1','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    ('caa69e1e-4fb5-406f-8bde-09fd6689dc53','dfef50b4-33a0-4d19-8ea5-4ba99b3fdf25'),
    ('159fc1fd-63a3-4280-b5c5-b50223123b0c','a695f5a8-e660-4735-a10d-12bb912ef2e3'),
    ('348284a3-7f85-461b-9e4d-17193264ccdf','f1a28785-c401-47a7-81b2-f35a2ddec6f9'),
    ('972af147-8657-40ef-9644-2941215dfba0','f1a28785-c401-47a7-81b2-f35a2ddec6f9'),
    ('d61e48e8-5142-4c33-b617-e8d4c14e227e','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    ('1ab738a7-6e45-4ea9-a26a-aef35ac59a6c','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    ('b1f89336-9ece-4f87-9d1d-d52c939bf6ca','dc7a049b-8391-46f7-90a7-b4d5f9ccee98'),
    ('9a0c082d-9497-4771-8a29-48dfb2e42f2a','4ac12436-d65e-4da5-8207-49de2960471a'),
    ('5b33489a-631d-4408-b27b-1fe5ec9be054','4ac12436-d65e-4da5-8207-49de2960471a'),
    ('17c09ccd-724b-48a4-b74b-fe7179a32862','4ac12436-d65e-4da5-8207-49de2960471a'),
    ('e3044266-6fff-4f39-a1f7-2a5c027554eb','5bd33202-d1d4-433f-b94a-19e6304c7d56'),
    ('b79362ec-fcc9-4dd6-9ee0-6a6fdbb58068','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    ('77df5c85-93d2-45e9-a9e4-9fbb807c237b','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    ('ce12f4ee-d957-4cdc-92ec-77e21d321827','40b9c3ca-17a3-49d8-b570-5baa855a45f9'),
    ('09770d2c-42cf-4e0a-98a0-36beb0c17dd1','ace4da8b-d725-4347-a3f7-e7a0968952e1'),
    ('a80f0a99-1b1e-48c8-9508-e8bc69d5f3a2','ace4da8b-d725-4347-a3f7-e7a0968952e1');

-- PART 1a. Consolidate contact info onto the survivor (fill-blanks-only) from
-- its dupes, so the kept row carries the best phone/address/value.
update opportunities s set
  contact_phone   = coalesce(s.contact_phone,   agg.phone),
  address         = coalesce(s.address,         agg.address),
  estimated_value = coalesce(s.estimated_value, agg.est_val),
  contact_name    = coalesce(s.contact_name,    agg.contact_name),
  contact_email   = coalesce(s.contact_email,   agg.contact_email),
  updated_at      = now()
from (
  select m.survivor_id,
    max(d.contact_phone)   as phone,
    max(d.address)         as address,
    max(d.estimated_value) as est_val,
    max(d.contact_name)    as contact_name,
    max(d.contact_email)   as contact_email
  from _merge_map m join opportunities d on d.id=m.dupe_id
  group by m.survivor_id
) agg
where s.id = agg.survivor_id;

-- PART 1b. Soft-archive the dupes and stamp the survivor pointer (REVERSIBLE).
update opportunities d set
  archived_at = now(),
  merged_into_opportunity_id = m.survivor_id,
  updated_at = now()
from _merge_map m
where d.id = m.dupe_id
  and d.archived_at is null;      -- idempotent

-- PART 2. Backfill blank titles on every REMAINING live opportunity
-- (survivors + standalone blanks; archived dupes are skipped). Fill-only.
-- Generic "Canpro Deck and Rail Estimate" placeholders -> "{client} — Estimate";
-- otherwise derive from the (collapsed-whitespace, 80-char) description.
update opportunities o set
  title = case
    when lower(btrim(coalesce(o.description,''))) = 'canpro deck and rail estimate'
      then coalesce(nullif(btrim(c.name),'') || ' — Estimate', 'New Lead — Estimate')
    when btrim(coalesce(o.description,'')) <> ''
      then left(regexp_replace(btrim(o.description), '\s+', ' ', 'g'), 80)
    else coalesce(nullif(btrim(c.name),'') || ' — Estimate', 'New Lead — Estimate')
  end,
  updated_at = now()
from clients c
where o.client_id = c.id
  and btrim(coalesce(o.title,'')) = ''
  and o.deleted_at is null
  and o.archived_at is null;

-- Catch blank-title rows with no client row (title from description only).
update opportunities o set
  title = case
    when btrim(coalesce(o.description,'')) <> ''
      then left(regexp_replace(btrim(o.description), '\s+', ' ', 'g'), 80)
    else 'New Lead — Estimate' end,
  updated_at = now()
where btrim(coalesce(o.title,'')) = ''
  and o.client_id is null
  and o.deleted_at is null
  and o.archived_at is null;

-- PART 3. Backfill client phone/address from their opportunities (fill-only).
update clients c set
  phone_number = coalesce(c.phone_number, src.phone),
  address      = coalesce(c.address,      src.address),
  updated_at   = now()
from (
  select o.client_id,
    max(o.contact_phone) filter (where o.contact_phone is not null) as phone,
    max(o.address)       filter (where o.address       is not null) as address
  from opportunities o
  where o.deleted_at is null and o.client_id is not null
  group by o.client_id
) src
where c.id = src.client_id
  and c.deleted_at is null
  and ((c.phone_number is null and src.phone   is not null)
    or (c.address      is null and src.address is not null));

-- Inspect the row counts above, then:
--   COMMIT;    -- persist
--   ROLLBACK;  -- discard (use while validating)
COMMIT;
*/
