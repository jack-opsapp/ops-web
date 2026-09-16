# Topic funnel proof — 2026-09-16

Local rehearsal of the restored weekly topic funnel on live data, before deployment.

- `live-scan.ts` / `live-radar-scan.json`: the production radar scanner run from a Mac against all 26 watchlist feeds (26/26 answered, 390 signals, 142 offered to the writer).
- `rehearsal-context.ts`: builds the claim files (radar, recent posts, limits) the routine would receive.
- `rehearsal/radar.md`, `rehearsal/topic.md`: the routine's radar and topic stages (prompt v3 steps 3 and 4), run by an Opus agent with web search.
- `rehearsal/hooks.json`: the hook writer's 12 candidates (step 5).
- `rehearsal/critic.json`: the independent critic's pick, sharpened, with a verdict for every candidate (step 5).
- `rehearsal/pitch.json` → `validate-pitch.ts` → `rehearsal/pitch.accepted.json`: the assembled pitch, accepted by OPS's own pitch validation against the live radar rows (step 6).
- `why-this-post-collapsed.png`, `why-this-post-expanded.png`: the real Blog hub weekly panel rendering the accepted pitch.
