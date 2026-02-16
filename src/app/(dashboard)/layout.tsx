"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { AuthProvider } from "@/components/providers/auth-provider";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Loader2 } from "lucide-react";

function DashboardAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-[32px] h-[32px] text-ops-accent animate-spin" />
          <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
            Initializing Command Center
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DashboardAuthGate>{children}</DashboardAuthGate>
    </AuthProvider>
  );
}
