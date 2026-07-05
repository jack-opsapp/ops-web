# W3 — Security Posture Sweep — Per-Item Disposition

**Date:** 2026-07-03 · **Branch:** `fix/security-posture-sweep` · **DB:** `ops-app` (`ijeekuhbatykdomumfjx`, prod)
**Bug:** `c5ff388e-37dd-4b32-8009-7a78ed675748` (HIGH) — "31 public tables have RLS disabled"

## 0. Execution log (2026-07-03, post-approval)

**Batch 1 (M1–M4) + M6 APPLIED to prod on operator approval.** Verified live; smoke check clean — a live Canpro admin still sees 332 projects / 407 photos / 395 clients / 437 opportunities (untouched company-isolation policies healthy; photo write/upload policies intact). **Advisor delta: 167 → 149 lints.**

| # | Migration | Applied | Verified effect |
|---|-----------|---------|-----------------|
| M1 | fix_always_true_policies | ✅ | qa_bugs operator-only (end-to-end `SET ROLE anon`: operator 234 rows, member 0, raw anon 0); beta own-rows; duplicate own-company |
| M2 | storage_public_bucket_listing | ✅ | 6 listing policies dropped; public image serving intact (photo write policies present) |
| M3 | revoke_anon_execute_functions | ✅ | all 7 functions `anon_exec=false, auth_exec=false` (ground truth); service_role retains the 5 non-trigger fns |
| M4 | revoke_anon_grants_asc_tables | ✅ | 8 `asc_*` tables anon-locked |
| M6 | revoke_anon_grants_asc_conversion_daily | ✅ | **New finding during verification** — a 9th App Store object, the `asc_conversion_daily` **security_invoker view**, still carried anon/authenticated grants. It was anon-readable before the sweep; M4 (locking the base tables) already closed the read path transitively, and M6 removes the vestigial view grant. `asc_*` now fully anon-locked (0 residual). |

**Category delta:** `public_bucket_allows_listing` 6→0; `rls_policy_always_true` 14→12 (qa_bugs + duplicate_reviews de-flagged; **beta_access_requests stays flagged for its intentional public-signup INSERT** — kept by design); `anon_security_definer` 51→46 and `authenticated_security_definer` 61→56 (the 5 non-trigger revokes; the 2 trigger functions are also locked per `has_function_privilege`, advisor count lags on cache); `rls_enabled_no_policy` 26 unchanged (the intended locked state).

**Batch 2 (M5) — CORRECTED, re-verified, NOT applied (awaiting operator go).** The iOS caller check (`DataController.deleteUserAccount`, ops-ios) revealed `remove_seated_employee`'s only caller is account **self-deletion** cleanup — best-effort, run *after* the user's own row is soft-deleted — NOT admin "remove teammate" (which uses a direct `seated_employee_ids` update). The original admin-gate guard was therefore wrong (would have softly broken seat cleanup on self-deletion). **Retargeted** to "only remove a seat for an already-soft-deleted member." Re-sentinel (rolled back): active member → BLOCKED, soft-deleted member → ALLOWED, cross-company density → 0, own-company density → 242. `get_inbox_density_per_client` confirmed web-only (zero iOS callers) and safe.

---

## 1. The reported bug is stale — RLS is universally enabled

Live query (2026-07-03):

```sql
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
--> 0     (266 public tables total, 266 with RLS enabled)
```

The literal finding — 31 public tables with RLS disabled — is fully remediated. RLS was enabled everywhere at some point after the bug was filed (2026-05-07). The bug is closed on that evidence. The rest of this sweep addresses the **current** advisor posture the bug has effectively morphed into.

## 2. Current `get_advisors(type=security)` posture

167 security lints (levels: 141 WARN, 26 INFO):

| Lint | Count | In mission scope | Handled by |
|------|-------|------------------|-----------|
| `authenticated_security_definer_function_executable` | 61 | — (superset of the anon set) | resolved with the anon revokes |
| `anon_security_definer_function_executable` | 51 | ✓ | M3 (revoke ×7), M5 (harden ×2), rest documented KEEP |
| `rls_enabled_no_policy` | 26 | ✓ | all service-role-only; M4 hardens `asc_*` grants |
| `rls_policy_always_true` | 14 | ✓ | M1 (fix ×3), rest documented KEEP/cross-app |
| `public_bucket_allows_listing` | 6 | ✓ | M2 (drop 6 list policies) |
| `function_search_path_mutable` | 4 | bonus | documented (private-schema, low risk) |
| `extension_in_public` | 4 | bonus | documented (moving extensions is not additive) |
| `auth_leaked_password_protection` | 1 | bonus | recommend Jackson enable (dashboard toggle) |

