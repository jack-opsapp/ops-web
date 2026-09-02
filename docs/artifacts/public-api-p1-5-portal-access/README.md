# PUBLIC API P1-5 — staff "Portal access" block (2026-09-01)

Proof shots for the client dossier's `// PORTAL ACCESS` section
(`src/components/clients/portal-access-block.tsx`, mounted in the CONTACT tab
of the client workspace window) and its three staff routes under
`/api/clients/[id]/portal-access`.

Captured with real Chromium (Playwright, 1440×900, dark) against the local dev
server bound to production Supabase, signed in through the dev auth bypass as
the Maverick admin, client "Geoff Shera" (`338dff24-…`).

| Shot | What it proves | Data |
|------|----------------|------|
| `1-live-empty-*` | The block always renders; nobody attached → one-line `—`. | **Live.** Real `GET …/portal-access` → `list_customer_memberships_for_client_as_system` in prod (`200`, `{ memberships: [] }`; server log `GET … 200`). |
| `2-rows-at-rest-*` | One row per membership: masked email · state tag (olive FULL HISTORY / tan NEW WORK ONLY / dim REVOKED) · SEEN stamp in JetBrains Mono. No verbs on the scan surface. | Staged: the GET was intercepted in the browser to return three memberships (no customer has signed in yet). |
| `3-row-hover-actions-*` | Actions live behind the row — CONFIRM ACCESS (forward-only rows only) and REVOKE (live rows) appear on hover / keyboard focus, for operators holding `clients.edit`. | Staged. |
| `4-confirm-pending-*` | Two-step confirm: the row swaps to `GRANTS FULL HISTORY` + CANCEL / CONFIRM. | Staged. |
| `5-revoke-pending-*` | Two-step revoke: `CUTS PORTAL ACCESS` + CANCEL / REVOKE ACCESS (rose). | Staged. |
| `6-unavailable-*` | Store failure never masquerades as "no access": `SYS :: PORTAL ACCESS UNAVAILABLE`. | Staged `503 portal_access_unavailable`. |

`*-block.png` is the section crop; `*-page.png` is the full dashboard with the
client window open.

Automated evidence (run individually, never the full suite):

```bash
npx vitest run tests/unit/api/clients-portal-access-routes.test.ts tests/unit/components/portal-access-block.test.tsx tests/unit/components/contact-tab-portal-access.test.tsx
```

Live route contract verified against prod on 2026-09-01:
`list_customer_memberships_for_client_as_system(p_company_id uuid, p_client_id uuid) → TABLE(membership_id uuid, state text, evidence_kind text, contact_email_masked text, last_seen_at timestamptz)`,
`confirm_customer_membership_as_system(p_membership_id uuid, p_staff_user_id uuid) → text`,
`revoke_customer_membership_as_system(p_membership_id uuid, p_staff_user_id uuid, p_reason text) → boolean`.
