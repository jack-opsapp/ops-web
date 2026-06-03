# Won → Project Conversion: Dedup + Auto Project Naming — Design Spec

**Date:** 2026-06-03
**Status:** Draft for review
**Surfaces:** OPS-Web (now) · OPS-iOS (next App Store release) · Supabase (shared substrate)
**Initiative:** WON CONVERSION — dedup + auto-naming

---

## 1. Problem

When an operator marks a pipeline deal **won** on web, the convert-to-project step is silent and thin. Three concrete failures:

1. **No existing-project check.** The web convert path (`ProjectConversionService.convertOpportunityToProject` → `execute_opportunity_project_conversion_guarded`) only checks whether **this exact lead** already converted (`opportunities.project_ref`). It never checks whether the **client** already has a project — including the very project this lead is about. A repeat client, or a lead that references an existing job, silently spawns a duplicate project.

2. **Poor naming.** `project.title = opportunity.title ?? "Untitled project"`. Lead titles are frequently auto-generated from email subjects, so won projects inherit junk names.

3. **Lost data on conversion.** The web path carries `address` but **drops `latitude`/`longitude`** (map pin is dead until re-geocoded) and — unlike iOS — **does not materialize estimate LABOR line items into `project_tasks`, nor attach site-visit photos**. Web-won projects arrive emptier than iOS-won ones.

### Root cause: two divergent conversion paths

| | iOS | Web |
|---|---|---|
| Convert RPC | `convert_lead_to_project` (inserts project + tasks + photos + stage transition) | `execute_opportunity_project_conversion_guarded` (links pre-created project + estimate relink + disposition) |
| Dedup check | UI-only, **local SwiftData cache** (`clientProjectsSummary`, `existingProject`) | none beyond `project_ref` |
| Naming | operator types `title` + `address` in `ConvertToProjectSheet` (default `opp.title \|\| contactName`) | `opp.title` verbatim |
| Tasks / photos | materialized | **not** materialized |
| Disposition row + 4-column link contract | not written | written |

The two RPCs each do things the other doesn't. iOS's dedup is also **incomplete** — a `FetchDescriptor` over locally-synced projects misses any project the device hasn't pulled (new device, partial sync, another operator's just-created project).

---

## 2. Goals / Non-goals

### Goals
- **No duplicate projects.** At win time, surface any existing/likely-duplicate project for the client and let the operator **link instead of create**.
- **Always-automatic naming.** Project name is a **live pointer to the site address**. The operator never has to touch it; it self-heals as the address becomes known. Same rule on every surface.
- **One shared brain.** Dedup detection and the naming rule live in the **database**, called by both platforms — drift becomes impossible.
- **One canonical convert transaction** (Phase 3, in scope): a single superset RPC replaces both existing RPCs. Web switches immediately; iOS on its next release; un-updated iOS keeps working via a shim that routes through the same logic.
- **Close the web data gaps:** carry `latitude`/`longitude`; materialize tasks; attach site-visit photos.

### Non-goals
- Reworking the daily `duplicate-scan` cron (it stays as the reactive janitor). We *do* converge its normalization onto the new SQL normalizers (§6.1) so detection can't drift — but its scheduling/merge UX is untouched.
- Changing the pipeline stage model, win-probability, or lost flow.
- Backfilling historical projects into auto-naming (existing names are left exactly as-is; see §7.3).

---

## 3. Architecture overview

```
                         ┌─────────────────────────────────────────────┐
                         │                  Supabase                    │
                         │                                              │
  Web (now) ───┐         │  ┌────────────────────────────────────────┐  │
               ├──────────► │ get_conversion_preflight()  [READ-ONLY] │  │
  iOS (next) ──┘         │  │  → existing_linked, duplicate_candidates │  │
                         │  │    other_client_projects, suggested_name │  │
                         │  └────────────────────────────────────────┘  │
                         │                                              │
  Web (now) ───┐         │  ┌────────────────────────────────────────┐  │
               ├──────────► │ convert_opportunity_to_project()  [WRITE]│  │
  iOS (next) ──┘         │  │  superset txn: insert project+links+      │  │
  iOS (old) ──[shim]──────► │  estimates+tasks+photos+disposition+      │  │
                         │  │  stage_transition  (or link existing)     │  │
                         │  └────────────────────────────────────────┘  │
                         │                                              │
                         │  ┌────────────────────────────────────────┐  │
                         │  │ projects naming trigger  [BEFORE I/U]   │  │
                         │  │  title follows address while title_is_auto│  │
                         │  └────────────────────────────────────────┘  │
                         └─────────────────────────────────────────────┘
```

