# Copy rules come from the blueprint, not the campaign name — GOOGLE ADS ENGINE - P2-1-1-1-1 (2026-09-14)

Branch `feat/ads-engine-p2`. Not pushed, not deployed. Nothing in the ad account or the production database was written. The one outside write is the disabled routine's prompt (below).

## What was wrong

Found during P2-1-1-1 (`../pair-tests/README.md`, "Found, not fixed"). The engine decided which copy rules an ad answers to from the campaign's **name**: `campaignKindOf` in `src/lib/ads/engine/snapshot.ts` returned `brand`, `core` or `competitor` only for names starting `BRAND`, `CORE` or `COMPETITOR` — the names of the old spec §4.2. Phase 2 built the account with the Task 2R names, so on the live account:

| Campaign | Blueprint kind | Engine read |
|---|---|---|
| `BRAND · NA` | brand | brand |
| `PRICING · US` | competitor | **other** |
| `SWITCH · US` | competitor | **other** |
| `TRADE · US` | core | **other** |
| `CORE · CA` | core | core |

and the blueprint's per-group override (`copyKind: "competitor"` on `CORE · CA › Pricing` and `› Switching`) never reached the engine. `validateProposal` judged every non-competitor kind as core, so it refused the group's **own approved copy** (`COPY_REJECTED` / `TRADEMARK_CAMPAIGN`) in all seven groups built for competitor searches. Once live, the routine could never have written a valid challenger there without dropping the competitor name from a compare page — and its prompt told it to, since it said "competitor names only in the COMPETITOR campaign", a campaign that no longer exists. `add_ad_group` payloads carried the same wrong `campaignKind`.

A second hole sat beside it: nothing tied an **inherited** competitor kind to a compare page. A new ad group the routine proposed inside a competitor campaign could name a competitor on `/job-management`.

## The decision

**The blueprint says what things are; a name grants nothing.** One resolver, `src/lib/ads/engine/copy-kinds.ts`, used by the snapshot mapper and the validator alike:

- **Campaign kind** = the blueprint's kind for the campaign of that exact name. The `legacy` label still wins. A campaign the blueprint does not declare is `other`, whatever it is called. Exact names are how the blueprint apply already diffs the account, so the engine and the apply always agree on which entity is which.
- **Ad group copy kind** (new `SnapshotAdGroup.copyKind`) = the blueprint group's `copyKind`, else its campaign's kind, then **competitor only on a `/compare/` page** — judged on the page the ads actually land on (`isComparePage` in `copy-rules.ts`). A declared competitor group whose ads moved to another page answers to core.
- **Never widen what the blueprint did not declare.** A group the engine builds inherits its campaign's kind (a core campaign's new group stays core even on a compare page); a campaign with no kind gives its groups core; an unreadable blueprint gives every group core and every non-legacy campaign `other` (a `legacy`-labelled one stays `legacy`).
- **The validator** holds a challenger to its group's `copyKind` on the page it lands on, and a new ad group to exactly the rules the snapshot will give it once it exists (the same resolver, with the blueprint the repository read — the validation context now carries it). Accepted payloads record `copyKind` beside `campaignKind`.
- **The repository** is the single place the snapshot is built (brief, handoff, worker, apply, console), so it loads the committed blueprint once per read (`createEngineRepository(client, { loadBlueprint })`, default `loadBlueprint`); `validationContext` builds the snapshot and hands the validator the same blueprint object.
- **The blueprint enforces the same rule**: `COMPETITOR_COPY_WITHOUT_COMPARE_PAGE` now covers a group that inherits competitor copy from its campaign, not only one that claims it — the file can never describe a group the engine would judge differently.
- **Legacy detection is unchanged**: every `kind !== "legacy"` consumer (brief, worker `campaignsLive`/engine filters, pairs, disapprovals, admin, `dailyBudgetSum`) still keys off the label.
- **What the routine reads**: brief `ads-brief-2026-09-14-v2` carries `copyKind` on every snapshot ad group; prompt `ads-routine-2026-09-14-v3` says competitor names run only where `copyKind` is `competitor` (and, for a new ad group, only in a competitor campaign on a `/compare/` page), passes `copy_kind` to the editor subagent, and corrects "run in Canada" to "the US and Canada". The `TRADEMARK_CAMPAIGN` message now says where the name may run: "\"Jobber\" runs only in a competitor ad group that lands on a compare page. This group runs core copy."
- **The routine itself** (`trig_01LroGoQJLg9GCPEAK3SD4dg`) was updated to prompt v3 on 2026-09-14 22:43 UTC and is still **disabled**. The new wording is safe against the build deployed today: that brief has no `copyKind`, so the routine names no competitor — exactly what today's deployed validator allows.

