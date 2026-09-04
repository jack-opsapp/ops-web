# External API discoverability — P1-6 verification evidence

Branch `feat/external-api-discoverability`, captured 2026-09-02 against a
worktree preview (`localhost:3478`) bound to **production Supabase**, signed in
as a staff user of MAVERICK PROJECTS LTD holding `settings.integrations`.

| File | What it shows |
|---|---|
| `01-docs-get-a-credential.png` | `/developers/api` with the new **Get a credential** section in place |
| `02-docs-section.png` | The section itself — who issues, where, the three steps, the analytics rule, the deep link |
| `04-settings-website-live.png` | `/settings?section=website` resolving live — proof the documented deep link lands on the Website section |
| `05-settings-website-empty-state.png` | The Website tab first-run empty state, full page |
| `06-empty-state-detail.png` | The empty state close up: two steps (register site → create key) above one `CONNECT WEBSITE` action |
| `issuing-transcript.txt` | The full credential-issuing run: sign-in → source → credential → `GET /v1/intake/config` **200** → revoke → **401**, plus cleanup and residue disposition |

## Verified end to end

1. `GET /api/settings/external-api` → **200**, `featureEnabled=true` (the `external_api` company flag and the `settings.integrations` permission both pass).
2. `POST .../sources` → **201** — the website is registered as an intake source.
3. `POST .../credentials` → **201** — an intake credential bound to that source, `scopes=["intake.write"]`, secret returned exactly once.
4. `curl -H 'Authorization: Bearer …' /v1/intake/config` → **200 OK**, returning the live source, form, file policy and request limits.
5. `POST .../credentials/{id}/revoke` → **200**; the same curl then returns **401**.

## Notes captured during verification

- The empty state in `05`/`06` is the real component in the real app shell with the settings payload replaced by an empty one. The tenant can no longer have zero sources: the revoked test source cannot be deleted (see the transcript's residue section).
- Two local-only environment gaps were found and worked around; **production is correctly configured** (`app.opsapp.co/v1/intake/config` returns `401 invalid_credentials`, not `503`). Details in the transcript.
