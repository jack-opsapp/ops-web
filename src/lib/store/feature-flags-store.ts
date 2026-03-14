/**
 * OPS Web - Feature Flags Store
 *
 * Zustand store for feature flag state (master on/off + user overrides).
 * Loaded at login alongside permissions. Gates sidebar items and routes.
 *
 * Routes and permissions controlled by each flag are stored in the DB
 * and returned by /api/feature-flags. Unknown slugs are treated as accessible.
 *
 * FAIL-CLOSED: If the API call fails, the store falls back to the static
 * definitions with all flags disabled. This ensures gated features stay
 * blocked rather than silently becoming accessible.
 */

import { create } from "zustand";
import {
  FEATURE_FLAG_ROUTES,
  FEATURE_FLAG_PERMISSIONS,
} from "@/lib/feature-flags/feature-flag-definitions";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlagState {
  enabled: boolean;
  hasOverride: boolean;
  routes: string[];
  permissions: string[];
}

export interface FeatureFlagsState {
  /** Map of slug → { enabled, hasOverride, routes, permissions } */
  flags: Map<string, FlagState>;
  /** Whether flags have been fetched at least once */
  initialized: boolean;

  /** Can the current user access a feature by slug? */
  canAccessFeature: (slug: string) => boolean;
  /** Is a given RBAC permission unlocked by feature flags? */
  isPermissionUnlocked: (permission: string) => boolean;
  /** Is a given route pathname unlocked by feature flags? */
  isRouteUnlocked: (pathname: string) => boolean;

  /** Fetch flags from the API for a given user. */
  fetchFlags: (userId: string) => Promise<void>;
  /** Clear state on logout. */
  clear: () => void;
}

// ─── Fallback ────────────────────────────────────────────────────────────────

/**
 * Build a fallback flags Map from static definitions with all flags DISABLED.
 * Used when the API call fails so gated features stay blocked (fail-closed)
 * rather than becoming silently accessible (fail-open).
 */
function buildFallbackFlags(): Map<string, FlagState> {
  const fallback = new Map<string, FlagState>();
  const allSlugs = new Set([
    ...Object.keys(FEATURE_FLAG_ROUTES),
    ...Object.keys(FEATURE_FLAG_PERMISSIONS),
  ]);

  for (const slug of allSlugs) {
    fallback.set(slug, {
      enabled: false,
      hasOverride: false,
      routes: FEATURE_FLAG_ROUTES[slug] ?? [],
      permissions: FEATURE_FLAG_PERMISSIONS[slug] ?? [],
    });
  }

  return fallback;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useFeatureFlagsStore = create<FeatureFlagsState>()((set, get) => ({
  flags: new Map(),
  initialized: false,

  canAccessFeature: (slug: string): boolean => {
    const flag = get().flags.get(slug);
    if (!flag) return true; // unknown slug = not gated
    return flag.enabled || flag.hasOverride;
  },

  isPermissionUnlocked: (permission: string): boolean => {
    for (const [slug, flag] of get().flags.entries()) {
      if (flag.permissions.includes(permission)) {
        return get().canAccessFeature(slug);
      }
    }
    return true; // not gated by any flag
  },

  isRouteUnlocked: (pathname: string): boolean => {
    for (const [slug, flag] of get().flags.entries()) {
      for (const route of flag.routes) {
        if (pathname === route || pathname.startsWith(route + "/")) {
          return get().canAccessFeature(slug);
        }
      }
    }
    return true; // not gated by any flag
  },

  fetchFlags: async (userId: string) => {
    /** Attempt a single fetch — returns parsed data or null on failure. */
    const attempt = async (): Promise<
      | { slug: string; enabled: boolean; hasOverride: boolean; routes: string[]; permissions: string[] }[]
      | null
    > => {
      try {
        const res = await fetch(`/api/feature-flags?userId=${userId}`);
        if (!res.ok) {
          console.error("[FeatureFlagsStore] fetch returned", res.status);
          return null;
        }
        return await res.json();
      } catch (err) {
        console.error("[FeatureFlagsStore] fetch threw:", err);
        return null;
      }
    };

    // Try twice before falling back to static definitions
    let data = await attempt();
    if (!data) {
      console.warn("[FeatureFlagsStore] Retrying flag fetch…");
      data = await attempt();
    }

    if (!data) {
      // FAIL-CLOSED: use static definitions with all flags disabled.
      // Gated features stay blocked; non-gated features work normally.
      console.error(
        "[FeatureFlagsStore] All fetch attempts failed — falling back to static definitions (all gated features blocked)"
      );
      set({ flags: buildFallbackFlags(), initialized: true });
      return;
    }

    const flags = new Map<string, FlagState>();
    for (const row of data) {
      flags.set(row.slug, {
        enabled: row.enabled,
        hasOverride: row.hasOverride,
        routes: row.routes ?? [],
        permissions: row.permissions ?? [],
      });
    }
    set({ flags, initialized: true });
  },

  clear: () => {
    set({ flags: new Map(), initialized: false });
  },
}));

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectFlagsReady = (s: FeatureFlagsState) => s.initialized;

export default useFeatureFlagsStore;
