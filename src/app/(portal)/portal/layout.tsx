"use client";

import { useEffect, useState } from "react";
import { PortalProviders } from "./providers";
import { PortalShell } from "@/components/portal/portal-shell";
import { PortalHeader } from "@/components/portal/portal-header";
import { PortalNav } from "@/components/portal/portal-nav";
import type { PortalBranding, PortalCompanyInfo } from "@/lib/types/portal";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [branding, setBranding] = useState<PortalBranding | null>(null);
  const [company, setCompany] = useState<PortalCompanyInfo | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    async function loadBranding() {
      try {
        const res = await fetch("/api/portal/data", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setBranding(data.branding ?? null);
          setCompany(data.company ?? null);
          setUnreadMessages(data.unreadMessages ?? 0);
        }
      } catch {
        // Will be handled by middleware redirect
      }
    }
    loadBranding();
  }, []);

  return (
    <PortalProviders>
      <PortalShell branding={branding}>
        {company && (
          <PortalHeader
            companyName={company.name}
            logoUrl={company.logoUrl ?? branding?.logoUrl ?? null}
            unreadMessages={unreadMessages}
          />
        )}
        <main className="max-w-5xl mx-auto px-4 py-6 pb-20 sm:pb-6">
          {children}
        </main>
        <PortalNav unreadMessages={unreadMessages} />
      </PortalShell>
    </PortalProviders>
  );
}
