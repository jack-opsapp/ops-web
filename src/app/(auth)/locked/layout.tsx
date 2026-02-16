"use client";

import { AuthProvider } from "@/components/providers/auth-provider";

/**
 * Layout override for the /locked route.
 *
 * Unlike other (auth) routes, the lockout page is shown to authenticated
 * users whose subscription has expired. This layout bypasses the
 * AuthRouteGate redirect and provides a full-width container suited
 * for the pricing card layout.
 */
export default function LockedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen bg-background relative overflow-hidden"
      style={{
        backgroundImage: [
          "linear-gradient(rgba(65, 115, 148, 0.03) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(65, 115, 148, 0.03) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: "24px 24px",
      }}
    >
      {/* Ambient glow effects */}
      <div className="absolute top-[15%] left-[10%] w-[400px] h-[400px] bg-ops-accent/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[15%] right-[10%] w-[300px] h-[300px] bg-ops-amber/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[50%] left-[50%] w-[250px] h-[250px] bg-ops-error/3 rounded-full blur-[100px] pointer-events-none -translate-x-1/2 -translate-y-1/2" />

      <div className="relative z-10 animate-fade-in">
        {children}
      </div>
    </div>
  );
}
