"use client";

import { AuthProvider } from "@/components/providers/auth-provider";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-2 relative overflow-hidden">
        {children}
      </div>
    </AuthProvider>
  );
}
