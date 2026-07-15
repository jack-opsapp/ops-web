# Pipeline Lead Media — Photos Strip + Deck Design Card

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Surface `opportunities.images` (with add/remove via `/api/uploads/presign`, iOS-parity server-state read-modify-write) and lead-attached `deck_designs` (view-only card + viewer) on the web pipeline lead detail.

**Architecture:** All UI rides `PipelineDetailBody` (shared by the board drawer and the focused floating window — the two lead-detail surfaces). Lead photos become the first-class source in the existing PHOTOS tab; a state-aware `// DECK DESIGN` section renders between NEXT STEPS and the tab bar only when a deck row exists. Data: two new RMW methods on `OpportunityService` (fetch → merge → update, exact iOS `OpportunityRepository.appendImages/removeImage` semantics), a presign-flow uploader using `authedFetch`, and a slim `DeckDesignService.fetchForOpportunity` reading minimal columns + `drawing_data->vertices/edges` for a monochrome SVG wireframe fallback (13/95 prod decks have no thumbnail).

**Tech Stack:** Next.js 15 / React / TanStack Query / Supabase client (anon + RLS `company_isolation`) / Tailwind tokens / lucide-react / Framer Motion (`EASE_SMOOTH` only).

**Design System:** `ops-design-system/project/DESIGN.md` (loaded). No `.interface-design/system.md` — the OPS system is authoritative.

