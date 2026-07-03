# Inbox → Opportunity live-data cleanup — dry-run (2026-07-03)

**Decision for Jackson:** approve the one-time cleanup of legacy pipeline rows below, or adjust the held items first. **Nothing has been written.** The apply script is gated and will only run on your explicit go.

Companion script: [`inbox-opportunity-cleanup-2026-07-03.sql`](./inbox-opportunity-cleanup-2026-07-03.sql).

---

## Why this exists

Back in April a botched email-import run created a pile of junk pipeline rows: leads with **blank names** and the **same job saved 3–4 times** as separate "won" deals. The code that caused it is **already fixed** — no bad rows have been created since April 28, and nothing new has appeared since. This is purely mopping up what the old bug left behind. It's the only piece of this workstream that touches live customer data, which is why it waits for your go.

## What the cleanup does (all reversible or fill-only)

| Action | Rows | Notes |
|---|---|---|
| **Collapse duplicate "won" deals** | 26 → into 12 kept deals | Same job saved multiple times. The richest copy (the one with a real project, value, or address) is kept; the extras are archived and tagged as "merged into" the survivor. **Fully reversible** — nothing is deleted. |
| **Give blank leads a real name** | 47 live leads | Named from the deal's own description; the generic "Canpro Deck and Rail Estimate" ones become "{Client} — Estimate". After this, **zero** live leads have a blank name. |
| **Fill in missing client phone/address** | 25 clients | Pulled from that client's own deals. Only fills blanks — never overwrites anything you've typed. |

76 more blank leads were **already archived** by the automatic stale-lead cleanup, so they're out of your pipeline view already and are left untouched.

## What I'm NOT touching without your call (12 rows, 5 clients)

These look like duplicates by a naive rule ("same client, multiple won deals") but are probably **legitimately separate jobs** — mostly builders with several sites on the go. Blindly merging them would destroy real deals, so I held them:

- **Path Developments** — a privacy-panel job *and* a building-11 railing-glass job on Producers Way. Likely two scopes, not a dupe.
- **WJ Construction** — the "3621 Producers Way" row is a **different site** from the "779 Blackberry" job it'd otherwise merge into.
- **Jackie Hestnes** — two rows, but each is already its **own project**. Not duplicates.
- **Maureen Mitchell** — one extra row about a payment dispute with a different value; probably the same Oak Bay deck at a later stage, but worth a glance.
- **Edward Hu** — four thin "railing height adjustment" notes with no clear original (the oldest is titled after a screenshot file). Same topic, but no clean deal to keep — your call which survives.

## Proof the dry-run is safe

Ran read-only against production. All six integrity checks passed:

- 26 merges mapped · 0 cross-client mistakes · 0 chained merges · 0 deals-with-a-project archived · every row is live + won · all 38 IDs exist.

## To apply (after your go)

Open the `.sql` file, uncomment the `BEGIN … COMMIT` block, run it, eyeball the row counts, `COMMIT`. I can do this for you the moment you say go.
