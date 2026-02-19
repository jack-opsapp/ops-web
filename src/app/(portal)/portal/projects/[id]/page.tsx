"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Loader2,
  ArrowLeft,
  MapPin,
  Calendar,
  FileText,
  Receipt,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import { PortalStatusBadge } from "@/components/portal/portal-status-badge";
import { PortalPhotoGallery } from "@/components/portal/portal-photo-gallery";
import { PortalTaskTimeline } from "@/components/portal/portal-task-timeline";
import { formatCurrency } from "@/lib/types/pipeline";

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

interface ProjectTask {
  id: string;
  title: string;
  status: string;
  scheduledDate?: string;
}

interface ProjectDetail {
  id: string;
  title: string;
  address: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  projectImages: string[];
  estimates: ProjectEstimate[];
  invoices: ProjectInvoice[];
  tasks: ProjectTask[];
}

function formatDate(date: string | Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;

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

  if (error || !project) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "var(--portal-text-secondary)" }}>
          Unable to load this project. Please try refreshing.
        </p>
        <Link
          href="/portal/home"
          className="inline-flex items-center gap-1 mt-4 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Link
        href="/portal/home"
        className="inline-flex items-center gap-1 text-sm transition-colors"
        style={{ color: "var(--portal-text-secondary)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </Link>

      {/* Project Header */}
      <div
        className="rounded-xl p-6"
        style={{
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
              {formatDate(project.startDate)}
              {project.endDate && ` — ${formatDate(project.endDate)}`}
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
      </div>

      {/* Photo Gallery */}
      {project.projectImages.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            Photos
          </h2>
          <PortalPhotoGallery photos={project.projectImages} />
        </section>
      )}

      {/* Task Timeline */}
      {project.tasks.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            Tasks
          </h2>
          <PortalTaskTimeline tasks={project.tasks} />
        </section>
      )}

      {/* Linked Estimates */}
      {project.estimates.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            Estimates
          </h2>
          <div className="space-y-2">
            {project.estimates.map((est) => (
              <Link key={est.id} href={`/portal/estimates/${est.id}`}>
                <div
                  className="flex items-center justify-between p-4 rounded-lg transition-colors cursor-pointer"
                  style={{
                    backgroundColor: "var(--portal-card)",
                    border: "1px solid var(--portal-border)",
                    borderRadius: "var(--portal-radius)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <FileText
                      className="w-5 h-5 shrink-0"
                      style={{ color: "var(--portal-accent)" }}
                    />
                    <div>
                      <p className="text-sm font-medium">
                        Estimate #{est.estimateNumber}
                        {est.title && ` — ${est.title}`}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "var(--portal-text-secondary)" }}
                      >
                        {formatCurrency(est.total)} · {formatDate(est.issueDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PortalStatusBadge status={est.status} />
                    <ChevronRight
                      className="w-4 h-4"
                      style={{ color: "var(--portal-text-tertiary)" }}
                    />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Linked Invoices */}
      {project.invoices.length > 0 && (
        <section>
          <h2
            className="text-sm font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            Invoices
          </h2>
          <div className="space-y-2">
            {project.invoices.map((inv) => (
              <Link key={inv.id} href={`/portal/invoices/${inv.id}`}>
                <div
                  className="flex items-center justify-between p-4 rounded-lg transition-colors cursor-pointer"
                  style={{
                    backgroundColor: "var(--portal-card)",
                    border: "1px solid var(--portal-border)",
                    borderRadius: "var(--portal-radius)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Receipt
                      className="w-5 h-5 shrink-0"
                      style={{ color: "var(--portal-warning)" }}
                    />
                    <div>
                      <p className="text-sm font-medium">
                        Invoice #{inv.invoiceNumber}
                        {inv.subject && ` — ${inv.subject}`}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "var(--portal-text-secondary)" }}
                      >
                        {inv.balanceDue > 0
                          ? `Balance: ${formatCurrency(inv.balanceDue)} · Due ${formatDate(inv.dueDate)}`
                          : `${formatCurrency(inv.total)} · Paid`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PortalStatusBadge status={inv.status} />
                    <ChevronRight
                      className="w-4 h-4"
                      style={{ color: "var(--portal-text-tertiary)" }}
                    />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Send a Message */}
      <div className="flex justify-center pt-2 pb-4">
        <Link
          href="/portal/messages"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-colors"
          style={{
            backgroundColor: "var(--portal-bg-secondary)",
            border: "1px solid var(--portal-border)",
            color: "var(--portal-text)",
            borderRadius: "var(--portal-radius)",
          }}
        >
          <MessageSquare className="w-4 h-4" />
          Send a Message
        </Link>
      </div>
    </div>
  );
}
