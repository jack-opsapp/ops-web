"use client";

import { AuthProvider } from "@/components/providers/auth-provider";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center px-3 py-6 relative overflow-hidden">
        {children}
      </div>
    </AuthProvider>
  );
}
