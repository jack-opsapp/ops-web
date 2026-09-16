# Topic funnel proof — 2026-09-16

Local rehearsal of the restored weekly topic funnel on live data, before deployment.

- `live-scan.ts` / `live-radar-scan.json`: the production radar scanner run from a Mac against all 26 watchlist feeds (26/26 answered, 390 signals, 142 offered to the writer; the claim window was 14 days then and is 7 days now).
- `rehearsal-context.ts`: builds the claim files (radar, recent posts, limits) the routine would receive.
- `rehearsal/radar.md`, `rehearsal/topic.md`: the routine's radar and topic stages (prompt v3 steps 3 and 4), run by an Opus agent with web search.
- `rehearsal/round-1-rejected/`: the first headline stage (a hook writer and a critic rewarding "contrarian" shapes). It chose THE LAST PAYMENT IS DECIDED BEFORE THE FIRST POST HOLE. Jackson rejected it as not making sense and made Sam Parr's copywriting guide the rule. Kept as the counter-example, with its panel screenshots.
- `rehearsal/round-2-sam-parr/`: the same topic under Sam Parr's process. `description.md` first, `headlines.json` (25 plain-English headlines with first sentences), `reader-1..3.json` (a fence and deck owner, a plumbing and heating shop, a solo painter: three clicks each, plus what confused them), `critic.json` (the headline editor), and `pitch.json` → `pitch.accepted.json` via `validate-pitch.ts`. Winner: WHAT TO PUT IN YOUR CONTRACT SO YOU GET PAID, clicked by all three readers, whose expected article matched the post.
- `rehearsal/round-2-sam-parr/why-this-post-*.png`: the real Blog hub weekly panel rendering the accepted pitch while the post is being written.
