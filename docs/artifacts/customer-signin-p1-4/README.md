# PUBLIC API — P1-4 hosted customer sign-in shell: proof

Date: 2026-09-02. Branch `feat/public-api-identity-p1`. Design authority:
`ops-software-bible/specs/2026-09-01-public-api-customer-identity-design.md` (§5.1, I5).

## What was verified

| Check | Result |
|---|---|
| `GET /c/maverick-projects-ltd/signin` (real `companies.public_handle`) | 200, letterhead renders company logo + name |
| `GET /c/maverick-projects-ltd/home` | 200 |
| `GET /c/maverick-projects-ltd` | 307 → `/signin` |
| `GET /c/no-such-business-zz/signin`, `GET /c/Maverick/signin` | 404, neutral not-found page |
| `Accept-Language: es-MX` | Spanish copy (`INICIAR SESIÓN`) |
| Playwright smoke `tests/e2e/customer-signin.spec.ts` (chromium, broker stubbed) | 9 / 9 |
| Vitest `tests/unit/customer/*` (theme, format, API client, code input) | 44 / 44 |
| ESLint on every touched file | clean |
| Scoped `tsc --noEmit` over the new files + transitive imports | clean |
| Design-system scan (hex literals, `[Npx]`, inline colors) | 0 findings |

## Screenshots

Captured by `capture.mjs` against the local dev server with `/api/customer/*`
stubbed at the network layer (the customer auth project is not provisioned; G1).

- `customer-signin-01-email-desktop.png` / `-mobile.png` / `-mobile-es.png` — step 1
- `customer-signin-02-code-desktop.png` / `-mobile.png` — step 2, resend countdown armed
- `customer-signin-03-code-error-desktop.png` / `-mobile.png` — rejected code, cells cleared
- `customer-home-forward-only-desktop.png` / `-mobile.png` — `active_forward_only`
- `customer-home-full-mobile.png` — `active_full`
- `customer-home-none-mobile.png` — no membership
- `customer-not-found-mobile.png` — unknown handle

The bottom-left circular button in the screenshots is the Next.js dev overlay,
not part of the page.

## Reproduce

```bash
# dev server bound to the worktree (Turbopack root pinned in next.config.ts)
npm run dev -- -p 3640
E2E_PORT=3640 npx playwright test tests/e2e/customer-signin.spec.ts --project=chromium --workers=1
OUT=$PWD/docs/artifacts/customer-signin-p1-4 node docs/artifacts/customer-signin-p1-4/capture.mjs
```
