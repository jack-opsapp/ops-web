"use client";

/**
 * Layout override for the /locked route.
 *
 * Authenticated users with an inactive subscription land here. The
 * layout is intentionally bare — pure black canvas — so the centered
 * LockoutShell + brand lockup carry the surface alone, per
 * docs/superpowers/specs/2026-05-07-lockout-redesign-design.md.
 *
 * No ambient glow orbs, no grid backdrop — those were spec violations
 * (dropped 2026-05-07).
 */
import { OpsLockup } from "@/components/brand";

export default function LockedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <OpsLockup
        orientation="vertical"
        className="h-16 w-auto mb-8"
        title=""
      />
      {children}
    </div>
  );
}
