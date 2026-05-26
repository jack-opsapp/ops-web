/**
 * SPEC admin test-mode cookie.
 *
 * `spec_admin_test_mode = 1` → operator queries include `is_test = true` rows.
 * `spec_admin_test_mode = 0` (or unset) → default; test rows are excluded.
 *
 * Scoped per-operator via the operator's signed-in browser session. The toggle
 * affects `/admin/spec/*` queries only. The public board snapshot is unaffected
 * — `private.refresh_spec_board_snapshot()` always filters `is_test = false`.
 *
 * SERVER ONLY. The toggle is fired by a server action that re-renders the page.
 */

import { cookies } from "next/headers";

const COOKIE_NAME = "spec_admin_test_mode";

export async function getSpecTestMode(): Promise<boolean> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value === "1";
}

export async function setSpecTestMode(enabled: boolean): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, enabled ? "1" : "0", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin/spec",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}
