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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-2">
      <div className="w-full max-w-[420px] animate-fade-in">
        {children}
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
