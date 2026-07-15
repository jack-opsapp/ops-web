# Lead detail window — audit & relayout proposals

**For:** Jackson · **Date:** 2026-07-09 · **Status:** review-before-build (no code changed)

This is a read-only audit of the window that opens when you click a lead on the pipeline board. It documents what the window looks like today, what gets squeezed out, and lays out three ways to fix it — written so you can pick a direction. Nothing here has been built; this is the decision that comes before the build.

---

## 1. What the window is today (layout inventory)

When you click a lead on the pipeline board, a floating window opens on top of the
board. It is a fixed **780 wide × 680 tall** window. Think of that 680 of height as
a budget — every strip we stack into it spends from the same 680, and whatever is
left at the bottom is the only part the operator can actually read without scrolling.

Here is exactly how that 680 is spent today, measured live from the running app
(not estimated). Top to bottom:

| Strip (top → bottom) | What it holds | Height | Share of the window |
|---|---|---:|---:|
| Window header | Lead name, address line, status tag, the `…` actions menu | **127 px** | 19% |
| Map band | A map picture of the job site, with the dollar value, priority, win %, source, owner and close date laid over it | **158 px** | 23% |
| Next-step line | The single most urgent thing to do (e.g. "Follow up — overdue 113d") | **57 px** | 8% |
| Tab bar | OVERVIEW · CORRESPONDENCE · TIMELINE · PHOTOS | **50 px** | 7% |
| **The reading window** | **The actual lead record — everything below scrolls inside here** | **251 px** | **37%** |
| Footer | Repeats the value and days-in-stage | **35 px** | 5% |

So four fixed strips (header + map + next-step + tabs = **392 px**) plus the footer
(35 px) take up **427 px — about 63% of the window** — before the lead record gets a
single pixel. The record itself is handed a **251 px** slot to live in.

The catch: the record is not 251 px of content. On the OVERVIEW tab the content is
**1,017 px tall** — Summary, Scope, Health, Tags, Contact, Location, and Linked
records (estimates, project, site visits). Pouring 1,017 px of content through a
251 px window means **the operator sees about a quarter of the lead at once and
scrolls roughly four screens to see the rest.**

One detail worth flagging: the 158 px map band is a **fixed height that never changes**.
A lead with no address and no map coordinates still spends those same 158 px — it just
paints a decorative grid instead of a map. The map is guaranteed the second-biggest
strip in the window whether or not it has anything useful to show.

## 2. What gets cut off, and why

The header, map band, next-step line, and tab bar are all **pinned** — they never
scroll. Only that 251 px reading window scrolls. See the two screenshots in §5:
the pinned strips sit in exactly the same place in both, and only the middle moves.

