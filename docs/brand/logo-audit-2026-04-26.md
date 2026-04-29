# OPS Logo Placement Audit — 2026-04-26

Snapshot of every OPS brand-mark render in OPS-Web at the time of Round 2
QA-batch fixes. Used to derive `docs/brand/logo-system.md`. Re-run on every
significant brand or layout overhaul.

## Methodology

- `grep -rn "OpsLockup\\|OpsMark\\|OpsLogomark\\|BrandMark" src --include="*.tsx"`
- `grep -rn "ops-logo\\|ops-mark\\|opslogo\\|opsmark" src public`
- Manual scan of every `loading.tsx` segment file
- Captured at SHA = current branch tip

## Results

| File | Line | Variant | Context | Animated? | Notes |
|---|---|---|---|---|---|
| `src/app/(dashboard)/layout.tsx` | 73 | vertical-stack | Dashboard auth-gate loading | `animate-pulse-live` (3s) | **Replaced with `<LogoLoader />` in Round 2.** |
| `src/app/(dashboard)/error.tsx` | 100 | horizontal | Error boundary footer | static | 12px height, opacity 30% — OK |
| `src/components/layouts/sidebar.tsx` | 362 | mark-only | Sidebar version label | static | 16px, opacity 40% — OK |
| `src/components/layouts/dashboard-layout.tsx` | 172 | vertical-stack | Onboarding-gate loading | `animate-pulse-live` (3s) | **Replaced with `<LogoLoader />` in Round 2.** |
| `src/app/(auth)/layout.tsx` | 42 | vertical-stack | Auth-gate loading | `animate-pulse-live` (3s) | **Replaced with `<LogoLoader />` in Round 2.** |
| `src/app/(auth)/layout.tsx` | 143 | horizontal | Auth-hero corner | static | 32px tall — OK |
| `src/app/(auth)/login/page.tsx` | 240 | horizontal | Mobile login header | static | 24px — OK |
| `src/app/(auth)/register/page.tsx` | 220 | horizontal | Mobile register header | static | 24px — OK |
| `src/app/(auth)/join/page.tsx` | 345 | horizontal | Join footer | static | 24px — OK |
| `src/app/(auth)/join/welcome/page.tsx` | 54 | horizontal | Welcome header | static | 28px — OK |
| `src/app/(auth)/pin/page.tsx` | 87 | vertical-stack | PIN hero | static | 80px — OK (full-screen hero) |
| `src/app/(auth)/locked/page.tsx` | 129 | vertical-stack | Locked hero | static | 96px — OK (full-screen hero) |
| `src/app/(onboarding)/setup/page.tsx` | 483 | vertical-stack | Setup loading | `animate-pulse` (Tailwind) | **Replaced with `<LogoLoader />` in Round 2.** |
| `src/app/(onboarding)/setup/page.tsx` | 634 | vertical-stack | Setup form splash | static | **Switched to horizontal in Round 2** per qa_bug `7fdf86b1`. |
| `src/app/(onboarding)/employee-setup/page.tsx` | 298 | vertical-stack | Employee-setup loading | `animate-pulse` (Tailwind) | **Replaced with `<LogoLoader />` in Round 2.** |
| `src/app/(onboarding)/employee-setup/page.tsx` | 309 | vertical-stack | Employee-setup form splash | static | OK as full-screen hero, but consider matching the setup-page horizontal switch in a follow-up. |
| `src/app/(portal)/portal/verify/page.tsx` | 101 | horizontal | "Powered by OPS" footer | static | **Sub-spec sizing**: `h-2.5` (10px) — recommended bump to `h-3.5`. Not changed in Round 2. |
| `src/app/blog/page.tsx` | 37 | horizontal | Blog index header | static | 40px — OK |

## Variant distribution at audit time

- Horizontal lockup: 9 placements
- Vertical stack: 9 placements (5 of which were loading-state pulses, now LogoLoader)
- Mark only: 1 placement
- LogoLoader (post-Round 2): 5 placements

## Round 2 changes

1. **Loading states (5 sites)** — replaced `animate-pulse(-live) + OpsLockup`
   pairs with `<LogoLoader size={120|140} />` from
   `@/components/brand/logo-loader`. Resolves the inconsistency between
   `animate-pulse-live` (custom, 3s ease-in-out) and Tailwind `animate-pulse`
   (~2s) that was visible across dashboard vs onboarding loaders.
2. **Setup splash** (line 634) — vertical → horizontal per the QA bug.
   `h-24` → `h-16` to match the rest of the in-flow horizontal placements.
3. **Logo ruleset** — codified at `docs/brand/logo-system.md`.

## Follow-ups (not in Round 2 scope)

- Bump portal verify footer logo from `h-2.5` to `h-3.5` (legibility).
- Consider switching employee-setup splash (line 309) to horizontal to
  match `/setup`'s splash. Currently still vertical — no QA bug filed.
- Audit error boundary opacity: `opacity-30` reads as "broken" rather than
  "subtle." Consider `opacity-50`.
- Marketing site (try-ops, ops-site) audit — out of scope for this repo.