**Required Skills:** `ops-design`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system` (before done).

---

## Verified facts (do not re-derive)

- `opportunities.images` is `text[]`, already in `database.types.ts` on main; **absent from `Opportunity` type + mapper** (`opportunity-service.ts:57`).
- `deck_designs.opportunity_id uuid NULL` is **live in prod** (FK `deck_designs_opportunity_id_fkey` → `opportunities.id`); **missing from `database.types.ts`** (generated pre-migration). RLS = `company_isolation` on all roles → web anon client reads fine.
- iOS RMW (`OpportunityRepository.swift:242-256`): append = fetch server row → for each url, skip empty + already-present → append → `update({images: merged})`. remove = fetch → `filter { $0 != url }` → update. **Never writes a locally-cached array.**
- iOS upload: presign flow, folder `opportunities/{companyId}/{opportunityId}`, filename `lead_<epoch>_<i>.jpg`. Server route (`/api/uploads/presign`) accepts web JSON `{filename, contentType, folder}` + `Authorization: Bearer` (use `authedFetch`), pins Content-Type on the signed PUT, allows `image/jpeg|png|webp|heic`, 30/min rate limit. `authorizeFolder` already permits `opportunities/{companyId}/{oppId}` (caller company enforced). **No server change needed.**
- `/api/uploads/delete` does not exist — photo removal is an array PATCH only; S3 object stays (by design, bible-documented).
- `drawing_data` shapes: `vertices: [{id, position: [x, y], …}]`, `edges: [{id, startVertexId, endVertexId, …}]`. Legacy rows may omit keys; booleans may be numeric (`isClosed: 0/1`). Tolerate everything.
- Focused window renders `PipelineDetailBody` at `pipeline-focused-detail-window.tsx:229` — must receive the new props too.
- Permission gate: `can("pipeline.manage")` (already computed as `canManage` in `pipeline/page.tsx:847` and passed to the panel). Never gate by role.
- Dictionary = flat dotted keys in `src/i18n/dictionaries/{en,es}/pipeline.json`.
- Icons: lucide-react only. Radius: bare `rounded` (5px) / `rounded-panel` (10px) / `rounded-modal` (12px); `rounded-btn` is a 0px no-op — never use.

## AMENDMENT (post-recon against main — the primary checkout reads were from a stale branch)

Main's pipeline detail diverges from the initial recon. Corrections that govern Tasks 5/6:

- **One detail surface**: the floating window (`PipelineFocusedDetailWindow`). The drawer is retired. `PipelineDetailBody` = `LeadMapBand` → `NextSteps` → `TabBar` → tab content, and **already takes `canManage`** — only the PhotosTab call site changes.
- **Tabs**: `"overview" | "correspondence" | "timeline" | "photos"`. The OVERVIEW tab is the dossier (Summary/Scope/Health/Tags/Contact/Location/Linked) built from workspace atoms (`Section`/`Stack`/`Inline`/`Mono`/`Body`/`Chip` at `src/components/ops/projects/workspace/atoms/`).
- **Deck placement (revised)**: its own `Section` (`// DECK DESIGN`) in `PipelineDetailOverviewTab`, between `LocationSection` and `LinkedSection` — the job site, then the thing drawn for it, then the paper trail. State-aware: component returns `null` with no rows. Dictionary keys move to `overview.*`.
- **House patterns on main**: focus = `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent`; toasts = `sonner`; section-header inline actions = mono 10px uppercase tracking-[0.14em] quiet buttons; numbers = `NUM_CLASS` recipe with `[font-feature-settings:'tnum'_1,'zero'_1]`; radius = bare `rounded` for 5px (the overview file's `rounded-[5px]` literals are a pre-token slip — new code uses tokens).
- **`.interface-design/system.md` exists** and matches DESIGN.md; the sanctioned box-shadow exceptions and agent-provenance palette do not apply to this work.

## Design intent (interface-design checkpoint)

- **Human:** owner/office lead reviewing a lead to decide the next action; the photos and the crew's deck sketch are the *evidence attached to the dossier*.
- **Feel:** mission-dossier. Quiet. Zero ceremony. Nothing announces itself.
- **Signature:** the deck **wireframe** — a hairline monochrome line-render of the crew's actual on-site sketch. Card glyph prefers the wireframe (crisp at 40px, token-colored, unmistakably OPS); the viewer shows the raster thumbnail when present (richer), wireframe large otherwise.
- **Defaults rejected:** (1) separate "attachments" list → photos are first-class tiles in the existing PHOTOS tab with provenance labels; (2) toolbar upload button → quiet ADD tile *inside* the grid, where the result lands; (3) a DECK tab (empty for ~every lead today) → state-aware inline section, zero footprint when absent.
- **Color:** monochrome + existing tokens only. No accent (accent = CTA/focus only). Destructive affordance = `rose`/`brick` tokens per system.

---

### Task 1: Types — `Opportunity.images` + `deck_designs.opportunity_id`

**Files:**
- Modify: `src/lib/types/pipeline.ts` (Opportunity interface, after `tags`)
- Modify: `src/lib/api/services/opportunity-service.ts` (`mapOpportunityFromDb`, after tags)
- Modify: `src/lib/types/database.types.ts` (deck_designs Row/Insert/Update + Relationships)

Add `images: string[];` to `Opportunity` (comment: full public S3 URLs — see bible images contract). Mapper: `images: (row.images as string[]) ?? [],`. **Do NOT add images to `mapOpportunityToDb`** — the array must only be writable through the RMW methods (a generic-update path holding a stale array is exactly the clobber the contract forbids).

database.types deck_designs: `opportunity_id: string | null` in Row, `opportunity_id?: string | null` in Insert+Update, plus relationship entry (exact generator shape — single entry, like activities' opportunity FK):

```ts
{
  foreignKeyName: "deck_designs_opportunity_id_fkey"
  columns: ["opportunity_id"]
  isOneToOne: false
  referencedRelation: "opportunities"
  referencedColumns: ["id"]
},
```

Gate: `npm run type-check` still green (worktree). Commit `feat(pipeline): add images to Opportunity model and deck_designs.opportunity_id types`.

### Task 2: Service — image RMW + presign uploader (TDD)

**Files:**
- Create: `src/lib/utils/opportunity-images.ts` (pure merge helpers)
- Test: `tests/unit/pipeline/opportunity-images.test.ts` (write FIRST, watch it fail)
- Modify: `src/lib/api/services/opportunity-service.ts` (two methods)
- Create: `src/lib/api/services/lead-photo-upload.ts` (presign uploader)
- Modify: `src/lib/api/services/image-service.ts` (export `compressImage`)

Pure helpers (unit-tested):

```ts
export function mergeImageUrls(server: string[] | null | undefined, additions: string[]): string[] {
  const merged = [...(server ?? [])];
  for (const url of additions) {
    if (url && !merged.includes(url)) merged.push(url);
  }
  return merged;
}
export function removeImageUrl(server: string[] | null | undefined, url: string): string[] {
  return (server ?? []).filter((u) => u !== url);
}
```

Tests: dedupe against server, skip empty strings, preserve server order + append order, additions already on server are no-ops, remove filters exactly/only, null server tolerated. (The stale-array immunity is structural: the service passes the *just-fetched server row* in — assert the service methods call `fetchOpportunity` first via the service tests below if a mocking pattern exists; otherwise the pure-helper + code-shape review carries it.)

Service methods (RMW — mirror iOS exactly; update `images` directly, not via `mapOpportunityToDb`):

```ts
async appendImages(id: string, urls: string[]): Promise<Opportunity> {
  const supabase = requireSupabase();
  const current = await this.fetchOpportunity(id);            // server state, never cache
  const merged = mergeImageUrls(current.images, urls);
  const { data, error } = await supabase.from("opportunities")
    .update({ images: merged }).eq("id", id).select().single();
  if (error) throw new Error(`Failed to append images to opportunity ${id}: ${error.message}`);
  return mapOpportunityFromDb(data as Record<string, unknown>);
}
async removeImage(id: string, url: string): Promise<Opportunity> { /* same shape, removeImageUrl */ }
```

Uploader (`lead-photo-upload.ts`): validate type/size (same constants as image-service), compress >2MB non-HEIC via exported `compressImage`, then per file: `authedFetch("/api/uploads/presign", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({filename, contentType, folder: `opportunities/${companyId}/${opportunityId}`})})` → `fetch(uploadUrl, {method:"PUT", headers:{"Content-Type": contentType}, body: blob})` → collect `publicUrl`. `Promise.allSettled`, return `{urls: string[], failedCount: number}` preserving input order; callback `onProgress(done, total)`.

Run: `npx vitest run tests/unit/pipeline/opportunity-images.test.ts` → PASS. Commit `feat(pipeline): image RMW service methods + presign lead-photo uploader`.

### Task 3: Hooks — mutations + deck query

**Files:**
- Modify: `src/lib/api/query-client.ts` (`deckDesigns` key under opportunities)
- Modify: `src/lib/hooks/use-opportunities.ts` (two mutations)
- Create: `src/lib/api/services/deck-design-service.ts` + type
- Create: `src/lib/hooks/use-opportunity-deck-designs.ts`
- Modify: `src/lib/api/services/index.ts`, `src/lib/hooks/index.ts` (exports)

Mutations (`useAddOpportunityImages` / `useRemoveOpportunityImage`): mutationFn → service; **no optimistic pre-write** (upload UX shows in-tile progress; the server row is canonical under RMW). onSuccess: `setQueryData(detail(id), server)` + `setQueriesData(lists(), map replace by id)`. onSettled: invalidate detail + lists (house style).

Deck service: select `"id, title, thumbnail_url, version, project_id, created_at, updated_at, vertices:drawing_data->vertices, edges:drawing_data->edges"` where `opportunity_id = id`, `deleted_at is null`, order `updated_at desc`. Map defensively → `OpportunityDeckDesign { id, title, thumbnailUrl, version, projectId, createdAt, updatedAt, vertices: DeckWireVertex[], edges: DeckWireEdge[] }`; malformed vertices/edges → `[]` (legacy tolerance — a bad row must render as icon-fallback card, never throw). Hook: standard useQuery, `enabled: !!opportunityId`.

Commit `feat(pipeline): opportunity image mutations + deck design query layer`.

### Task 4: Wireframe renderer (TDD)

**Files:**
- Create: `src/lib/utils/deck-wireframe.ts` (pure geometry → normalized segments)
- Test: `tests/unit/pipeline/deck-wireframe.test.ts` (FIRST)
- Create: `src/app/(dashboard)/pipeline/_components/deck-wireframe.tsx` (SVG)

`buildWireframeModel(vertices, edges, {size = 100, pad = 0.08})` → `{viewBox: "0 0 100 100", segments: [{x1,y1,x2,y2}]} | null`. Resolve edges via vertex-id map; skip edges with missing endpoints or non-finite positions; coerce numeric strings; **null** when <1 valid segment (caller falls back). Normalize bbox → square viewBox preserving aspect (center the short axis). Tests: normal 4-vertex rect; missing endpoint skipped; degenerate (0/1 vertex, zero-area) → null; string-number coercion; aspect preserved + padded.

SVG component: `<svg viewBox … aria-hidden>` + `<line … stroke="currentColor" strokeWidth={1.25} vectorEffect="non-scaling-stroke" strokeLinecap="round">`. Color from parent (`text-text-2` card, `text-text` viewer). No fills, no decoration — hairline blueprint.

Run tests → PASS. Commit `feat(pipeline): deck wireframe geometry + SVG renderer`.

### Task 5: UI — photos tab (lead photos + add/remove)

**Skills:** ops-design tokens; interface-design (states: hover/focus/disabled/uploading/removing/error); copy via ops-copywriter register.

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-detail-photos-tab.tsx`
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-detail-panel.tsx` (`PipelineDetailBody` gains `canManage: boolean`; thread to tab; deck section mount in Task 6)
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-focused-detail-window.tsx` (pass `canManage`)

Tab props → `{ opportunity, canManage }`. Photo collection: lead photos first (array order, `removable: true`, source label `t("detail.photoLeadSource")`), then existing email/site-visit records (unchanged logic, `removable: false`). Lightbox spans all.

ADD tile (only `canManage`), first grid cell: `<label>` wrapping hidden `<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic">`, `aspect-square rounded border border-dashed border-border text-text-3 hover:text-text-2 hover:border-border-medium hover:bg-surface-hover transition-colors cursor-pointer flex flex-col items-center justify-center gap-1` + `Plus` 16px + `font-mono text-micro uppercase` label. Uploading: `Loader2` spin + mono `"{done}/{total}"` counter (tabular), input disabled. Failures: inline line under grid — `font-mono text-micro text-rose` — `t("detail.photoUploadFailed")` / partial variant; clears on next attempt. Focus ring: `focus-visible:outline-ops-accent` house pattern.

Remove (lead tiles, `canManage`): hover-revealed button top-right `absolute right-1 top-1 h-5 w-5 rounded bg-background/70 text-text-2 opacity-0 group-hover:opacity-100 hover:text-rose transition-opacity/colors` + `X` 12px + `aria-label={t("detail.removePhoto")}`; while mutating: tile `opacity-50 pointer-events-none`. No confirm dialog (recoverable; iOS parity; misclick cost low).

Empty state (no photos anywhere): keep Camera + `detail.noPhotosYet`; when `canManage`, render the grid with the ADD tile instead (the affordance IS the empty state — no coaching copy).

Commit `feat(pipeline): lead photos in detail photos tab with add/remove`.

### Task 6: UI — deck design section + viewer

**Files:**
- Create: `src/app/(dashboard)/pipeline/_components/pipeline-detail-deck-section.tsx`
- Create: `src/app/(dashboard)/pipeline/_components/deck-design-viewer.tsx`
- Modify: `pipeline-detail-panel.tsx` (mount in `PipelineDetailBody` after NextSteps, before TabBar)

Section renders `null` unless `useOpportunityDeckDesigns` returns rows. Container matches sibling sections (`shrink-0 border-b border-border-subtle px-3 py-2`; verify exact NextSteps chrome and mirror). Header: panel-title role — `font-mono text-micro uppercase tracking wide text-text-3` with `//` prefix in `text-text-mute`. Row per design (usually one): 40px glyph box (`rounded border border-border bg-fill-neutral-dim`, wireframe → thumbnail `<img>` → `PencilRuler` icon fallback), Mohave 13px title truncate `text-text`, meta `font-mono text-micro text-text-mute` `V{n} · {MMM D}` (mono numbers), trailing `Maximize2` 12px `text-text-3`. Whole row = button, `hover:bg-surface-hover`, focus-visible accent ring, `aria-label={t("detail.deckOpen")}`.

Viewer: portal, `fixed inset-0 z-[3000] bg-background/80`, backdrop click + ESC close, focus close button on open. Shell `glass-dense rounded-modal border border-border w-[90vw] max-w-[720px]`. Motion: fade + scale 0.98→1, 200ms `EASE_SMOOTH`; `useReducedMotion` → opacity-only 150ms (match PhotoLightbox/panel patterns). Header: title + close X (h-7 w-7 house button). Body: `thumbnailUrl` → `<img class="max-h-[70vh] w-full object-contain">`; else wireframe large (`text-text`, aspect-[4/3]). Footer meta: `V{n} · UPDATED {date}` mono micro. View-only — no actions.

Commit `feat(pipeline): deck design card + view-only viewer on lead detail`.

### Task 7: i18n — en + es

**Files:** `src/i18n/dictionaries/en/pipeline.json`, `src/i18n/dictionaries/es/pipeline.json`

Flat keys (values sentence case — components uppercase via CSS; no exclamation, no emoji):
- `detail.photoLeadSource`: "Photo" / "Foto"
- `detail.addPhotos`: "Add photos" / "Añadir fotos" (aria + tile label "Add"/"Añadir" via `detail.addPhotosShort`)
- `detail.removePhoto`: "Remove photo" / "Quitar foto"
- `detail.photoUploadFailed`: "Upload failed" / "Error al subir"
- `detail.photoUploadPartial`: "Some photos didn't upload" / "Algunas fotos no se subieron"
- `detail.deckDesign`: "Deck design" / "Diseño de terraza"
- `detail.deckOpen`: "View deck design" / "Ver diseño de terraza"

Commit with Task 5/6 or standalone `feat(pipeline): lead media dictionary keys (en, es)`.

### Task 8: Gates + verification (live preview)

1. `npm run type-check`; `npx vitest run tests/unit/pipeline/` (+ any touched suites); targeted `npx eslint` on changed files (repo-wide `next lint` is known-red).
2. `.claude/launch.json` (worktree): `npm run dev:webpack` on a free port. Sign in via dev bypass.
3. Seed (demo company only, sentinel-rollback): attach an existing same-company deck to a demo opportunity (`UPDATE deck_designs SET opportunity_id = …`); revert after proof.
4. Prove: photos add (network: presign → S3 PUT → PATCH with merged array), **RMW race** (with tab open + stale cache, SQL-append a sentinel URL, then UI-add → SELECT shows BOTH), remove (array shrinks; no delete endpoint call), deck card + viewer (thumbnail), wireframe fallback (temp `thumbnail_url = NULL`, restore), reduced-motion + keyboard (ESC, focus ring), es locale spot-check.
5. Screenshots → `docs/artifacts/pipeline-lead-media/` (worktree), shown to Jackson in the summary; delete seeds/test photos after.

### Task 9: Audit + bible + wrap

- Run `custom-skills:audit-design-system` over touched files — zero hardcoded color/spacing/radius/font values (bg-black/60-style raw values banned; tokens only).
- Bible `03_DATA_ARCHITECTURE.md`: images contract — add OPS-Web pipeline detail as third producer (presign folder parity, RMW parity, delete = array PATCH only); deck_designs § Lead attachment — replace "OPS-Web has no deck_designs surface" with the read-only card/viewer + wireframe fallback (commit in bible repo).
- Final atomic commits on `feat/pipeline-lead-media`. **No push** (auto-deploy).
