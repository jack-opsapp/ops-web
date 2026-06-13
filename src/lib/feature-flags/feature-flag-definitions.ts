/**
 * OPS Web - Feature Flag Definitions
 *
 * Maps each feature flag slug to the routes and permissions it controls.
 * Single source of truth imported by both the client store and admin page.
 */

// ─── Route Mapping ───────────────────────────────────────────────────────────

/** Routes gated by each feature flag slug. */
export const FEATURE_FLAG_ROUTES: Record<string, string[]> = {
  pipeline: ["/pipeline"],
  // /books absorbed /accounting + /estimates + /invoices (P3.1). The old
  // paths stay listed through the redirect window — middleware 308s them
  // before render, but the flag must keep gating both ends of the hop.
  accounting: ["/books", "/accounting", "/estimates", "/invoices"],
  // products/inventory were never real feature_flags rows (only pipeline +
  // accounting exist in the DB) — their static entries were dead config. The
  // surfaces collapsed into /catalog (P3.2), which is RBAC-gated only
  // (anyOf products.view / inventory.view in the route registry), not
  // commercially flag-gated.
  // ai_email_review removed 2026-04-24 — collapsed into phase_c
  // (migration 20260424000000). phase_c gates the Phase C operator
  // surfaces: /calibration and the /agent queue (WEB OVERHAUL P2 —
  // company-gated via the synthetic per-company flag from
  // admin_feature_overrides, see /api/feature-flags).
  phase_c: ["/calibration", "/agent"],
  deck_builder: ["/deck-builder"],
  // Per-company dark-launch flag (admin_feature_overrides, not feature_flags).
  // Gated here so fail-closed fallback suppresses it when the API call fails.
  inbox_ui: ["/inbox"],
};

// ─── Permission Mapping ──────────────────────────────────────────────────────

/** RBAC permissions gated by each feature flag slug. */
export const FEATURE_FLAG_PERMISSIONS: Record<string, string[]> = {
  pipeline: ["pipeline.view", "pipeline.manage", "pipeline.configure_stages"],
  accounting: [
    "accounting.view",
    "accounting.manage_connections",
    "estimates.view",
    "estimates.create",
    "estimates.edit",
    "estimates.delete",
    "estimates.send",
    "estimates.convert",
    "invoices.view",
    "invoices.create",
    "invoices.edit",
    "invoices.delete",
    "invoices.send",
    "invoices.record_payment",
    "invoices.void",
    "expenses.view",
    "expenses.create",
    "expenses.edit",
    "expenses.delete",
    "expenses.approve",
    "expenses.configure",
    "documents.manage_templates",
  ],
  // products/inventory: see FEATURE_FLAG_ROUTES note — dead config removed;
  // these permissions gate via RBAC only, never a (nonexistent) flag.
  portal: ["portal.view", "portal.manage_branding"],
  // ai_email_review removed — all AI gating now on phase_c.
  phase_c: ["email.configure_ai"],
  deck_builder: ["deck_builder.view", "deck_builder.create", "deck_builder.edit"],
  projects_table_v2: [],
  pipeline_table_view: [],
  // inbox_ui: per-company dark-launch (no RBAC permissions beyond nav visibility)
  inbox_ui: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Given a pathname, return the flag slug that gates it (or null). */
export function getSlugForRoute(pathname: string): string | null {
  for (const [slug, routes] of Object.entries(FEATURE_FLAG_ROUTES)) {
    for (const route of routes) {
      if (pathname === route || pathname.startsWith(route + "/")) {
        return slug;
      }
    }
  }
  return null;
}

/** Given a permission string, return the flag slug that gates it (or null). */
export function getSlugForPermission(permission: string): string | null {
  for (const [slug, permissions] of Object.entries(FEATURE_FLAG_PERMISSIONS)) {
    if (permissions.includes(permission)) {
      return slug;
    }
  }
  return null;
}