## 3. Migrations authored (all sentinel-proven, none applied — awaiting operator go)

| File | Change | Risk tier |
|------|--------|-----------|
| `20260703170000_sec_w3_fix_always_true_policies.sql` | qa_bugs → operator-only; beta_access_requests → own-rows; duplicate_reviews INSERT → own-company | **Batch 1** (verified safe) |
| `20260703170100_sec_w3_storage_public_bucket_listing.sql` | drop 6 broad `storage.objects` SELECT list policies | **Batch 1** |
| `20260703170200_sec_w3_revoke_anon_execute_functions.sql` | revoke anon/auth EXECUTE on 7 internal/server functions | **Batch 1** |
| `20260703170300_sec_w3_revoke_anon_grants_asc_tables.sql` | revoke anon/auth table grants on 8 `asc_*` tables | **Batch 1** |
| `20260703170400_sec_w3_harden_secdef_function_bodies.sql` | add caller guards to `get_inbox_density_per_client` + `remove_seated_employee` | **Batch 2** (needs iOS seat-flow nod) |

**Constraint honored throughout:** the app (web + iOS) executes as the **anon** role under the Firebase JWT bridge. `auth.uid()` is unusable (`sub` is a non-uuid Firebase UID). All scoping uses `private.get_user_company_id()` (uuid) / `private.get_current_user_id()` (uuid) / `private.is_ops_admin()` / `private.current_user_is_admin()`, which match `users.auth_id OR users.firebase_uid = jwt sub`. `service_role` and `postgres` carry `rolbypassrls=true` (verified), so cron/agent writes survive removing anon policies.

---

## 4. `rls_policy_always_true` — 14 policies (12 tables)

The linter flags any policy whose `USING`/`WITH CHECK` is a bare `true`. Severity depends entirely on the command: an INSERT/`WITH CHECK(true)` is write-only public ingestion (no read exposure); a SELECT/UPDATE/ALL `true` is a real leak. Split:

| Table · policy | Cmd | Owner | Disposition | Why |
|---|---|---|---|---|
| **qa_bugs** · "Service role full access" | ALL | ops-web (QA) | **FIX → operator-only** (M1) | `ALL/true/{public}` = full anon CRUD **incl. DELETE** on 234 rows (DOM snapshots, console errors). Writers are service_role (bug-triage crons) + postgres (agents) — both bypass RLS. |
| **beta_access_requests** · "beta_requests_select" | SELECT | ops-web | **FIX → own-rows** (M1) | `SELECT/true` leaked every request's `user_email`/`user_name`/`company_name`. Client hook reads `.eq(user_id)`; admin reads via service_role route. |
| **duplicate_reviews** · "Service role can insert" | INSERT | ops-web | **FIX → own-company** (M1) | `INSERT/true` let any anon insert a review for any company. SELECT/UPDATE already company-scoped (crit3). |
| analytics_events · client_insert | INSERT | growth | KEEP | Write-only anonymous analytics ingestion; no read-back. |
| newsletter_subscribers · anon signup | INSERT | marketing | KEEP | Public signup form; write-only. |
| onboarding_analytics · anon inserts | INSERT | growth | KEEP | Ingestion; write-only. |
| tutorial_analytics · anon/auth inserts (×2) | INSERT | ops-learn | KEEP | Ingestion; write-only. |
| beta_access_requests · beta_requests_insert | INSERT | ops-web | KEEP | Public feature-request form; write-only (spam risk noted, low — admin-reviewed, 0 rows). |
| assessment_sessions · sessions_insert | INSERT | ops-learn | KEEP | Anonymous assessment submit; write-only. |
| assessment_responses · responses_insert | INSERT | ops-learn | KEEP | Write-only. |
| assessment_submissions · insert | INSERT | ops-learn | KEEP | Write-only. |
| enrollments · service insert | INSERT | ops-learn | KEEP | Write-only. |
| email_log · service insert | INSERT | shared | KEEP (note) | Anon can insert fake log rows; low value, no read exposure. Recommend scoping to service_role later. |
| onboarding_analytics · authed reads | SELECT | growth | DOCUMENT | `SELECT/true` to `authenticated`; low-sensitivity (device_id/step). Recommend scope; not shipped. |
| **assessment_responses** · responses_select | SELECT | **ops-learn** | **CROSS-APP — flag** | `SELECT/true` to anon. |
| **assessment_sessions** · sessions_select_by_token / sessions_update_own | SELECT/UPDATE | **ops-learn** | **CROSS-APP — flag** | Named "by_token"/"own" but predicate is literally `true` — scoping was never implemented. Exposes **email + first_name + ai_analysis** for 62 real sessions (10 distinct real emails; 600 synthetic). |
| **assessment_submissions** · read own | SELECT | ops-learn | **CROSS-APP — flag** | Named "own", predicate `true`. |
| **enrollments** · read own | SELECT | ops-learn | **CROSS-APP — flag** | Named "own", predicate `true`. |

