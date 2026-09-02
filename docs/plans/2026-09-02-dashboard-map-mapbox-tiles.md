# Dashboard Map Mapbox Tiles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the dashboard background map by replacing the newly key-gated CARTO raster tiles with authenticated Mapbox dark-style tiles using the existing `NEXT_PUBLIC_MAPBOX_TOKEN`.

**Architecture:** Keep Leaflet, the dashboard map instance, pins, popups, filters, and interaction controls unchanged. Isolate the provider URL/options in a small pure helper so the production boundary can be tested without loading Leaflet or making network requests; return no tile layer when the token is absent so local development degrades to the existing dark canvas instead of requesting a broken provider.

**Tech Stack:** Next.js 15, TypeScript, Leaflet, Vitest.

**Design System:** `.interface-design/system.md` and `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`.

**Required Skills:** `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`.

---

### Task 1: Authenticate Dashboard Map Tiles With Mapbox

**Skills:** Preserve the current OPS dashboard presentation under `custom-skills:ops-design`, `frontend-design:frontend-design`, and `custom-skills:interface-design`; use `superpowers:test-driven-development`; audit the final diff with `custom-skills:audit-design-system`.

**Files:**

- Create: `src/components/dashboard/map/dashboard-map-tiles.ts`
- Create: `tests/unit/dashboard/dashboard-map-tiles.test.ts`
- Modify: `src/components/dashboard/map/dashboard-map-background.tsx`
- Modify: `src/styles/globals.css`

**Design tokens:** No token changes. The existing Mapbox `dark-v11` cartography remains beneath the current OPS glass, gradients, pins, typography, spacing, and motion.

**Step 1: Write the failing provider-boundary test**

Cover two observable behaviors:

- A present public token produces a Mapbox `dark-v11` Static Tiles URL using 512px tiles, `zoomOffset: -1`, and the existing maximum Leaflet zoom.
- A missing or whitespace-only token produces no tile-layer configuration and therefore no unauthenticated request.

**Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/unit/dashboard/dashboard-map-tiles.test.ts`

Expected: FAIL because `dashboard-map-tiles.ts` does not exist.

**Step 3: Implement the minimal provider helper and wire it into Leaflet**

Build the authenticated Mapbox Static Tiles URL from the supplied token, use the Mapbox 512px Leaflet alignment settings, and add the tile layer only when configuration is present. Enable Mapbox/OpenStreetMap attribution and restyle Leaflet's attribution control with existing OPS tokens so the required legal links remain readable without introducing a bright vendor-default panel. Do not alter map layout, pins, filters, controls, animation, or copy.

**Step 4: Run focused tests and type-check**

Run:

- `npm test -- --run tests/unit/dashboard/dashboard-map-tiles.test.ts`
- `npm test -- --run tests/unit/components/projects-workspace/project-map.test.tsx`
- `npm run type-check`

Expected: all commands exit 0.

**Step 5: Verify the real external boundary**

Use a non-secret test token to prove Mapbox rejects invalid authentication without exposing production credentials, and rely on the already verified production Vercel variable scope for deployment readiness. Confirm the implementation contains no CARTO tile request path.

**Step 6: Audit and commit**

Confirm the diff introduces no hardcoded visual token, layout, or motion changes beyond required vendor attribution. Commit only the plan, helper, test, component wiring, and tokenized attribution styling as `fix(dashboard): restore authenticated map tiles`.
