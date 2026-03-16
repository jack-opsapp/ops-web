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
  accounting: ["/accounting", "/estimates", "/invoices"],
  products: ["/products"],
  inventory: ["/inventory"],
  portal: ["/portal-inbox"],
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
  ],
  products: ["products.view", "products.manage"],
  inventory: ["inventory.view", "inventory.manage", "inventory.import"],
  portal: ["portal.view", "portal.manage_branding"],
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
