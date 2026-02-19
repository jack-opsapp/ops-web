"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, FileText, Receipt, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PortalProjectCard } from "@/components/portal/portal-project-card";
import { PortalStatusBadge } from "@/components/portal/portal-status-badge";
import { formatCurrency } from "@/lib/types/pipeline";
import type { PortalClientData } from "@/lib/types/portal";

function formatDate(date: Date | string | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function PortalHomePage() {
  const { data, isLoading, error } = useQuery<PortalClientData>({
    queryKey: ["portal", "data"],
    queryFn: async () => {
      const res = await fetch("/api/portal/data", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load portal data");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--portal-accent)" }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "var(--portal-text-secondary)" }}>
          Unable to load your portal. Please try refreshing.
        </p>
      </div>
    );
  }

  const actionEstimates = data.estimates.filter(
    (e) => e.status === "sent" || e.status === "viewed" || e.hasUnansweredQuestions
  );

  const unpaidInvoices = data.invoices.filter(
    (i) => i.balanceDue > 0 && i.status !== "void" && i.status !== "written_off"
  );

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1
          className="text-2xl mb-1"
          style={{
            fontFamily: "var(--portal-heading-font)",
            fontWeight: "var(--portal-heading-weight)",
            textTransform: "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
          }}
        >
          Hi{data.client.name ? `, ${data.client.name.split(" ")[0]}` : ""}
        </h1>
        {data.branding.welcomeMessage && (
          <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>
            {data.branding.welcomeMessage}
          </p>
        )}
      </div>

      {/* Estimates needing action */}
      {actionEstimates.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            Estimates needing your attention
          </h2>
          <div className="space-y-2">
            {actionEstimates.map((est) => (
              <Link key={est.id} href={`/portal/estimates/${est.id}`}>
                <div
                  className="flex items-center justify-between p-4 rounded-lg transition-colors cursor-pointer"
                  style={{
                    backgroundColor: "var(--portal-card)",
                    border: "1px solid var(--portal-border)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 shrink-0" style={{ color: "var(--portal-accent)" }} />
                    <div>
                      <p className="text-sm font-medium">
                        Estimate #{est.estimateNumber}
                        {est.title && ` — ${est.title}`}
                      </p>
                      <p className="text-xs" style={{ color: "var(--portal-text-secondary)" }}>
                        {formatCurrency(est.total)} · {formatDate(est.issueDate)}
                        {est.hasUnansweredQuestions && (
                          <span style={{ color: "var(--portal-warning)" }}> · Questions pending</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PortalStatusBadge status={est.status} />
                    <ChevronRight className="w-4 h-4" style={{ color: "var(--portal-text-tertiary)" }} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Unpaid invoices */}
      {unpaidInvoices.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            Invoices due
          </h2>
          <div className="space-y-2">
            {unpaidInvoices.map((inv) => (
              <Link key={inv.id} href={`/portal/invoices/${inv.id}`}>
                <div
                  className="flex items-center justify-between p-4 rounded-lg transition-colors cursor-pointer"
                  style={{
                    backgroundColor: "var(--portal-card)",
                    border: "1px solid var(--portal-border)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Receipt className="w-5 h-5 shrink-0" style={{ color: "var(--portal-warning)" }} />
                    <div>
                      <p className="text-sm font-medium">
                        Invoice #{inv.invoiceNumber}
                        {inv.subject && ` — ${inv.subject}`}
                      </p>
                      <p className="text-xs" style={{ color: "var(--portal-text-secondary)" }}>
                        Balance: {formatCurrency(inv.balanceDue)} · Due {formatDate(inv.dueDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PortalStatusBadge status={inv.status} />
                    <ChevronRight className="w-4 h-4" style={{ color: "var(--portal-text-tertiary)" }} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Projects */}
      <section>
        <h2
          className="text-sm font-medium uppercase tracking-wider mb-3"
          style={{ color: "var(--portal-text-tertiary)" }}
        >
          Your projects
        </h2>
        {data.projects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.projects.map((project) => (
              <PortalProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div
            className="text-center py-12 rounded-lg"
            style={{
              backgroundColor: "var(--portal-card)",
              border: "1px solid var(--portal-border)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>
              No projects yet. Your service provider will share project details with you here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
