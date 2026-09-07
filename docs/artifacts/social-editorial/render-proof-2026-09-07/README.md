# Carousel render proof — 2026-09-07

Visual proof for Task 4 of `docs/plans/2026-09-07-instagram-subscription-authoring.md`:
the renderer repair, the blog copy policy, and the frame furniture.

## The defect this replaces

`docs/artifacts/social-editorial/manual-run-2026-09-05/` holds the real Fable draft
that shipped through the old renderer. `editorial-cover.tsx` read `content.subtitle`
and ignored `slide.body`, so **all five slides were the same cover photo with a
different headline** — no body copy, no article title, no URL, and the internal
treatment name (`EDITORIAL COVER · 01/05`) printed in the footer. A stranger could
not tell what the article was or where to read it.

## How to reproduce

```bash
cd <worktree>
npx tsx \
  --tsconfig docs/artifacts/social-editorial/render-proof-2026-09-07/tsconfig.json \
  docs/artifacts/social-editorial/render-proof-2026-09-07/render.mts
```

`render.mts` calls the real `renderSocialPost`, `prepareSubmission` and
`selectSocialTemplate`. Nothing is stubbed except asset storage, which writes to this
folder instead of S3. The local `tsconfig.json` maps `server-only` to `server-only.ts`
(an empty shim) so the server renderer loads outside Next, and sets `jsx: react-jsx`.
Every slide is written twice: at full 1080×1350, and downscaled to 390 px wide — the
width of a phone in the Instagram feed — as `…@390.jpg`.

## What was rendered

| Case | Package | Treatment | Files |
|---|---|---|---|
| a | The saved 2026-09-05 Fable draft, re-run through `prepareSubmission(…, "blog")`. Candidate reconstructed from `result.json` (`package.submission.content` + `package.evidence`, `story_type: blog_signal`); cover downloaded live from `source_snapshot.thumbnail_url`. Treatment chosen by the real selector. | `editorial_cover` | `a-fable-blog-01..06` |
| b | Synthetic five-slide operator protocol | `signal_grid` | `b-protocol-signal-grid-01..05` |
| c | Synthetic roast card | `roast_file` | `c-roast-file-01..03` |
| d | Blog package with an 88-character title | `split_signal` | `d-long-title-split-signal-01..05` |
| e | Worst case: 100-character headlines and 350-character bodies — the exact contract ceilings — plus an 89-character closing URL | `operator_brief` | `e-worst-case-operator-brief-01..05` |

`prepareSubmission` appends the server-owned closing slide, so a 4-slide blog
candidate renders 5 slides and the 5-slide Fable candidate renders 6.

## Every image, and what it shows

Each row was viewed at full size **and** at 390 px.

### a — Fable blog carousel (the repaired defect)

| Image | Verdict |
|---|---|
| `a-fable-blog-01` | Cover. Article photo, fade, `NEW FIELD NOTE`, the hook headline, and the article title (`FABLE 5.1 IS OUT. HERE'S WHAT IT MEANS FOR YOUR SHOP.`) underneath. Header right prints `SEP 01 · 2026`; footer prints `01 / 06`. The reader now knows which article this is. |
| `a-fable-blog-02` | Clean canvas text slide: `TAKEAWAY 01`, headline, rule, body. Body copy renders — this slide was a duplicate cover before. |
| `a-fable-blog-03` | `TAKEAWAY 02`, two-line body, no clipping. |
| `a-fable-blog-04` | `TAKEAWAY 03` with the longest body in the set (three lines). Fits with room to spare. |
| `a-fable-blog-05` | `TAKEAWAY 04`. Clean. |
| `a-fable-blog-06` | Closing slide: `FULL ARTICLE` / `KEEP READING` / `opsapp.co/journal/claude-fable-5-1-first-test-gpt-5-7-astra` in JetBrains Mono, wrapping at a hyphen. Legible and retypeable at 390 px. |

### b — operator protocol on signal_grid

| Image | Verdict |
|---|---|
| `b-protocol-signal-grid-01..05` | Eyebrow, step number, headline, hairline and body read as one centred block on every slide. No date in the header (recurring kinds carry no `content.date`), which leaves the masthead alone on its rule — correct, not broken. |

### c — roast card on roast_file

| Image | Verdict |
|---|---|
| `c-roast-file-01..03` | Agent-lavender eyebrow, headline, body between hairlines, verdict line. Bodies render on all three slides. |

### d — 88-character title on split_signal

| Image | Verdict |
|---|---|
| `d-long-title-split-signal-01..04` | Headline steps down and wraps to three lines in the narrow column beside the image panel; body renders beneath. No collision with the panel. |
| `d-long-title-split-signal-05` | Closing slide in the narrow column. The URL wraps after the slash and at hyphens across three lines, still legible at 390 px. |

The image panel renders as a flat grey card here because case d uses the neutral
placeholder, not a real photo.

### e — the contract ceilings on operator_brief

| Image | Verdict |
|---|---|
| `e-worst-case-operator-brief-01..04` | 100-character headline sets four lines at the stepped-down size; the 350-character body sets five lines. Both sit inside the frame with vertical room left over. Readable at 390 px. |
| `e-worst-case-operator-brief-05` | Closing slide with an 89-character URL over two lines, breaking at `before-you-`. |

## What looking at the images changed

1. **Zero-width break opportunities in URLs — reverted.** The first attempt inserted
   `U+200B` after every `/` and `-` so the slug would wrap on a path boundary. Satori
   gives the zero-width space a real advance, so `a-fable-blog-06` rendered as
   `opsapp.co/ journal/ claude- fable- 5- 1- first-` with visible gaps. Replaced with
   `wordBreak: "break-word"`, which keeps the line breaker's own opportunities (the
   slug's hyphens) and only splits inside a token when nothing else fits. `break-all`,
   the original choice, cut the slug mid-token (`…first-test-gp` / `t-5-7-astra`).
2. **`signal_grid` had an orphaned top row.** The eyebrow and the large step number
   were pinned to the top of the frame while the headline and body were centred,
   leaving a void between them. Both now sit inside the centred block.
3. **The cover subtitle was too small to read on a phone.** `SOCIAL_TYPE.subtitle`
   went from 31 to 34. It is the line that tells the reader which article this is, so
   it earns the size.
4. **A 350-character single token overflowed the right edge.** Found by the margin
   assertion in `tests/unit/social/render-social-post.test.tsx`, not by eye: a body
   with no spaces forced the slide container past the frame. `Headline` and `BodyCopy`
   now carry `wordBreak: "break-word"`, and the frame's content row carries
   `minWidth: 0`.

## What was checked on every image

- Body copy present on every slide, not just the cover.
- No internal treatment label anywhere in the artwork; footer carries only `NN / NN`
  and the OPS mark.
- Header right carries `content.date` when the package has one.
- No clipping, no overflow, nothing inside the 24–30 px outer safe margin.
- Legible at 390 px — the phone-feed width — not just at 1080 px.
- Every value traced to `src/lib/social/render/theme.ts`; no colour, spacing, radius
  or font literal in `frame.tsx` or any treatment.

## Boundaries

- The cover in case a is the live production image, fetched over the network at render
  time. Cases b–e use a flat neutral placeholder; they are text treatments, so the
  placeholder only stands in for the `split_signal` panel.
- This proves the renderer and the copy policy. It does not exercise the cron worker,
  the handoff endpoints, S3 upload, or Instagram publication.
