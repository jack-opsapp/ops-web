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

## Custom signature logo

| File | State |
| --- | --- |
| `07-no-logo-add.png` | No mark anywhere — no toggle, no arrangement, one way in. |
| `08-company-logo-source-actions.png` | The company logo is the mark: REPLACE, and nothing to revert to. |
| `09-background-removed-undo.png` | Straight after an upload whose background was cut: the mark is the operator's own, REVERT appears, and the removal offers its way back. |
| `10-custom-logo-confirmed.png` | Confirmed, signing with the uploaded mark. |
| `11-background-removal-before-after.png` | The cut itself: the uploaded file, and the result over a checkerboard. |
| `logo-source-white-bg.png` | The file fed through the real file input. |
| `logo-cut-transparent.png` | What the card uploaded. |

**The removal is not staged.** `09` was produced by handing
`logo-source-white-bg.png` to the card's own file input; the browser ran the
shipped `removeSolidBackground` and the harness read the bytes back off the
upload request. Measured on those bytes in the browser: 56,549 of 72,000 pixels
cleared, 3 feathered, corner alpha `0`, wordmark alpha `255`, and the ring's
enclosed counter still `255` — identical to what `make-logo-fixture.ts` gets
running the same core in Node.

## Re-running

```
# dev server: npm run dev:webpack -- -p 3411
# .env.local needs DEV_BYPASS_AUTH=true and NEXT_PUBLIC_DEV_BYPASS_AUTH=true
# The first /settings compile under webpack takes minutes — warm it before
# driving the harnesses through the Playwright MCP:
#   shot-run.js      → 01, 02, 03
#   shot-connect.js  → 04
#   shot-layout.js   → 05, 06
#   shot-logo.js     → 07, 08, 09, 10
# and, standalone:
#   npx tsx docs/artifacts/sender-identity/make-logo-fixture.ts → 11 + the two
#   loose PNGs (run it first; shot-logo.js uploads the source it writes)
```
