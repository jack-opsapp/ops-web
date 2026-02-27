"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { AuthProvider } from "@/components/providers/auth-provider";

// Routes within (auth) group that authenticated users CAN access
const authenticatedAllowedRoutes = ["/locked"];

function AuthRouteGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuthStore();

  const isAllowedWhenAuthenticated = authenticatedAllowedRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  useEffect(() => {
    if (!isLoading && isAuthenticated && !isAllowedWhenAuthenticated) {
      router.replace("/projects");
    }
  }, [isLoading, isAuthenticated, isAllowedWhenAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-2">
          <span className="font-bebas text-[48px] tracking-[0.2em] text-ops-accent leading-none animate-pulse-live">
            OPS
          </span>
        </div>
      </div>
    );
  }

  if (isAuthenticated && !isAllowedWhenAuthenticated) {
    return null;
  }

  // Split layout: hero left, form right
  // On mobile: full-screen form only (hero hidden)
  return (
    <div className="min-h-screen bg-background flex">
      {/* Left: Hero image — hidden on mobile */}
      <div className="hidden lg:block relative w-1/2 min-h-screen overflow-hidden">
        {/* Hero image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('/images/auth-hero.jpg')",
          }}
        />

        {/* Gradient overlay: fades to black on the right edge */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.95) 90%, #000000 100%)",
          }}
        />

        {/* Bottom gradient for text legibility */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 40%, transparent 60%)",
          }}
        />

        {/* Brand mark in bottom-left */}
        <div className="absolute bottom-8 left-8 z-10">
          <p className="font-bebas text-[40px] tracking-[0.2em] text-white/90 leading-none">
            OPS
          </p>
          <p className="font-mohave text-body-sm text-white/50 mt-1">
            Built by trades, for trades.
          </p>
        </div>
      </div>

      {/* Right: Auth form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[420px] animate-fade-in">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AuthGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AuthRouteGate>{children}</AuthRouteGate>
    </AuthProvider>
  );
}
