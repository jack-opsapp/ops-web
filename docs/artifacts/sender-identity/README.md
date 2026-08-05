# Sender identity — captured states

Screenshots of the shipped card, taken against the local dev server
(`npm run dev:webpack -- -p 3411`) signed in through the dev auth bypass.

**What is real and what is not.** The component, tokens, fonts, layout, and the
signature template output are the running application. The dev-bypass company
has no connected mailbox, so `GET /api/integrations/email/signature` is stubbed
per state by the harness scripts in this folder — the payloads are fixtures
shaped exactly like the route's real response. Nothing was written to any
database to produce these.

| File | State |
| --- | --- |
| `01-unconfigured-builder.png` | Nothing saved yet: builder open, prefilled from the operator's profile and company record, outreach explicitly held. |
| `02-imported-awaiting-confirmation.png` | A Gmail signature is present but unconfirmed — confirm it, or build one instead. |
| `03-confirmed-compact.png` | Confirmed: the signature as the customer receives it, the first-reply subject, one way back in. |
| `04-post-connect-step.png` | The step after a mailbox connect, entered through the OAuth callback's real return URL (`?tab=integrations&status=connected`). |
| `05-logo-left-default.png` | Logo on: the two arrangements appear, logo-left selected. |
| `06-logo-below.png` | The stacked arrangement, preview updated. |

## Re-running

```
# preview server: .claude/launch.json → "sender-identity" (port 3411)
# .env.local needs DEV_BYPASS_AUTH=true and NEXT_PUBLIC_DEV_BYPASS_AUTH=true
node -e "…"   # or drive the harnesses through the Playwright MCP:
#   shot-run.js      → 01, 02, 03
#   shot-connect.js  → 04
#   shot-layout.js   → 05, 06
```
