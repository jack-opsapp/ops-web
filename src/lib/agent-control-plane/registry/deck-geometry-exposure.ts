import "server-only";
import type { McpExposure } from "./mcp-exposure-catalog";

/** P19-2 isolated protocol candidate. This is a complete, deck-only allowlist,
 * not an overlay or a replacement for an operator's multipurpose connection.
 * No active exposure catalogue, consent or policy manifest imports this object.
 * V28 manifest and v18 consent reservations remain unused: authority is v8.
 */
export const MCP_DECK_GEOMETRY_CANDIDATE_EXPOSURE = Object.freeze({
  revision: "2026-09-10.mcp-exposure.v23",
  toolIds: Object.freeze(["get_deck_design_geometry"]),
  grantableScopes: Object.freeze([
    "ops.customers.read",
    "ops.files.read",
    "ops.jobs.read",
    "ops.schedule.read",
    "ops.site_visits.read",
  ]),
} as const satisfies McpExposure);