Three new database objects (all additive → iOS-safe):
1. **`projects.title_is_auto`** — per-project flag: is the name auto-managed (pointer) or hand-set?
2. **Naming trigger + `derive_project_name()`** — keeps `title` tracking `address` while `title_is_auto`.
3. **`get_conversion_preflight()`** (read) + **`convert_opportunity_to_project()`** (write) — the shared conversion brain.

Plus SQL normalizers (`private.normalize_address`, `private.normalize_title`) as the single source of truth for matching.

---

## 4. The naming model — "title is a pointer to address"

### 4.1 Behavior

`projects.title` becomes an **auto-managed pointer** to `projects.address`. While `title_is_auto = true`, any write that changes the address (or client) re-derives the name. The moment an operator types their own name, `title_is_auto` flips to `false` and the name freezes.

**Fallback chain (and it self-heals upward as data arrives):**

| State | Auto name |
|---|---|
| Address present | **Street line** → `1240 W 6th Ave` |
| No address, client known | **`{Client}'s Project`** *(copy via `ops-copywriter`)* |
| No address, no client | **`New project`** |

A project born `Acme's Project` (no address) **automatically becomes `1240 W 6th Ave`** the instant anyone — web, iOS, or the email-lifecycle backfill — fills in the address. No operator action.

### 4.2 Name collisions → silent `#N` (auto names only)

When the trigger derives a base name that already exists for another non-deleted project **in the same company**, it appends the **lowest free** suffix: `1240 W 6th Ave #2`, `#3`, … Silent, because the operator never typed it.

- **Hand-set names are never silently mutated.** If an operator *types* a name that collides, the UI shows a `DUPLICATE NAME` warning (iOS already has this; web adds parity) and the operator decides. Only auto-pointer names get the silent `#N`.
- **Accepted edge:** if the `#1` (base) project later changes address, its sibling keeps `#2` (no proactive renumber). Harmless; self-corrects only if that sibling's address is itself re-derived. Renumbering siblings is intentionally *not* done (avoids rename cascades).

### 4.3 Why the database, not app code

Address is written from many places: the Won conversion, the web project workspace, the iOS form, and **automated email-lifecycle backfill** (`10_JOB_LIFECYCLE…` P2 fills blank fields as info arrives). Only a **trigger** catches every writer. App-layer logic would have to be re-implemented in each path and would drift — the exact failure we're eliminating. The trigger makes "name follows address" a true invariant for free, including for iOS writes and server automation, with **no iOS release required** for web-created auto-named projects to behave correctly.

### 4.4 Schema change

```sql
ALTER TABLE public.projects
  ADD COLUMN title_is_auto boolean NOT NULL DEFAULT false;
```

- **Default `false` (hand-set) is the safe default** — a naive insert (including the iOS app currently in the field, which knows nothing of this column) is treated as a hand-set name and the trigger never touches it. **No operator-typed name can ever be clobbered.**
- Auto-naming is **opt-in**, set `true` only by the creation/conversion paths we control. iOS opts in fully on its next release.
- Existing rows: backfilled `false` (see §7.3). Additive + nullable-equivalent default → **iOS-safe** per the sync constraint (iOS reads it as unknown/ignored).

### 4.5 `derive_project_name()` (pure base name, no suffix)

```sql
CREATE FUNCTION private.derive_project_name(p_address text, p_client_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NULLIF(btrim(p_address), '') IS NOT NULL
      THEN NULLIF(btrim(split_part(p_address, ',', 1)), '')          -- street line
    WHEN NULLIF(btrim(p_client_name), '') IS NOT NULL
      THEN btrim(p_client_name) || '''s Project'                      -- copy TBD
    ELSE 'New project'
  END;
$$;
```

