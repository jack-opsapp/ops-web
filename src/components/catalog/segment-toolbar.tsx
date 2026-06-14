"use client";

/**
 * Catalog working-area chrome. The segment control, filter chips, and drill
 * chip were promoted to the shared `@/components/ui/` primitives (the same
 * ones Books + Clients consume) — re-exported here under the catalog-local
 * names so the segment call sites read naturally. Catalog no longer forks the
 * kit (WEB OVERHAUL P4-2; the prior off-scale Cake-13 segment control + the
 * duplicated chips are gone).
 */

export {
  SegmentControl as CatalogSegmentControl,
  type SegmentControlOption as SegmentOption,
} from "@/components/ui/segment-control";
export {
  FilterChips,
  DismissChip as DrillChip,
  type FilterChipOption,
} from "@/components/ui/filter-chip";