**Cross-app note (ops-learn):** these SELECT/`true` policies are genuine PII/data exposures (anyone with the public anon key can `curl` the REST endpoint and dump them). They **cannot be safely fixed from the DB alone** — ops-learn is an anonymous learning platform (no company scope; reads sessions back by unguessable id). A correct fix requires ops-learn to route reads through a token-scoped `SECURITY DEFINER` RPC (the `get_photo_annotations_since` pattern), which is an app change in a repo not checked out here. **Recommended:** coordinate with the ops-learn owner; do not blind-change (would break 662 live sessions / 9315 responses). Flagged to Jackson.

---

## 5. `rls_enabled_no_policy` — 26 tables

RLS enabled + no policy = deny-all at the row layer. Correct posture **iff** the table is genuinely internal (no anon grant). Grant audit:

| Group | Tables | Grant today | Disposition |
|---|---|---|---|
| Ads sync | ad_briefings, ads_daily_account, ads_daily_campaign, ads_daily_keyword, ads_daily_search_term, ads_sync_status | service_role only | **KEEP** — correct internal-only (cron/admin). Document. |
| Admin/config | admin_feature_overrides, lifecycle_email_config, newsletter_content | service_role only | **KEEP** — correct. Document. |
| Email system | email_events, email_ingest_heartbeat_log, onboarding_events | service_role only | **KEEP** — correct (server/cron). Document. |
| Client portal | portal_sessions, portal_tokens | service_role only | **KEEP** — portal validated server-side (service_role); tokens must never be anon-readable. Document. |
| Team join tables | project_team_members, task_team_members | service_role only | **KEEP** — 0 rows; app uses the denormalized `team_member_ids` array + `assign/remove_project_team_member` RPCs. Document as reserved. |
| Decks | deck_zoning_parcel_records | service_role only | **KEEP** — server zoning API. Document. |
| Private schema | `private.identity_linkage_metrics` | (private schema, unexposed) | **KEEP** — not reachable via Data API. Document. |
| **App Store Connect** | asc_discovery_engagement, asc_downloads, asc_raw_rows, asc_report_instances, asc_report_requests, asc_report_segments, asc_reports, asc_sync_status | **anon + authenticated + service_role** | **HARDEN → revoke anon/auth grants** (M4) | RLS denies anon today, but the over-broad grants are a landmine (one accidental policy or RLS toggle = instant exposure). Only `lib/admin/app-store-*.ts` (service_role) touches them. |

**None of the 26 needs a new anon policy** — every one is legitimately internal. The only defect is the erroneous `asc_*` grants (M4).

---

## 6. `anon_security_definer_function_executable` — 51 functions

The anon-bridge model means most `SECURITY DEFINER` functions are **intentionally** anon-executable — they are the app's RPC surface and self-check the caller. Disposition:

**REVOKE anon/auth EXECUTE — 7 (M3):** no client caller; closes surface with zero legit impact.

