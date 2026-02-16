"use client";

import { AuthProvider } from "@/components/providers/auth-provider";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div
        className="min-h-screen bg-background flex flex-col items-center justify-center p-2 relative overflow-hidden"
        style={{
          backgroundImage: [
            "linear-gradient(rgba(65, 115, 148, 0.03) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(65, 115, 148, 0.03) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "24px 24px",
        }}
      >
        {/* Ambient glow */}
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-ops-accent/5 rounded-full blur-[150px] pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/3 w-[300px] h-[300px] bg-ops-amber/5 rounded-full blur-[120px] pointer-events-none" />

        {children}
      </div>
    </AuthProvider>
  );
}