- **Street-line parse:** substring before the first comma, trimmed. Mapbox autocomplete stores comma-delimited addresses, so this is reliable; a manually-typed non-comma address falls back to using the whole string (still a fine name). If `split_part` yields empty, fall through to client/placeholder.
- The `#N` suffix is **not** here (it needs DB/company scope) — it's applied in the trigger.
- Exact copy for `{Client}'s Project` and `New project` is finalized via **`ops-copywriter`** in the OPS voice (`Acme Inc.'s Project` reads awkwardly).

### 4.6 Naming trigger

`BEFORE INSERT OR UPDATE ON public.projects FOR EACH ROW`, runs only when:
- `NEW.title_is_auto = true`, **and**
- `TG_OP = 'INSERT'`, or `NEW.address IS DISTINCT FROM OLD.address`, or `NEW.client_id IS DISTINCT FROM OLD.client_id`, or the flag just flipped to auto.

Logic:
1. `v_client_name := (SELECT name FROM clients WHERE id = NEW.client_id)` when `client_id` set.
2. `v_base := private.derive_project_name(NEW.address, v_client_name)`.
3. Collision: if any non-deleted project in `NEW.company_id` (excluding `NEW.id`) has `title = v_base`, find the lowest `N ≥ 2` such that `v_base || ' #' || N` is free; else use `v_base`.
4. `NEW.title := <resolved>`.

- **Silent:** the trigger only sets `title`. It writes **no** `project_notes` activity row and dispatches **no** notification. Auto-renames are invisible; only the operator's address edit is the meaningful event.
- **Concurrency:** at current tenancy (2 active companies) suffix races are negligible. A `pg_advisory_xact_lock(hashtext(company_id || base))` guard is specced as a hardening follow-up, not a blocker; the daily dedup-scan is the backstop.

---

## 5. Read-only preflight — `get_conversion_preflight()`

The shared detection brain. Both platforms call it before converting.

**Signature**
```sql
get_conversion_preflight(p_opportunity_id uuid, p_company_id uuid DEFAULT NULL)
RETURNS jsonb
```
- Auth: service_role trusts `p_company_id`; otherwise company derived from JWT (`private.get_user_company_id()`), `pipeline.manage` required. Read-only, no writes.

**Returns**
```jsonc
{
  "existing_linked_project": { "id": "...", "title": "..." } | null,  // this opp already converted
  "duplicate_candidates": [                                            // likely SAME job
    { "project_id": "...", "title": "...", "address": "...",
      "confidence": "high" | "medium", "signals": ["same_client","same_address"] }
  ],
  "other_client_projects": [                                           // CLIENT-HAS-OTHERS
    { "project_id": "...", "title": "...", "address": "...", "status": "..." }
  ],
  "suggested_name": "1240 W 6th Ave"                                   // derive_project_name preview
}
```