| Function | Why revoke |
|---|---|
| `audit_trigger_fn()` | Trigger fn — fires internally, never needs an EXECUTE grant. 0 callers. |
| `tr_activity_first_log_auto_advance()` | Trigger fn — same. 0 callers. |
| `fire_due_task_reminders()` | Cron entrypoint; only in generated types. Anon exec = reminder-spam vector. |
| `resolve_task_reminder_recipients(...)` | Internal helper; only the SECURITY DEFINER reminder chain (runs as owner) + service_role. |
| `users_with_permission(...)` | Internal helper; leaks cross-company user ids if called directly. |
| `increment_opportunity_correspondence(...)` | Mutates any opportunity by id, no auth; only caller is sync-engine.ts under service_role (`n()`). |
| `qbo_match_customer_candidates(...)` | Returns client **name/email/phone** for a passed company_id, no caller check (**cross-company PII**); only caller is quickbooks-import-service.ts under `getServiceRoleClient()`. |

**HARDEN body (add caller guard) — 2 (M5, gated):**

| Function | Guard added |
|---|---|
| `get_inbox_density_per_client(p_company_id)` | Client-called (galaxy-thread-density-halos.tsx). Silent-empty unless `private.get_user_company_id() = p_company_id`. Proven: own-company 241 rows, cross-company 0, raw anon 0. |
| `remove_seated_employee(p_company_id, p_user_id)` | iOS-only (team mgmt). End-user callers must be an admin of the target company; service_role bypasses. Closes a seat-griefing/lockout vector. |

**KEEP — 42 (documented as the intentional anon-bridge RPC surface):**
- Table-view CRUD: `archive/create/rename/reset/share/update_*_table_view*`, `bulk_update_project_table`, `create_project_table_assignment_task`
- Conversions: `convert_estimate_to_invoice`, `convert_lead_to_project`, `convert_opportunity_to_project`, `create_progress_invoice`, `get_conversion_preflight`
- Expense: `approve_expense_batch`, `early_clear_expense_line`, `get_or_create_open_batch`, `recalculate_expense_batch_total`
- Catalog/product: `catalog_import_apply/validate`, `products_import_apply/validate`, `generate_product_sku`, `resolve_product_price`
- Identity/permission: `get_user_company_id`, `get_user_id`, `has_permission`, `is_company_admin`
- Photo markup: `get_photo_annotations_since` (already self-scopes — reference pattern), `upsert_markup_layer`
- Team: `assign_project_team_member`, `remove_project_team_member`
- Misc: `change_project_status`, `record_auto_bug` (×2), `submit_feature_request`, `check_user_exists_by_email`

**KEEP-with-note:**
- `check_user_exists_by_email(p_email)` — returns only a boolean; backs the signup/login email-check UX (no ops-web call site found → likely iOS). Accepted low-risk enumeration; revoking risks iOS auth. Option: move behind a rate-limited server endpoint later.
- `catalog_import_apply/validate`, `products_import_apply/validate`, `convert_opportunity_to_project`, `get_conversion_preflight`, `generate_product_sku`, `resolve_product_price` — take a `p_company_id`; **not body-audited this pass** to avoid colliding with the active catalog-setup-wizard / conversion workstreams. Recommended follow-up: audit each for internal caller-company enforcement.

---

## 7. `public_bucket_allows_listing` — 6 buckets (M2)

7 public buckets exist; the 6 flagged each have a broad `SELECT USING (bucket_id='X')` to `{public}` on `storage.objects`, which lets any API client **enumerate** every object across all tenants (folder paths embed company_id/project_id). Per Supabase lint-0025 guidance, a public bucket serves object URLs **without** a SELECT policy — dropping it removes enumeration only.

| Bucket | Listing policy dropped | Serving impact |
|---|---|---|
| client-images | "Anyone can view client images" | none (public URL) |
| images | "Public read images" | none |
| logos | "Anyone can view logos" | none |
| product-thumbnails | "Anyone can view product thumbnails" | none |
| profiles | "Anyone can view profiles" | none |
| project-photos | "project photos select public" | none — photos render via stored public URLs (Canpro/Maverick unaffected) |

**Verified:** full repo grep found **zero** `.list()` calls on any bucket; only `getPublicUrl('images')` and `createSignedUrl` on the private `bug-reports`/`spec-intake` buckets (untouched).

