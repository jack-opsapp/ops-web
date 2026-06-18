# P4-2 · Catalog → shared-primitives — converged row mock

The structural recomposition mock (converged PRODUCTS + STOCK rows on `RegisterTable`
with the inline-edit cells preserved, the segment-control before/after, and the one
filled-accent create button standardized across Catalog / Books / Clients) was rendered
**inline for Jackson and approved** on 2026-06-13:

- **Build the rows** → *Approve — build it.*
- **Catalog create label** → *Keep "ADD".*

The full design rationale, the architecture decision (compose inline-edit cells inside
`RegisterTable` rather than extend the shared atoms; extend the primitive only with
`ReactNode` headers + `isRowActive`), the per-file conversion plan, and the parity
checklist live in the spec:

→ `docs/specs/2026-06-13-catalog-convergence-p4-2.md`

Source audit: `docs/audits/2026-06-13-cross-surface-visual-cohesion.md` §3 A1–A6, §4.