## Proof

| Check | Result |
|---|---|
| Test-first | Every rule's test ran red before its code: `copy-kinds.test.ts` and the repository test on a missing module / wrong kinds, `isComparePage` not a function, the inherited-kind blueprint refusal, three snapshot tests, four validator tests (the core campaign's competitor group refused — the live defect; a competitor-campaign group off a compare page accepted — the second hole; a declared group refused; `copyKind` missing from the payload), the null-blueprint rule, and the new `TRADEMARK_CAMPAIGN` message. |
| Mutation check | 15 deliberate breakages — name prefixes restored, group override ignored, compare-page rule removed, null blueprint granting the campaign kind, case-insensitive name match, challenger judged by campaign kind, page not re-checked, `add_ad_group` ignoring the context blueprint, mapper dropping the blueprint, repository default loader missing, `validationContext` omitting the blueprint, handoff overriding it, blueprint coherence checking overrides only, `isComparePage` matching any "compare", payload dropping `copyKind` — **each caught** by at least one failing test; sources restored byte-identical (`mutations-2026-09-14.txt`). |
| Ads unit suite | `npx vitest run tests/unit/ads` — 28 files, **490 passed** (457 before). |
| Wider suite | `npx vitest run ads google-ads pmf analytics heavy-cron-schedule-isolation` — **114 files, 1358 passed** (112 / 1325 before). |
| Types | `tsc --noEmit` — the same 6 errors as before this work (3 inherited from main, 3 branch errors owned by P2-1-1-2-1), none from it. |
| Lint | `eslint` on every changed source and test file — clean. |
| Repository against a real database | `LC_ALL=C node --conditions=react-server --import tsx tests/sql/ads-engine-pair-tests-runtime.mts` — **PASS** (the repository now imports the blueprint; its pair-test methods are unchanged). |
| Production, read-only | `../pair-tests/dry-run.mts`, extended with `snapshotKinds` and `copyRulesAskedOnTheirOwn` (the group's challenger set aside, so the one-challenger rule cannot mask the copy question; the group's own approved challenger copy resubmitted on its own page; and, in every group that may not name a competitor, the same copy with "Switching from Jobber?" planted). Every request through a fetch that refuses anything but GET/HEAD — **zero refused**. |

### Production, before and after (same questions, same rows, snapshot 2026-09-14 08:04 UTC)

`dry-run-before-2026-09-14.json` — the script run on a clean export of `9a5150e3e` (the code before this fix):

- Campaign kinds: `PRICING · US`, `SWITCH · US`, `TRADE · US` → **other**.
- Own approved challenger copy: **5 accepted, 7 `COPY_REJECTED`** — Jobber pricing, Housecall Pro pricing, Jobber alternative, Housecall Pro alternative, ServiceTitan alternative, `CORE · CA › Pricing`, `CORE · CA › Switching`, each `TRADEMARK_CAMPAIGN` "… may only appear in the competitor campaign."
- A third ad: refused in all 12 (`TEST_NOT_CONCLUDED`).

`dry-run-after-2026-09-14.json` — this branch:

- Campaign kinds: brand, competitor, competitor, core, core — the blueprint's.
- Ad group copy kinds: the seven competitor-intent groups `competitor`, each on its `/compare/` page; Brand `brand`; Cleaning, Landscaping, Roofing, Category `core`.
- Own approved challenger copy: **12 of 12 accepted, 0 `COPY_REJECTED`**; the 7 that name a competitor record `copyKind: "competitor"`.
- A competitor name planted in the 5 groups that may not carry one: **refused 5 of 5** with `TRADEMARK_CAMPAIGN`.
- A third ad: **still refused in all 12** (`TEST_NOT_CONCLUDED`); the worker still sees 12 live pairs, 0 tests, 0 to open (nothing has served); the brief's duties with every campaign treated as live are `hygiene` only; the committed blueprint `2026-09-11-v1` still plans **0** operations.

## What happens next, and when

Nothing changes in production until Jackson merges and deploys `feat/ads-engine-p2`. From then on the brief shows every group's copy rules and the validator accepts competitor copy exactly where the blueprint built for it. The routine already carries the matching prompt and stays disabled until launch.