**Additional bucket finding (documented, not in M2):** the `images` and `social-media` buckets have anon INSERT/UPDATE/**DELETE** policies (named "Service…" but targeting `{public}` with no auth check) — anon can overwrite/delete objects. Worse than listing. **Recommended:** tighten to `authenticated` after verifying the upload-presign flow (`app/api/uploads/presign` uses `getPublicUrl` server-side). Not bundled — needs upload-flow verification.

---

## 8. Bonus findings (documented, not shipped)

| Lint | Items | Disposition |
|---|---|---|
| `function_search_path_mutable` | `private.normalize_address/normalize_title/derive_project_name/projects_autoname` | Low risk (private-schema, not anon-exposed). These are the naming functions owned by W4/W6 — flag, don't touch (avoid collision). |
| `extension_in_public` | 4 extensions in `public` | Moving extensions is **not** additive and can break dependents. Document as accepted risk. |
| `auth_leaked_password_protection` | disabled | **Recommend Jackson enable** (dashboard → Auth → Passwords → "Leaked password protection"). Free win, no code. |

---

## 9. Sentinel evidence (all against prod, in rolled-back transactions)

**9.1 Predicate resolution — `request.jwt.claims` simulation across both live tenants:**

| Identity | resolves company | is_ops_admin (qa_bugs) | density own-co | density cross-co | seat own-co | seat cross-co |
|---|---|---|---|---|---|---|
| Canpro admin (canprojack, also ops) | Canpro | **TRUE** | TRUE | FALSE | TRUE | FALSE |
| Canpro member (mattyschure) | Canpro | FALSE | TRUE | FALSE | FALSE | FALSE |
| Maverick admin (peterjmitchell) | Maverick | FALSE | FALSE | TRUE | FALSE | TRUE |
| Maverick member (tkazansky) | Maverick | FALSE | FALSE | TRUE | FALSE | FALSE |
| Pure ops-admin (jack@opsapp.co) | (none) | **TRUE** | FALSE | FALSE | FALSE | FALSE |
| Raw anon (no valid sub) | (none) | FALSE | FALSE | FALSE | FALSE | FALSE |

**9.2 qa_bugs end-to-end RLS (`SET ROLE anon`, policy applied in a rolled-back txn):**

| Caller | qa_bugs rows visible |
|---|---|
| Operator (jack@opsapp.co) | **234** (dashboard preserved) |
| Canpro member | **0** (was: full CRUD on all 234) |
| Raw anon | **0** (was: full CRUD incl DELETE) |

**9.3 get_inbox_density hardened function, end-to-end:**

| Caller · argument | rows |
|---|---|
| Canpro admin → own (Canpro) company | **241** (legit flow preserved) |
| Canpro admin → Maverick company | **0** (cross-company leak closed) |
| Raw anon → Canpro company | **0** |

**9.4 Migration dry-runs (each full migration applied + in-migration sentinel run, then rolled back):** M1 ✓ · M2 ✓ · M3 ✓ · M4 ✓ · M5 ✓ (all returned `*_DRYRUN_OK`).

---

## 10. What needs Jackson's go

Migrations are **committed but not applied** (direct prod DB writes; they do not auto-deploy). Recommended sequence after go:

- **Batch 1 — apply (low risk, verified):** M1, M2, M3, M4. No legitimate app flow touched; sentinel-proven.
- **Batch 2 — apply after a 30-second iOS check:** M5. Confirm the iOS "remove seat" team-management flow calls `remove_seated_employee` as a company admin (the one path this repo can't grep). `get_inbox_density` in the same file is fully web-verified.
- **Flagged for a decision (no migration):** the ops-learn `assessment_*`/`enrollments` SELECT/`true` PII exposure (needs ops-learn coordination); the `images`/`social-media` anon write/delete policies (needs upload-flow check); enable leaked-password protection (dashboard toggle).

**iOS regression checklist before/after Batch 1+2 apply:** projects (view/create), tasks, project photos (upload + render), expenses (batch approve), opportunities (convert), photo annotations sync, team-member assign/remove. All exercised as anon — none touched by Batch 1; only `remove_seated_employee` (M5) changes an iOS path.
