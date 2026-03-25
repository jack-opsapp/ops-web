"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import {
  Loader2,
  ArrowLeft,
  MapPin,
  Calendar,
  FileText,
  Receipt,
  MessageSquare,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { PortalStatusBadge } from "@/components/portal/portal-status-badge";
import { PortalPhotoGallery } from "@/components/portal/portal-photo-gallery";
import { PortalPhaseTimeline } from "@/components/portal/portal-phase-timeline";
import { PortalProjectSwitcher } from "@/components/portal/portal-project-switcher";
import { usePortalData } from "@/lib/hooks/use-portal-data";
import { formatCurrency } from "@/lib/types/pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  source: string;
  caption: string | null;
}

interface ProjectTask {
  id: string;
  title: string;
  status: string;
  displayOrder: number;
  taskType: { id: string; name: string; color: string } | null;
}

interface ProjectEstimate {
  id: string;
  estimateNumber: string;
  title: string | null;
  status: string;
  total: number;
  issueDate: string;
}

interface ProjectInvoice {
  id: string;
  invoiceNumber: string;
  subject: string | null;
  status: string;
  total: number;
  balanceDue: number;
  dueDate: string;
}

interface ProjectDetail {
  id: string;
  title: string;
  address: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  photos: ProjectPhoto[];
  estimates: ProjectEstimate[];
  invoices: ProjectInvoice[];
  tasks: ProjectTask[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Statuses that indicate the client needs to take action */
const ACTION_NEEDED_STATUSES = new Set([
  "sent",
  "viewed",
  "changes_requested",
  "awaiting_payment",
  "past_due",
]);

function formatDate(date: string | Date | null, locale: Locale): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString(getDateLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { t } = useDictionary("portal");
  const { locale } = useLocale();
  const params = useParams();
  const id = params.id as string;

  // Portal aggregate data (for project switcher)
  const { data: portalData } = usePortalData();

  const { data: project, isLoading, error } = useQuery<ProjectDetail>({
    queryKey: ["portal", "project", id],
    queryFn: async () => {
      const res = await fetch(`/api/portal/projects/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load project");
      return res.json();
    },
    enabled: !!id,
  });

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: "var(--portal-accent)" }}
        />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !project) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "var(--portal-text-secondary)" }}>
          {t("project.loadError")}
        </p>
        <Link
          href="/portal/home"
          className="inline-flex items-center gap-1 mt-4 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          {t("project.backHome")}
        </Link>
      </div>
    );
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const photos = project.photos ?? [];
  const tasks = project.tasks ?? [];
  const estimates = project.estimates ?? [];
  const invoices = project.invoices ?? [];
  const documents = [
    ...estimates.map((e) => ({ ...e, type: "estimate" as const })),
    ...invoices.map((i) => ({ ...i, type: "invoice" as const })),
  ];

  // Projects for switcher
  const allProjects = portalData?.projects ?? [];

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Link
        href="/portal/home"
        className="inline-flex items-center gap-1 text-sm transition-colors"
        style={{ color: "var(--portal-text-secondary)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        {t("project.back")}
      </Link>

      {/* ── 1. Project Header ──────────────────────────────────────────── */}
      <div
        className="rounded-xl"
        style={{
          padding: "var(--portal-card-padding, 24px)",
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
          borderRadius: "var(--portal-radius-lg)",
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1
            className="text-xl"
            style={{
              fontFamily: "var(--portal-heading-font)",
              fontWeight: "var(--portal-heading-weight)",
              textTransform: "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
            }}
          >
            {project.title}
          </h1>
          <PortalStatusBadge status={project.status} />
        </div>

        {project.address && (
          <p
            className="flex items-center gap-1.5 text-sm mb-2"
            style={{ color: "var(--portal-text-secondary)" }}
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{project.address}</span>
          </p>
        )}

        {(project.startDate || project.endDate) && (
          <p
            className="flex items-center gap-1.5 text-sm mb-2"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>
              {formatDate(project.startDate, locale)}
              {project.endDate && ` — ${formatDate(project.endDate, locale)}`}
            </span>
          </p>
        )}

        {project.description && (
          <p
            className="text-sm leading-relaxed mt-3"
            style={{ color: "var(--portal-text-secondary)" }}
          >
            {project.description}
          </p>
        )}

        {/* Project Switcher */}
        {allProjects.length >= 2 && (
          <div className="mt-4">
            <PortalProjectSwitcher
              currentProjectId={id}
              projects={allProjects.map((p) => ({
                id: p.id,
                title: p.title,
                status: p.status,
              }))}
            />
          </div>
        )}
      </div>

      {/* ── 2. Project Progress ────────────────────────────────────────── */}
      {tasks.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{
              color: "var(--portal-text-tertiary)",
              letterSpacing: "var(--portal-letter-spacing)",
            }}
          >
            {t("project.progress")}
          </h2>
          <PortalPhaseTimeline tasks={tasks} />
        </section>
      )}

      {/* ── 3. Photos ──────────────────────────────────────────────────── */}
      {photos.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{
              color: "var(--portal-text-tertiary)",
              letterSpacing: "var(--portal-letter-spacing)",
            }}
          >
            {t("project.photos")}
          </h2>
          <PortalPhotoGallery photos={photos} />
        </section>
      )}

      {/* ── 4. Documents ───────────────────────────────────────────────── */}
      {documents.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{
              color: "var(--portal-text-tertiary)",
              letterSpacing: "var(--portal-letter-spacing)",
            }}
          >
            {t("project.documents")}
          </h2>
          <div className="space-y-2">
            {documents.map((doc) => {
              const isEstimate = doc.type === "estimate";
              const href = isEstimate
                ? `/portal/estimates/${doc.id}`
                : `/portal/invoices/${doc.id}`;
              const status = doc.status;
              const needsAction = ACTION_NEEDED_STATUSES.has(status);

              return (
                <Link key={doc.id} href={href}>
                  <div
                    className="flex items-center justify-between p-4 rounded-lg transition-colors cursor-pointer"
                    style={{
                      backgroundColor: "var(--portal-card)",
                      border: needsAction
                        ? "1px solid var(--portal-accent)"
                        : "1px solid var(--portal-border)",
                      borderRadius: "var(--portal-radius)",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {isEstimate ? (
                        <FileText
                          className="w-5 h-5 shrink-0"
                          style={{ color: "var(--portal-accent)" }}
                        />
                      ) : (
                        <Receipt
                          className="w-5 h-5 shrink-0"
                          style={{
                            color: needsAction
                              ? "var(--portal-warning)"
                              : "var(--portal-accent)",
                          }}
                        />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            {isEstimate
                              ? `${t("estimate.heading")} #${(doc as ProjectEstimate).estimateNumber}`
                              : `${t("invoice.heading")} #${(doc as ProjectInvoice).invoiceNumber}`}
                            {isEstimate && (doc as ProjectEstimate).title
                              ? ` — ${(doc as ProjectEstimate).title}`
                              : !isEstimate && (doc as ProjectInvoice).subject
                                ? ` — ${(doc as ProjectInvoice).subject}`
                                : ""}
                          </p>
                          {needsAction && (
                            <AlertCircle
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: "var(--portal-accent)" }}
                            />
                          )}
                        </div>
                        <p
                          className="text-xs"
                          style={{ color: "var(--portal-text-secondary)" }}
                        >
                          {isEstimate
                            ? `${formatCurrency((doc as ProjectEstimate).total)} · ${formatDate(
                                (doc as ProjectEstimate).issueDate,
                                locale
                              )}`
                            : (doc as ProjectInvoice).balanceDue > 0
                              ? `${t("invoice.balanceDue")}: ${formatCurrency(
                                  (doc as ProjectInvoice).balanceDue
                                )} · ${t("invoice.due")} ${formatDate(
                                  (doc as ProjectInvoice).dueDate,
                                  locale
                                )}`
                              : `${formatCurrency((doc as ProjectInvoice).total)} · ${t("project.paid")}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <PortalStatusBadge status={status} />
                      <ChevronRight
                        className="w-4 h-4"
                        style={{ color: "var(--portal-text-tertiary)" }}
                      />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 5. Contact / Send a Message ────────────────────────────────── */}
      <section>
        <h2
          className="text-sm font-medium uppercase tracking-wider mb-3"
          style={{
            color: "var(--portal-text-tertiary)",
            letterSpacing: "var(--portal-letter-spacing)",
          }}
        >
          {t("project.contact")}
        </h2>
        <div className="flex justify-center pt-2 pb-4">
          <Link
            href={`/portal/messages?projectId=${id}`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "var(--portal-accent)",
              color: "var(--portal-accent-text)",
              borderRadius: "var(--portal-radius)",
            }}
          >
            <MessageSquare className="w-4 h-4" />
            {t("project.sendMessage")}
          </Link>
        </div>
      </section>
    </div>
  );
}
