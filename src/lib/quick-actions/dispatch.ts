"use client";

import { isWindowAction, type FABAction } from "@/lib/constants/fab-actions";
import { useWindowStore } from "@/stores/window-store";

type WindowStoreState = ReturnType<typeof useWindowStore.getState>;

/**
 * Everything a quick action needs to run. The three window openers are the
 * EXACT store method types (Pick<>) so callers pass them straight through
 * with no shape coercion; `t` resolves the floating-window title from the
 * `quick-actions` dictionary; `router` is the Next router (push only).
 */
export type QuickActionDispatchDeps = Pick<
  WindowStoreState,
  "openWindow" | "openProjectWindow" | "openClientWindow"
> & {
  router: { push: (href: string) => void };
  t: (key: string) => string;
};

/**
 * Run a quick action — the single source of truth for the window-vs-route
 * dispatch shared by the bottom-right Create menu and the ⌘K command palette,
 * so the two creation surfaces can never drift apart again (they did: the
 * palette used to create via the legacy `/projects/new` route while the rail
 * opened the project-workspace window).
 *
 * Deliberately does NOT apply the setup gate or close any surface — those are
 * caller concerns (the Create menu wraps this in `gatedAction`; the palette
 * closes itself first).
 */
export function dispatchQuickAction(
  action: FABAction,
  deps: QuickActionDispatchDeps,
): void {
  if (isWindowAction(action)) {
    if (action.target === "project-workspace") {
      // Project + client workspaces use their dedicated openers (centralised
      // id derivation + meta packaging). Mode comes from action.meta,
      // defaulting to "creating" — how every quick action lands here.
      deps.openProjectWindow({
        projectId: null,
        mode: action.meta?.initialMode ?? "creating",
      });
    } else if (action.target === "client-workspace") {
      deps.openClientWindow({
        clientId: null,
        mode: action.meta?.initialMode ?? "creating",
      });
    } else {
      deps.openWindow({
        id: action.target,
        title: deps.t(action.labelKey),
        type: action.target,
      });
    }
  } else {
    deps.router.push(action.target as string);
  }
}
