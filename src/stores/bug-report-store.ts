"use client";

import { create } from "zustand";

/**
 * Coordinates the screenshot capture timing between `BugReportTab`
 * (the EdgeTab the operator clicks) and `BugReportDrawer` (the panel
 * that mounts inside the open drawer). The tab fires
 * `requestScreenshot()` BEFORE the drawer mounts so the captured image
 * reflects what was on-screen at the moment the operator triggered the
 * report — not the drawer overlay that appears afterward.
 *
 * The drawer subscribes via `useBugReportStore` and runs the screenshot
 * exactly once per request token. The token is incremented (rather than
 * a boolean toggle) so back-to-back requests still fire even if the
 * previous capture is still in flight.
 */

interface BugReportState {
  /** Monotonically increasing token. Drawer captures when it changes. */
  screenshotToken: number;
  /** Increment the token — fires a fresh capture on the next drawer mount. */
  requestScreenshot: () => void;
}

export const useBugReportStore = create<BugReportState>((set) => ({
  screenshotToken: 0,
  requestScreenshot: () =>
    set((s) => ({ screenshotToken: s.screenshotToken + 1 })),
}));
