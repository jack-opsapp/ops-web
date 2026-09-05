# Local cloud editorial proof — 2026-09-05

This folder contains a local-only, nonpublishing canary. `source.json` is a public OPS blog snapshot; `canary-trace.json` records the two parsed model responses and usage; `canary-result.json` records the approved package and renderer selection. `slide-1.jpg` through `slide-5.jpg` are actual production-renderer outputs, each 1080 × 1350. `preview.html` is the real CloudProduction component rendered with that package into a static browser fixture, with compiled existing Tailwind tokens and embedded OPS fonts in `preview.css`.

The five slides and complete caption were prepared successfully. Estimated usage for this successful attempt is US$0.094948 at the reviewed model prices. A preceding live model attempt failed; that attempt's complete usage was not retained, so this is not the total test bill.

Final focused verification: 274 tests passed, one paid canary skipped by default; targeted production TypeScript and formatting passed. Exact local PostgreSQL tests passed concurrent claims, off-during-render, source withdrawal, terminal recovery, budget controls, stale ownership and notification replay. The initial parallel test run hit one rendering timeout; the full serial run passed without changing that test's timeout.

No production database write, cloud activation, application notification or Instagram publication was performed by this canary. The static fixture does not prove the live admin API or a deployed schedule. Deployment and paid cloud preparation require approval; first real publication is separate.

Both stages received the complete Sam Parr guide. The recorded fingerprint is `33eb69c729c46c56995cedcb87955b732eeba763b0d6a93401e3e6c404ab086e`. The earlier four-slide condensed-guide canary is preserved under `prior-condensed-guide/`; this current five-slide canary uses prompt version `ops-editorial-2026-09-05-v2`. Production deployment and preparation-only activation were subsequently approved; this folder itself remains local-test evidence.