**What you get to see the moment the window opens** (screenshot `lead-detail-01`):
the lead name and contact line (header), the value/priority/win/owner facts (map
band), the one urgent next step, the tab bar — and then, in the 251 px reading
window, just the **Scope** line and the very first row of **Health** ("win
probability 55%"). That is the entire first impression. Everything else is below
the fold.

**What is hidden below the fold until you scroll** (screenshot `lead-detail-02`):
the rest of Health (days in stage, created date, last activity, email counts),
**Tags**, the **Contact** block (with the click-to-call / click-to-email actions and
"attach client"), the **Location**, and the **Linked** records — the estimate
(EST-2026-00005, $9,406.60), the project link, and site visits. If the lead has an
intelligent **Summary**, that sits below the fold too.

**Why this is the wrong split.** The map is handed 23% of the window permanently,
but for most trades leads the map is glanceable-nice, not decision-critical — and the
one genuinely useful thing in it (the address) is a single line that already has its
own "Open in Maps" link. Meanwhile the things an operator actually opens a lead *to
do* — read the story (Summary), see who to call and tap to call them (Contact), check
the estimate (Linked) — are the parts pushed off-screen. The window spends its most
expensive real estate on a picture and makes the operator scroll to reach the verbs.

In plain terms: **the window leads with decoration and buries the action.** A stressed
owner-operator opening a lead between jobs should land on "here's the story and here's
who to call," not on a map with the answer four scrolls down.

## 3. Three ways to fix it

Each of these is a different bet on the same problem: the reading window is too small
because the map takes too much. Here they are, plainly, with what each one costs.

### Direction A — Shrink the map to an address strip that opens on demand

Replace the 158 px map band with a slim **~44 px address strip** (the address, the
value, and an "expand map" control on one line). Tap it and the map slides open to its
full height; tap again and it collapses. Everything the band shows today (value,
priority, win %, owner, close date) moves into a tight facts row just under it.

- **What it buys:** the reading window jumps from 251 px to roughly **365 px — about
  45% more of the lead visible at once**, with zero scrolling. The map is one tap away
  for the times you want it.
- **What it costs:** the map is no longer the first thing you see — it's a deliberate
  tap. The facts that currently sit *on* the map need a clean home just below the strip.
  Modest build.

### Direction B — Make the map its own tab

Move the map out of the permanent header entirely and add it as a fifth tab
(OVERVIEW · **LOCATION** · CORRESPONDENCE · TIMELINE · PHOTOS). The header keeps the
name, address, and value; the map lives on the Location tab when you actually want it.

- **What it buys:** the biggest reclaim — the full **158 px** comes back to the reading
  window (which would grow past ~400 px), so most leads fit with little or no scrolling.
  Cleanest header.
- **What it costs:** the map goes from "always there" to "one tab away," which is a
  bigger behavioural change than A. Adds a fifth tab to a bar that's currently four.
  For crews who glance at the map constantly, it's now a click every time.

### Direction C — Grow the window and pin a compact summary

Keep the map, but make the window taller by default (e.g. 680 → ~820) and pin a
small always-visible summary line under the header so the top-line facts stay put
while the record scrolls beneath.

- **What it buys:** nothing has to move or hide — least disruptive to the current look.
  The taller window alone adds ~140 px of reading room.
- **What it costs:** the weakest fix per pixel. It doesn't address *why* the map costs
  so much; it just buys a bigger box, which eats more of the screen behind it and helps
  less on smaller laptops. The map still owns 23% of a now-larger window.

## 4. Recommendation

**Go with Direction A — shrink the map to an address strip that opens on demand — and
pair it with one small reorder: lead the record with the Summary and Contact, not the
Scope.**

Why A over the others: it targets the actual problem (a picture is renting the second-
most-expensive strip in the window) without the heavier behavioural change of hiding
the map behind a tab (B) or the blunt "just make the box bigger" of C. It follows the
OPS rule that prominence should match how often something is used — a map you glance at
occasionally shouldn't own a quarter of the window, but it should still be one tap away.
It nearly doubles the usable reading space and keeps the window the same size on screen.

The small reorder matters as much as the strip: once there's room, the first things in
the reading window should be the **Summary** (the story of the lead) and the **Contact**
(who to call, tap-to-call) — the reasons an operator opens a lead at all — with Scope,
Health, Tags, Location and Linked following. That turns the window from "map first,
action buried" into "story and action first, detail on scroll."

This is a review-first document — no code has been changed. Once you pick a direction,
the build is a straightforward next step.

## 5. Screenshots (live preview)

Captured from the running app at desktop size (1440×900), lead detail window at its
default 780×680, OVERVIEW tab. The lead used is a real seeded deal (Jet Interior
Reupholstery / Rick Heatherly).

**`lead-detail-01-default-overview.png` — what you see the moment it opens.**
The pinned strips (header, map band, next-step, tab bar) fill the top; the reading
window shows only Scope and the first line of Health before the fold. Note: the map
band renders as a broken/blank picture here because the local preview has no Mapbox
key — in production it shows real map tiles. The point stands either way: the band
holds its full 158 px regardless of whether the map has anything to show.

**`lead-detail-02-scrolled-below-fold.png` — the same window, scrolled to the bottom.**
The four top strips have not moved (they're pinned). Only the 251 px reading window
scrolled, now showing the tail of the record — Location and the Linked estimate
(EST-2026-00005, $9,406.60) and site visits. Everything between the two shots
(the rest of Health, Tags, Contact) is reachable only by scrolling.

### Measurement method

Heights were read live from the running window with `getBoundingClientRect()` (not
eyeballed): window 780×680; header 127; map band 158; next-step 57; tab bar 50;
reading window 251 (visible) against 1,017 of actual OVERVIEW content; footer 35.
