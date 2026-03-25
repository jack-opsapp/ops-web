"use client";

import { useEffect, useMemo, useState } from "react";
import { PortalProviders } from "./providers";
import { PortalShell } from "@/components/portal/portal-shell";
import { PortalHeader } from "@/components/portal/portal-header";
import { PortalNav } from "@/components/portal/portal-nav";
import type {
  PortalBranding,
  PortalCompanyInfo,
  PortalProject,
  PortalEstimate,
  PortalInvoice,
} from "@/lib/types/portal";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [branding, setBranding] = useState<PortalBranding | null>(null);
  const [company, setCompany] = useState<PortalCompanyInfo | null>(null);
  const [projects, setProjects] = useState<PortalProject[]>([]);
  const [estimates, setEstimates] = useState<PortalEstimate[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    async function loadPortalData() {
      try {
        const res = await fetch("/api/portal/data", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setBranding(data.branding ?? null);
          setCompany(data.company ?? null);
          setProjects(data.projects ?? []);
          setEstimates(data.estimates ?? []);
          setInvoices(data.invoices ?? []);
          setUnreadMessages(data.unreadMessages ?? 0);
          if (data.isPreview) {
            setIsPreview(true);
          }
        }
      } catch {
        // Will be handled by middleware redirect
      }
    }
    loadPortalData();
  }, []);

  // Resolve the Project tab href
  const projectHref = useMemo(() => {
    if (projects.length === 0) return "/portal/home";
    if (projects.length === 1) return `/portal/projects/${projects[0].id}`;

    // Multiple projects: find the one with the most recent estimate/invoice activity
    const projectActivity = new Map<string, Date>();
    for (const est of estimates) {
      if (est.projectId) {
        const current = projectActivity.get(est.projectId);
        const estDate = new Date(est.issueDate);
        if (!current || estDate > current) {
          projectActivity.set(est.projectId, estDate);
        }
      }
    }
    for (const inv of invoices) {
      if (inv.projectId) {
        const current = projectActivity.get(inv.projectId);
        const invDate = new Date(inv.issueDate);
        if (!current || invDate > current) {
          projectActivity.set(inv.projectId, invDate);
        }
      }
    }

    // Sort projects by most recent activity
    const sorted = [...projects].sort((a, b) => {
      const aDate = projectActivity.get(a.id)?.getTime() ?? 0;
      const bDate = projectActivity.get(b.id)?.getTime() ?? 0;
      return bDate - aDate;
    });

    return `/portal/projects/${sorted[0].id}`;
  }, [projects, estimates, invoices]);

  const hasUnread = unreadMessages > 0;

  return (
    <PortalProviders>
      <PortalShell branding={branding}>
        {isPreview && (
          <div
            className="text-center py-2 text-xs font-medium tracking-wide"
            style={{
              backgroundColor: "var(--portal-accent, #417394)",
              color: "#fff",
            }}
          >
            Preview Mode — This is how your clients see your portal
          </div>
        )}
        {company && (
          <PortalHeader
            companyName={company.name}
            logoUrl={company.logoUrl ?? branding?.logoUrl ?? null}
            hasUnread={hasUnread}
            activeTab="home"
            projectHref={projectHref}
          />
        )}
        <main className="max-w-3xl mx-auto px-4 py-6 pb-20 md:pb-6">
          {children}
        </main>
        <PortalNav hasUnread={hasUnread} projectHref={projectHref} />
      </PortalShell>
    </PortalProviders>
  );
}