**Matching rules** (reuse the daily scan's semantics, now in SQL via §6.1 normalizers):
- `duplicate_candidates`: non-deleted projects in the company, not already linked to this opp, where `normalize_address(project.address) = normalize_address(opp.address)`:
  - same `client_id` ⇒ **high**, signals `[same_client, same_address]`
  - different/unknown client ⇒ **medium**, signals `[same_address]`
  - (no address on the opp ⇒ no address-based candidates; rely on `other_client_projects`)
- `other_client_projects`: all non-deleted projects for `opp.client_id`, excluding `existing_linked_project` and anything already in `duplicate_candidates`.
- `suggested_name`: `derive_project_name(opp.address, client.name)` (base, pre-suffix) for dialog display.

---

## 6. Write path — `convert_opportunity_to_project()` (the unified superset)

Replaces **both** `convert_lead_to_project` and `execute_opportunity_project_conversion_guarded`. One transaction; all-or-nothing.

**Signature**
```sql
convert_opportunity_to_project(
  p_company_id        uuid,
  p_opportunity_id    uuid,
  p_actual_value      numeric  DEFAULT NULL,
  p_expected_stage    text     DEFAULT NULL,   -- snapshot guard
  p_decided_by        uuid     DEFAULT NULL,
  p_notes             text     DEFAULT NULL,    -- approval-queue scope seed
  p_title_override    text     DEFAULT NULL,    -- operator typed a name → hand-set
  p_link_to_project_id uuid    DEFAULT NULL,    -- link existing instead of create
  p_source_path       text     DEFAULT NULL,    -- 'won_dialog' | 'approval_queue' | 'ios'
  p_evidence          jsonb    DEFAULT '{}'
) RETURNS jsonb
```

**Transaction steps**
1. **Auth:** `service_role` ⇒ trust `p_company_id`; else company from JWT must match, and `private.current_user_has_permission('pipeline.manage','all')`. (Superset of both RPCs' auth — supports web's service-role API route *and* iOS's direct user-JWT call.)
2. **Lock** opportunity `FOR UPDATE`; not found ⇒ `P0002`; `deleted_at` set ⇒ error.
3. **Idempotency:** `project_ref` already set ⇒ return `{converted:false, already_converted:true, project_id: project_ref}`.
4. **Snapshot guard:** `p_expected_stage` provided and `stage <> p_expected_stage` ⇒ `{converted:false, guard_reason:'snapshot_mismatch'}`.
5. **Branch — link existing** (`p_link_to_project_id` provided): validate it's a non-deleted project in scope; skip insert; go to step 7 using it as the project.
6. **Branch — create** (default): `INSERT INTO projects` with
   - `title_is_auto := (p_title_override IS NULL)`, `title := COALESCE(p_title_override, 'New project')` *(trigger overwrites when auto)*
   - `address`, **`latitude`, `longitude`** (← fixes the dropped-geocode gap), `client_id`, `company_id`
   - `opportunity_id` (text mirror), `opportunity_ref` (uuid)
   - `status := 'accepted'`, `source`, `estimated_value := COALESCE(p_actual_value, opp.actual_value, opp.estimated_value)`, `platform_metadata`, `created_by := p_decided_by`
   - The **naming trigger** fires here and sets the final auto name (street line / fallback / `#N`).
7. **Four-column link contract** on the opportunity: `project_ref` + `project_id` (uuid), guarded `WHERE project_ref IS NULL` (defence-in-depth vs concurrent win).
8. **Re-link estimates:** `project_ref` (uuid) **and** `project_id` (text mirror) `WHERE opportunity_id = opp` — the web `EstimateService` reads `estimates.project_id` (text), so the mirror is mandatory (per the guarded RPC's documented Design Risk 6).
9. **Materialize tasks:** LABOR `line_items` of the opp's estimates → `project_tasks` (carried verbatim from `convert_lead_to_project`: `task_type_id`, `custom_title`, `source_line_item_id`, `source_estimate_id`, duration/color from `task_types`). *On link-existing, only when the target project has no tasks yet — avoid double-materializing.*
10. **Attach photos:** non-deleted `site_visits.photos[]` for the opp → `project_photos` (`source='site_visit'`, `site_visit_id` back-link, `uploaded_by = sv.created_by`, `is_client_visible=false`). *Link-existing: same no-duplicate guard.*
11. **Disposition:** supersede prior active dispositions; insert `'converted_to_project'` with `converted_project_ref` + evidence (`source_path`, `actual_value`, `relinked_estimates`, `linked_existing`).
12. **Update opportunity:** `stage='won'`, `stage_entered_at=now()`, `stage_manually_set=true`, `actual_value`, `actual_close_date`.
13. **Stage transition:** insert `(from_stage, 'won', duration_in_stage)`.
14. **Return** `{converted, project_id, already_converted:false, disposition_id, relinked_estimates, materialized_tasks, attached_photos, linked_existing}`.

### 6.1 SQL normalizers (single source of truth)

Port `normalizeAddress` / `normalizeTitle` from `src/lib/utils/name-normalization.ts` into `private.normalize_address()` / `private.normalize_title()`. The preflight uses them. **The web TS matcher and the daily `duplicate-detection-service` are refactored to call these via RPC (or are covered by shared test vectors)** so there is exactly one normalization definition. *(If converging the daily scan proves large, it may land as an immediate fast-follow PR — but the preflight and scan must agree on day one via shared test vectors.)*

### 6.2 RPC transition / shim

- **Web:** `ProjectConversionService` calls `convert_opportunity_to_project` directly; stop pre-creating the bare project. `execute_opportunity_project_conversion_guarded` loses all callers (web `approval-queue-service` switches too) → **drop** after web ships.
- **Old iOS (in the field):** rewrite `convert_lead_to_project` as a **thin shim** that calls the unified RPC (`p_title_override := p_title`, `p_source_path := 'ios'`) and returns the project uuid. Un-updated iOS immediately gets the consistent link contract + disposition + (its existing) tasks/photos, with operator-typed names preserved (`title_override` ⇒ hand-set). **No iOS release needed for old clients to converge.**
- **New iOS (next release):** calls `get_conversion_preflight` (server dedup, fixes the local-cache miss) + `convert_opportunity_to_project` directly; sets `title_is_auto` correctly (auto when operator didn't type a name). The shim can then be dropped once telemetry shows no old-RPC calls.

---

## 7. Surface changes

### 7.1 Web (ships now)
- **`project-conversion-service.ts`:** call the unified RPC; remove bare-project pre-create + orphan-cleanup dance (the RPC is atomic). Add `getConversionPreflight()` + `linkOpportunityToExistingProject()`.
- **`use-opportunities.ts`:** preflight query before opening the Won dialog; `convert` and `linkExisting` mutations.
- **Enriched Won dialog (`stage-transition-dialog.tsx`):** final value (as today) **+** auto-name display (`Name: 1240 W 6th Ave` with a quiet *rename* escape hatch that sets `title_is_auto=false`) **+** address prefill (editable, Mapbox autocomplete) **+** when preflight returns candidates/other-projects: a compact list with **Link** (per row) vs **Create new** — mirroring iOS's DUPLICATE-EXISTS / CLIENT-HAS-OTHERS states. All copy via `ops-copywriter`; styling via `ops-design-system` (glass-dense modal, accent on the single primary CTA, mono numerics).
- **Manual project create/edit form** (`project-edit-create-body.tsx`, FAB → create): the name field becomes **optional** — the same auto-naming applies, driven by the *same DB trigger* (manual create is a plain `projects` insert, so no extra logic).
  - **Zod:** `title` drops `.min(1)` in creating mode (keep `.max(200)`); `titleRequired` retired. Submit is allowed with a blank name.
  - **Blank name ⇒ `title_is_auto=true`**; the trigger names it (street line → `{Client}'s Project` → `New project`). The field renders a **live auto-name preview** (placeholder showing the street line forming from the entered address) so the operator sees the name without typing — no setup, invisible.
  - **Typed name ⇒ `title_is_auto=false`** (frozen); add the `DUPLICATE NAME` warning for hand-set collisions (iOS parity).
  - **Editing mode symmetry:** clearing the name field reverts the project to auto (`title_is_auto=true`, trigger refills from address); typing one sets it custom again.
  - **Reliability:** this surface only accepts geocoded Mapbox-autocomplete addresses (address always travels with lat/lon), so the street-line parse and the map pin are both reliable on created projects.
  - **Service plumbing:** `ProjectService.createProject` / `updateProject` + `mapToDb` carry `title_is_auto`; `title` becomes optional on the create input (DB `title` stays NOT NULL — the BEFORE-INSERT trigger fills it before the constraint check).
- **Notifications:** keep the "Project created" rail notification on create; on link-existing, no new-project notification (the project already existed).
- **Permissions:** `pipeline.manage` for convert/link; preflight same. No role filtering.

### 7.2 iOS (next App Store release)
- **`LeadConversionService`:** replace local `existingProject`/`clientProjectsSummary` with `get_conversion_preflight`; call `convert_opportunity_to_project` directly; set `title_is_auto`.
- **`ConvertToProjectSheet`:** drive DUPLICATE-EXISTS / CLIENT-HAS-OTHERS from the server preflight; the name field shows the auto name with rename → `title_is_auto=false`.
- **`ProjectFormSheet`:** already has `DUPLICATE NAME`; wire `title_is_auto` on create/edit.

### 7.3 Migration & rollout (low-tenant prod)

Per the low-tenant authorization (Canpro + Maverick only; direct prod migrations approved with read-only recon + explicit go-ahead before live-data writes):

1. **DB migration (additive, safe):** add `title_is_auto` (default `false`), `derive_project_name`, normalizers, naming trigger, preflight RPC, unified convert RPC, shim over `convert_lead_to_project`. Recon read-only first; sentinel-rollback tested on a scratch row; explicit go-ahead before applying.
2. **Backfill:** existing projects → `title_is_auto = false` (column default already does this). **No existing name changes.** *(Optional, deferred, opt-in only: a guarded backfill that flips to `true` for projects whose `title` already equals their derived address name — left out of v1 to guarantee zero surprise renames.)*
3. **Web deploy:** switch to unified RPC + enriched dialog. (ops-web auto-deploy is OFF — production deploy is manual.)
4. **Drop** `execute_opportunity_project_conversion_guarded` once web is live and verified.
5. **iOS:** ship the preflight + unified-RPC adoption in the next release; retire the shim after old-RPC traffic hits zero.

---

## 8. Edge cases & risks

| # | Case | Handling |
|---|---|---|
| 1 | Operator-typed name clobbered by trigger | Impossible — `title_is_auto` defaults `false`; trigger only touches auto names. |
| 2 | iOS in the field unaware of the flag | Inserts default to `false` ⇒ manual ⇒ untouched. Shim routes old converts through unified logic without a release. |
| 3 | Two unnamed projects, same client, no address | Both `{Client}'s Project` → `#2`. Self-heal when addresses arrive; dedup-scan backstop. |
| 4 | Placeholder names polluting dedup | `normalize_title` treats `New project` / `{Client}'s Project` as empty ⇒ no false `same_title` matches. |
| 5 | Same address, genuinely different jobs (repeat customer) | Operator sees the candidate, chooses **Create new** ⇒ `#2` disambiguates names. |
| 6 | Suffix race under concurrency | Negligible at current tenancy; advisory-lock hardening specced; dedup-scan catches stragglers. |
| 7 | Estimate text-mirror omitted | Unified RPC writes both `project_ref` and `project_id` (text) — web Estimates tab keys off the text column. |
| 8 | Geocode lost on convert | Unified RPC carries `latitude`/`longitude` from the opportunity. |
| 9 | Link-existing double-materializes tasks/photos | Guard: only materialize when the target project has none. |
| 10 | Address re-parse on a weird format | Non-comma address falls back to whole string; operator can rename (freezes). |

---

## 9. Testing

- **Unit (SQL/TS):** `derive_project_name` (street line, client fallback, placeholder, empty); `#N` suffix (lowest-free, hand-set untouched); `normalize_address/title` parity with the existing TS matcher (shared vectors).
- **Integration:** unified RPC create path (links + estimates text-mirror + tasks + photos + disposition + stage transition + geocode carry); idempotency; snapshot mismatch; link-existing branch; shim mapping. Trigger: insert auto-name, address-change self-heal, flag-flip freeze, silence (no activity row).
- **Preflight:** existing-linked, high/medium candidates, other-client-projects, suggested_name.
- **E2E (web):** Won dialog — clean create (auto-name from address), no-address create (`{Client}'s Project`) then add address → rename self-heals, DUPLICATE-EXISTS link, CLIENT-HAS-OTHERS link-vs-create, hand-set duplicate warning.
- **E2E (web), manual create:** submit the project form with a **blank name** (was previously blocked) → project auto-named from address; blank name + no address → `New project`; add address later → name self-heals; clearing a custom name in editing mode reverts to auto.

## 10. Bible updates (same session)
- `09_FINANCIAL_SYSTEM.md` — replace the "web has no `LeadConversionService` equivalent" note (now stale); document the unified `convert_opportunity_to_project` + `get_conversion_preflight` + the shim.
- `10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md` § won — auto-naming pointer model + dedup-at-convert.
- `03_DATA_ARCHITECTURE.md` — `projects.title_is_auto` + naming trigger invariant.

## 11. Open items for `ops-copywriter`
- `{Client}'s Project` possessive form and the `New project` placeholder.
- Won-dialog labels: auto-name display, "rename", Link vs Create new, duplicate-name warning.
