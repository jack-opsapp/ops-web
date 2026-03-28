/**
 * OPS Web - Feature Flags Store
 *
 * Zustand store for feature flag state (master on/off + user overrides).
 * Loaded at login alongside permissions. Gates sidebar items and routes.
 *
 * Routes and permissions controlled by each flag are stored in the DB
 * and returned by /api/feature-flags. Unknown slugs are treated as accessible.
 */

import { create } from "zustand";

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
    try {
      const res = await fetch(`/api/feature-flags?userId=${userId}`);
      if (!res.ok) {
        console.error("[FeatureFlagsStore] fetch failed:", res.status);
        set({ initialized: true });
        return;
      }
      const data: {
        slug: string;
        enabled: boolean;
        hasOverride: boolean;
        routes: string[];
        permissions: string[];
      }[] = await res.json();

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
    } catch (err) {
      console.error("[FeatureFlagsStore] fetch error:", err);
      set({ initialized: true });
    }
  },

  clear: () => {
    set({ flags: new Map(), initialized: false });
  },
}));

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectFlagsReady = (s: FeatureFlagsState) => s.initialized;

export default useFeatureFlagsStore;
