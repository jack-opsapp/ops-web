"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { AuthProvider } from "@/components/providers/auth-provider";
import { useDictionary } from "@/i18n/client";

// Routes within (auth) group that authenticated users CAN access
const authenticatedAllowedRoutes = ["/locked", "/join", "/account-type"];

// Routes that REQUIRE authentication (show auth popup if not logged in)
const authRequiredRoutes = ["/locked", "/join", "/account-type"];

function AuthRouteGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuthStore();
  const { t } = useDictionary("auth");

  const isAllowedWhenAuthenticated = authenticatedAllowedRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  const requiresAuth = authRequiredRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  const isFullScreen = pathname === "/account-type";

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

  // Show auth-required popup for protected routes when not authenticated
  if (!isAuthenticated && requiresAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="w-14 h-14 mx-auto rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-text-tertiary"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <h2 className="font-mohave text-xl font-semibold text-text-primary uppercase tracking-wide">
              AUTHENTICATION REQUIRED
            </h2>
            <p className="font-kosugi text-[11px] text-text-tertiary mt-2">
              [you must be logged in to access this page]
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => router.push("/login")}
              className="w-full py-3 bg-text-primary rounded font-mohave text-[14px] font-semibold text-background uppercase tracking-wide transition-colors hover:bg-white"
            >
              LOG IN
            </button>
            <button
              onClick={() => router.push("/register")}
              className="w-full py-3 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded font-mohave text-[14px] font-medium text-text-secondary uppercase tracking-wide transition-colors hover:bg-[rgba(255,255,255,0.08)]"
            >
              CREATE ACCOUNT
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isAuthenticated && !isAllowedWhenAuthenticated) {
    return null;
  }

  // Full-screen layout for account-type (canvas particle field)
  if (isFullScreen) {
    return (
      <div className="min-h-screen bg-background">
        {children}
      </div>
    );
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
            {t("tagline")}
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
