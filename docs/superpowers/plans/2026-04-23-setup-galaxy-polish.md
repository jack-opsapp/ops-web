# Setup Galaxy Polish — Group C

> **Bugs covered**
> - `a4bc6901-1dad-4b66-a149-8ca09da8bc93` — Hyperspeed → app transition flashes first setup step before entering the app (2026-04-19)
> - `5c74b580-ea3b-4065-88ee-bf42e0bc6d55` — Setup galaxy hover node labels use wrong corner radii (2026-04-19)

## Skills to load

- `interface-design` + `.interface-design/system.md`
- `animation-studio:animation-architect` **(required — this is motion work)**
- `animation-studio:web-animations`
- `frontend-design`

## Source of truth

- Design system spec: `OPS-Web/.interface-design/system.md`
- V2 bundle: `/Users/jacksonsweet/Projects/OPS/ops-design-system-v2/project/`
- Project CLAUDE.md: `/Users/jacksonsweet/Projects/OPS/OPS-Web/CLAUDE.md`
- Motion easing is `EASE_SMOOTH = [0.22, 1, 0.36, 1]` from `src/lib/utils/motion.ts` — use this, do not redefine.

## Files touched

| File | Purpose |
|------|---------|
| `OPS-Web/src/components/setup/SetupStarfield.tsx` | Line 1135: swap `rounded-sm` + `.glass-surface` on hover label for spec-correct `rounded-chip` + `.glass-dense` |
| `OPS-Web/src/app/(onboarding)/setup/page.tsx` | Gate pre-phase-render on `onboardingCompleted.web` to prevent identity-form flash between `router.push` and dashboard mount |

**No changes** to `dashboard-layout.tsx`, `SetupLaunchAnimation.tsx`, or
anything else. Fully isolated from Groups A, B, D, E1, E2.

## Diagnosis

### Bug 1 — First setup step flashes before app
`setup/page.tsx:394-464` `handleLaunchComplete`. Order of operations fires a
brief re-render with `phase === "identity"` between:

1. Line 438: `setUser({ ...user, onboardingCompleted: { web: true }})` —
   triggers a render.
2. Line 454: `resetSetupStore()` — resets `phase` in the Zustand store from
   `"launching"` back to `"identity"` (the default).
3. Line 455: `router.push("/dashboard")` — async, frames later.

Between (2) and when the dashboard route actually mounts, React renders the
identity-form branch (lines 605–727) because `phase === "identity"` now. The
user sees their first-name / company form for ~1 frame before the dashboard
appears. The guard effect at lines 111–116 also independently fires
`resetSetupStore + router.replace` on `onboardingCompleted.web = true`, which
doesn't help — the race is the same.

**Fix:** at the top of the render function, short-circuit to a black screen
(`<div className="fixed inset-0 bg-background" />`) when
`authUser?.onboardingCompleted?.web === true`. The dashboard renders a moment
later and the user never sees the identity form.

### Bug 2 — Hover node label radii wrong
`SetupStarfield.tsx:1135`:

```tsx
<div className="px-2.5 py-1.5 rounded-sm bg-glass glass-surface ...">
```

Two issues against spec v2:
1. `rounded-sm` = **2.5px**. Not on the radii ladder (`panel: 10 / modal: 12 / btn: 5 / chip: 4 / bar: 2 / sidebar: 6`). Hover labels are chip-tier → **4px** (`rounded-chip`).
2. `.glass-surface` is the 10px-radius panel surface. This tooltip is a stacked floating annotation over the canvas → use `.glass-dense` (12px baseline) but override radius to `rounded-chip` because it's annotation-sized, not modal-sized.

Also `bg-glass` (from tailwind `colors.glass.DEFAULT`) is redundant alongside `.glass-surface`. Drop it.

## Tasks

### Task C.1 — Fix hover node label radius + surface (2 min)

**File:** `OPS-Web/src/components/setup/SetupStarfield.tsx`

**Replace line 1135 with:**

```tsx
            <div className="px-2.5 py-1.5 rounded-chip glass-dense">
```

The `.glass-dense` utility (defined in `globals.css:188–203`) already applies
`backdrop-filter: blur(28px) saturate(1.3)`, the `--glass-border` hairline,
and the top-edge gradient pseudo — so every style the old line hand-rolled is
already baked in. Override radius with `rounded-chip` (4px) because a node
label at ~28×28px would look pillowy at 12px.

(Lines 1136–1139 inner content stay untouched — the `font-mono text-body
text-text` label is already spec v2.)

