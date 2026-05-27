/**
 * /account route group — customer-side SPEC engagement surfaces (Phase 1: refund
 * request only; Phase 2: full project portal).
 *
 * Standalone — no dashboard sidebar, no topbar. Auth enforcement lives inside
 * each child page so unauthenticated users get redirected to /login with a
 * returnTo query param scoped to the requested resource.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account | OPS",
  robots: { index: false, follow: false },
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-black text-text">{children}</div>;
}
