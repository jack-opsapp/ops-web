# Keyword candidates — measured, pruned, and the ones held back (2026-09)

Every seed the account bids on, with the number that justifies it and the source that produced it.
Nothing in `config/ads/blueprint.json` is here on a hunch.

**Source of the numbers:** `config/ads/keyword-demand-2026-09-09.json`, pulled by
`scripts/ads/keyword-demand.mjs` from `KeywordPlanIdeaService.GenerateKeywordIdeas` (v25) against
customer 4454506598 — English, Google Search, presence targeting, seeds chunked in tens because the
API rejects more than ten per request. Bids are CAD low–high top of page. Re-running the script and
then `scripts/ads/annotate-blueprint-demand.mjs` restamps the blueprint, so the file can never drift
from the evidence.

**Why this replaced a manual export.** The P2 plan originally asked Jackson to export a CSV from the
Keyword Planner UI. The API path works on this developer token, so no manual step exists any more —
for this pull or any future one.

## What the measurement changed

1. **The United States is the primary market.** Every term we would bid on totals 8,720 US searches a
   month against 1,520 Canadian. Canada cannot absorb $1,500 a month; the US can. The account is
   $43/day US, $7/day Canada.
2. **Pricing intent is the anchor, not category terms.** `jobber pricing` alone is 4,400 US and 1,000
   CA searches a month at the cheapest bids in the whole set. It is also the exact moment OPS's
   published prices beat an incumbent who hides theirs. It takes the largest budget.
3. **Real bids are roughly double the planning assumption.** The trades-SaaS research planned against
   $4–8 a click. Weighted low top-of-page bids are $12.90 CA and $16.13 US.
4. **"Contractor" is a targeting word, never a copy word.** `contractor scheduling app` (110 US) and
   `contractor invoicing app` (110 US) carry real demand and are bid on. The word never appears in an
   ad or on a page; the `CONTRACTOR` copy rule enforces that, and a test asserts both facts at once.

## Measured demand

| Term | US searches/mo | US bid | CA searches/mo | CA bid |
|---|---:|---|---:|---|
| `field service management software` | 22200 | $55.19–119.01 | 1000 | $28.3–113.12 |
| `jobber pricing` | 4400 | $9.79–60.24 | 1000 | $12.06–76.63 |
| `landscaping software` | 1600 | $3.78–44.62 | 170 | $2.73–26.57 |
| `housecall pro pricing` | 1300 | $11.6–65.09 | 140 | $12.92–57.5 |
| `cleaning business software` | 880 | $16.72–110.19 | 90 | $8.28–43.32 |
| `cleaning company software` | 880 | $16.72–110.19 | 90 | $8.28–43.32 |
| `roofing software` | 720 | $17.45–75.88 | 70 | $13.82–43.81 |
| `jobber cost` | 590 | $8.84–52.45 | 70 | $4.96–30.38 |
| `servicetitan pricing` | 590 | $27.29–137.74 | 50 | $25.81–138.07 |
| `landscaping business software` | 480 | $14.34–137.74 | 50 | $6.18–84.1 |
| `how much does jobber cost` | 390 | $7.45–38.37 | 40 | $5.96–30.38 |
| `lawn care software` | 390 | $15.87–103.88 | 30 | $11.44–40.97 |
| `jobber plans` | 320 | $8.13–62.53 | 140 | $9.53–69.04 |
| `jobber alternative` | 260 | $25.49–102.19 | 70 | $20.61–102.18 |
| `jobber alternatives` | 260 | $25.42–101.92 | 70 | $20.61–102.18 |
| `cleaning business app` | 260 | $11.8–110.19 | 20 | $13.18–84.8 |
| `servicetitan competitors` | 210 | $27.55–75.75 | 10 | $11.5–43.64 |
| `lawn care business app` | 210 | $10.85–63.8 | 30 | $9.31–54.09 |
| `roofing contractor software` | 210 | $18.51–182.64 | 10 | — |
| `plumbing business software` | 210 | $64.68–445.05 | 30 | — |
| `hvac scheduling software` | 210 | $60.7–730.48 | 20 | $21.59–943.58 |
| `housecall pro cost` | 170 | $11.05–60.82 | 10 | $4.46–47.89 |
| `how much is housecall pro` | 170 | $11.05–55.12 | 10 | $22.82–77.93 |
| `housecall pro alternative` | 140 | $49.75–115.91 | 10 | $21.81–70.16 |
| `roofing business software` | 140 | $22.27–81.25 | 10 | — |
| `job management app` | 140 | $15.88–71.23 | 30 | $21.03–158.23 |
| `jobber competitors` | 110 | $27.28–102.19 | 30 | $13.84–55.23 |
| `janitorial software` | 110 | $14.46–83.07 | 10 | — |
| `contractor scheduling app` | 110 | $32.96–82.84 | 10 | $44.3–124.17 |
| `contractor invoicing app` | 110 | $23.19–82.84 | 10 | — |
| `servicetitan alternative` | 90 | $27.55–85.7 | 20 | $27.61–56.38 |
| `electrician scheduling software` | 90 | $55.23–1372.28 | 10 | — |
| `housecall pro competitors` | 70 | $47.99–141.31 | 10 | — |
| `crew scheduling app` | 70 | $14.64–63.22 | 10 | — |
| `alternatives to jobber` | 40 | $27.55–117.76 | 10 | $34.49–102.18 |
| `free jobber alternatives` | 30 | $11.34–57.57 | 10 | $8.54–36.76 |
| `software like jobber` | 20 | $35.98–136.57 | 10 | — |
| `apps similar to jobber` | 20 | $14.86–61.94 | 10 | — |
| `job management software for trades` | 20 | $24.82–82.84 | 10 | $8.44–23.51 |
| `switch from jobber` | 0 | — | 0 | — |