**Commit:**
```sh
git add src/components/setup/SetupStarfield.tsx
git commit -m "fix(setup): hover node label uses spec v2 glass-dense + chip radius

Bug 5c74b580 — rounded-sm (2.5px) is not on the spec v2 radii ladder, and
.glass-surface (10px panel radius) is wrong for a stacked floating label
over the canvas. Use .glass-dense with rounded-chip override (4px) — the
correct tier for chip-sized tooltips. Drop redundant bg-glass."
```

### Task C.2 — Prevent identity-form flash on launch (4 min)

**File:** `OPS-Web/src/app/(onboarding)/setup/page.tsx`

**Insert the guard block BEFORE the `if (!ready)` check at line 468.**
Specifically, insert between the `handleLaunchComplete` closing brace (line
464) and the `// ─── Loading gate ───` comment (line 466):

```ts
  // ─── Completed gate ───────────────────────────────────────────────────
  // When `handleLaunchComplete` fires it updates auth + resets the setup store
  // to its default (phase="identity"). React renders the new phase before
  // `router.push` navigates, which briefly flashes the identity form. Short-
  // circuit to a black screen as soon as onboarding is flagged complete — the
  // guard effect at the top of the file will `router.replace("/dashboard")` on
  // the next tick regardless. Bug a4bc6901.
  if (authUser?.onboardingCompleted?.web) {
    return <div className="fixed inset-0 bg-background" aria-hidden="true" />;
  }

```

This sits between `handleLaunchComplete` and the `if (!ready)` loading-gate
return. The order matters:
- `if (authUser?.onboardingCompleted?.web)` short-circuits **before** the
  `!ready` gate so that during the gate's 50ms debounce we also show black.
- The existing guard effect at lines 111–116 still fires and handles
  `router.replace` — no new navigation logic needed.

**Commit:**
```sh
git add src/app/\(onboarding\)/setup/page.tsx
git commit -m "fix(setup): gate render on onboardingCompleted to kill identity flash

Bug a4bc6901 — handleLaunchComplete toggled onboardingCompleted.web then
resetSetupStore(), which snapped phase back to 'identity' and rendered
the form for a frame before router.push landed on /dashboard. Add an
early return that shows a black canvas once onboardingCompleted.web is
true; the existing guard effect still handles router.replace."
```

### Task C.3 — Browser verify both fixes (5 min)

1. `cd OPS-Web && npm run dev`
2. **Verify C.1** — go to `/setup`, advance to the starfield phase (identity → company → starfield). Hover any question node. Label tooltip: 4px corners, glass-dense backdrop, hairline border, top-edge gradient visible.
3. **Verify C.2** — answer ≥ 4 questions, click LAUNCH. Observe the hyperspeed animation → black frame → dashboard. **Specifically watch for any flash of the identity form between the animation completing and the dashboard appearing.** There should be zero flash.
4. **Edge case**: with DevTools open, slow network to "Slow 3G". Repeat. The dashboard takes longer to mount, but the black screen holds — no form flash.
5. **Reduced-motion**: toggle system "Reduce motion" → SetupLaunchAnimation short-circuits (existing code at `SetupLaunchAnimation.tsx:281`) and the transition should still be flash-free.

**If any flash appears:** DO NOT commit. Inspect with React DevTools — check
whether the render between `setUser` and `router.push` is what's showing.

**Commit (verification):**
```sh
git commit --allow-empty -m "chore(setup): browser-verified group C fixes

Starfield hover labels render with spec v2 glass-dense + chip radius.
Launch transition holds black from animation end through dashboard mount
— no identity-form flash at normal speed or throttled (slow 3G)."
```

## Acceptance criteria

- [ ] Both bug_reports rows (`a4bc6901`, `5c74b580`) manually resolved on review
- [ ] Zero TypeScript errors (`npm run typecheck`)
- [ ] `npm run lint` clean on both modified files
- [ ] Hover labels no longer use `rounded-sm` anywhere in `SetupStarfield.tsx`
- [ ] No new motion logic added; existing `EASE_SMOOTH` reused (if needed)
- [ ] Reduced-motion path tested

## Non-goals / out of scope

- Any broader setup UX changes (question copy, flow ordering, skip logic)
- Reworking `SetupLaunchAnimation.tsx`'s speed curve or visual sequence
- The `border-[rgba(111, 148, 176,0.3)]` "Dashboard unlocked" notification
  styling at lines 1242 — similar tooltip issue but *not* in the filed bugs;
  flag for a follow-up if design wants parity.