## Dropped, and why

**Zero volume in both countries — never re-add without new evidence.** The seven from the original
Task 3 seed list (`job tracking app for trades`, `work order app for small business`,
`scheduling software for trades`, `dispatch app for small crews`, `invoicing app for trades`,
`quoting software for trades`, `estimate app for small business`) plus `switch from jobber`, which
this pull measured at zero. The "…for trades" construction is how OPS talks, not how buyers search.

**Redundant plurals.** `jobber alternatives` and `housecall pro alternatives` were dropped as phrase
keywords: phrase match already covers close variants including plurals, so the plural buys no traffic
the singular does not and only splits the report. The singulars stay on exact and phrase.

## Held back — real demand at bids that cannot pay back

Recorded so the engine revisits them against real cost-per-trial evidence rather than rediscovering
them as ideas.

| Term | US searches/mo | US bid | Why held |
|---|---:|---|---|
| `field service management software` | 22,200 | $55.19–119 | The head term of the category, and the wrong buyer: enterprise. Highest bid in the whole set. |
| `plumbing business software` | 210 | $64.68–444 | Real demand, but $65 a click against a $1,680 first-year customer does not pay back. |
| `hvac scheduling software` | 210 | $60.70–729 | Same arithmetic. Revisit when cost per trial from the live trades is known. |
| `electrician scheduling software` | 90 | $55.23–1369 | The widest bid range measured; unpredictable spend on thin volume. |

The three trades that did launch — cleaning (880), landscaping (480 on the business term, 1,600 on
`landscaping software`) and roofing (720 on `roofing software`) — clear the same test the four above
fail: enough volume to read, at a bid the budget can absorb.

## Historical evidence that shaped the negatives

The shared negative lists are seeded from this account's own waste, not from a generic list. The
largest single cluster is e-signature — `signature generator` ($97.82), `esign` ($33.13),
`signature maker`, `esign ios` and twenty more, roughly $260 of historical spend on people looking for
a free signature tool. Second is homeowner intent — `handyman`, `taskrabbit`, `airtasker`,
`cleaning service in phoenix az`, `tree removal cost calculator`, `moving chilliwack`. Both clusters
came from broad match in the legacy campaigns; the new account buys exact and phrase only, which makes
most of that waste structurally impossible before a negative is even applied.

One historical term went the other way: `apps similar to jobber` converted, so it is now a seed in
`SWITCH · US`.

## The rule that stops a self-inflicted wound

`free` and `servicetitan` are campaign-level negatives, not shared-list members, because the account
bids on `free jobber alternatives` and on three `servicetitan` terms. A shared set is atomic in
Google's model — you attach the whole list or none of it — so a term that must apply to some campaigns
and not others cannot live in one. The planner refuses any blueprint where a negative would block a
keyword the same campaign bids on (`NEGATIVE_BLOCKS_KEYWORD`): money committed to a keyword that can
never serve, with nothing in Google's interface to tell you.
