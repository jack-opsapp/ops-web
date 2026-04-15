"use client";

import { useState, useTransition, useEffect, Fragment } from "react";
import { SubTabs } from "../../_components/sub-tabs";
import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { FeatureRequest, PromoCode, BugReportRow } from "@/lib/admin/types";

const STATUS_OPTIONS = ["new", "reviewing", "planned", "in-progress", "done", "wont-fix"] as const;
const STATUS_COLORS: Record<string, string> = {
  new: "#C4A868",
  reviewing: "#8195B5",
  planned: "#597794",
  "in-progress": "#9DB582",
  done: "#6B8F71",
  "wont-fix": "#6B6B6B",
};

const BUG_STATUS_OPTIONS = ["new", "triaged", "in_progress", "resolved", "closed", "duplicate"] as const;
const BUG_STATUS_COLORS: Record<string, string> = {
  new: "#C4A868",
  triaged: "#8195B5",
  in_progress: "#597794",
  resolved: "#9DB582",
  closed: "#6B8F71",
  duplicate: "#6B6B6B",
};

const BUG_PRIORITY_OPTIONS = ["none", "low", "medium", "high", "urgent"] as const;
const BUG_PRIORITY_COLORS: Record<string, string> = {
  urgent: "#D97757",
  high: "#C4A868",
  medium: "#8195B5",
  low: "#6B8F71",
  none: "#6B6B6B",
};

interface FeedbackContentProps {
  featureRequests: FeatureRequest[];
  promoCodes: PromoCode[];
  bugReports: BugReportRow[];
}

export function FeedbackContent({ featureRequests, promoCodes, bugReports }: FeedbackContentProps) {
  return (
    <SubTabs tabs={["Bug Reports", "Feature Requests", "Promo Codes"]}>
      {(tab) => {
        if (tab === "Bug Reports") return <BugReportsTab reports={bugReports} />;
        if (tab === "Feature Requests") return <FeatureRequestsTab requests={featureRequests} />;
        if (tab === "Promo Codes") return <PromoCodesTab codes={promoCodes} />;
        return null;
      }}
    </SubTabs>
  );
}

function FeatureRequestsTab({ requests }: { requests: FeatureRequest[] }) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [items, setItems] = useState(requests);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const sort = useSortState("created_at");

  const types = Array.from(new Set(items.map((r) => r.type)));

  const filtered = sort.sorted(
    items.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (typeFilter !== "ALL" && r.type !== typeFilter) return false;
      return true;
    })
  );

  async function handleStatusChange(id: string, newStatus: string) {
    startTransition(async () => {
      try {
        await fetch("/api/admin/feature-requests/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status: newStatus }),
        });
        setItems((prev) => prev.map((r) => r.id === id ? { ...r, status: newStatus } : r));
      } catch {
        // Revert on error
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Status + Type Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {["ALL", ...STATUS_OPTIONS].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={[
                "px-3 py-1.5 rounded-full font-mohave text-[12px] uppercase border transition-colors",
                statusFilter === f
                  ? "text-[#E5E5E5] border-white/[0.12] bg-white/[0.05]"
                  : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
              ].join(" ")}
            >
              {f}
            </button>
          ))}
        </div>
        {types.length > 1 && (
          <>
            <div className="w-px h-6 bg-white/[0.08] self-center" />
            <div className="flex gap-1 flex-wrap">
              {["ALL", ...types].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={[
                    "px-3 py-1.5 rounded-full font-mohave text-[12px] uppercase border transition-colors",
                    typeFilter === t
                      ? "text-[#597794] border-[#597794]/30 bg-[#597794]/10"
                      : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
                  ].join(" ")}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <SortableTableHeader
              columns={[
                { key: "type", label: "Type" },
                { key: "title", label: "Title" },
                { key: "platform", label: "Platform" },
                { key: "status", label: "Status" },
                { key: "user_email", label: "User" },
                { key: "created_at", label: "Date" },
              ]}
              sort={sort.sort}
              onSort={sort.toggle}
              className="px-6"
            />
          </thead>
          <tbody>
        {filtered.map((r) => {
          const statusColor = STATUS_COLORS[r.status] ?? "#6B6B6B";
          return (
            <tr key={r.id} className="border-b border-white/[0.05] last:border-0">
              <td className="px-6 py-3 font-mohave text-[13px] text-[#A0A0A0]">{r.type}</td>
              <td className="px-2 py-3">
                <button
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="font-mohave text-[14px] text-[#E5E5E5] truncate text-left hover:text-[#597794] transition-colors cursor-pointer"
                >
                  {r.title}
                </button>
                {expandedId === r.id && r.description && (
                  <p className="font-kosugi text-[12px] text-[#A0A0A0] mt-2 whitespace-pre-wrap">
                    {r.description}
                  </p>
                )}
              </td>
              <td className="px-2 py-3 font-mohave text-[13px] text-[#A0A0A0]">{r.platform ?? "\u2014"}</td>
              <td className="px-2 py-3">
                <select
                  value={r.status}
                  onChange={(e) => handleStatusChange(r.id, e.target.value)}
                  disabled={isPending}
                  className="bg-transparent border rounded px-2 py-1 font-mohave text-[12px] uppercase cursor-pointer"
                  style={{ color: statusColor, borderColor: statusColor }}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s} className="bg-[#1D1D1D] text-[#E5E5E5]">
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-3 font-kosugi text-[12px] text-[#6B6B6B] truncate">{r.user_email ?? "\u2014"}</td>
              <td className="px-2 py-3 font-kosugi text-[12px] text-[#6B6B6B]">
                [{new Date(r.created_at).toLocaleDateString()}]
              </td>
            </tr>
          );
        })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No feature requests</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PromoCodesTab({ codes }: { codes: PromoCode[] }) {
  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      <div className="grid grid-cols-6 px-6 py-3 border-b border-white/[0.08]">
        {["CODE", "DISCOUNT", "USAGE", "MAX", "STATUS", "DATE"].map((h) => (
          <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
        ))}
      </div>
      {codes.map((c) => (
        <div key={c.id} className="grid grid-cols-6 px-6 items-center h-14 border-b border-white/[0.05] last:border-0">
          <span className="font-mohave text-[14px] text-[#E5E5E5] font-mono">{c.code}</span>
          <span className="font-mohave text-[14px] text-[#A0A0A0]">
            {c.discount_percent ? `${c.discount_percent}%` : c.discount_amount ? `$${c.discount_amount}` : "—"}
          </span>
          <span className="font-mohave text-[14px] text-[#A0A0A0]">{c.usage_count}</span>
          <span className="font-mohave text-[14px] text-[#A0A0A0]">{c.max_uses ?? "∞"}</span>
          <span className={`font-mohave text-[13px] ${c.active ? "text-[#9DB582]" : "text-[#6B6B6B]"}`}>
            {c.active ? "ACTIVE" : "INACTIVE"}
          </span>
          <span className="font-kosugi text-[12px] text-[#6B6B6B]">
            [{new Date(c.created_at).toLocaleDateString()}]
          </span>
        </div>
      ))}
      {codes.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No promo codes</p>
        </div>
      )}
    </div>
  );
}

// ─── Bug Reports Tab ─────────────────────────────────────────────────────────

function BugReportsTab({ reports }: { reports: BugReportRow[] }) {
  const [platformFilter, setPlatformFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [items, setItems] = useState(reports);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const sort = useSortState("created_at");

  const categories = Array.from(
    new Set(items.map((r) => r.category).filter((c): c is string => !!c))
  );
  const platforms = Array.from(
    new Set(items.map((r) => r.platform).filter((p): p is string => !!p))
  );

  const filtered = sort.sorted(
    items.filter((r) => {
      if (platformFilter !== "ALL" && r.platform !== platformFilter) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (categoryFilter !== "ALL" && r.category !== categoryFilter) return false;
      return true;
    })
  );

  async function patchReport(id: string, body: Record<string, string>) {
    startTransition(async () => {
      try {
        await fetch("/api/admin/bug-reports/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...body }),
        });
        setItems((prev) =>
          prev.map((r) => (r.id === id ? { ...r, ...body } : r))
        );
      } catch {
        // ignore
      }
    });
  }

  const counts: Record<string, number> = BUG_STATUS_OPTIONS.reduce(
    (acc, s) => ({ ...acc, [s]: items.filter((r) => r.status === s).length }),
    { all: items.length } as Record<string, number>
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          <FilterPill
            active={statusFilter === "ALL"}
            onClick={() => setStatusFilter("ALL")}
            label={`ALL (${counts.all})`}
          />
          {BUG_STATUS_OPTIONS.map((s) => (
            <FilterPill
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              label={`${s.toUpperCase()} (${counts[s] ?? 0})`}
            />
          ))}
        </div>

        {platforms.length > 1 && (
          <>
            <div className="w-px h-6 bg-white/[0.08] self-center" />
            <div className="flex gap-1 flex-wrap">
              {["ALL", ...platforms].map((p) => (
                <FilterPill
                  key={p}
                  active={platformFilter === p}
                  onClick={() => setPlatformFilter(p)}
                  label={p.toUpperCase()}
                  accent
                />
              ))}
            </div>
          </>
        )}

        {categories.length > 1 && (
          <>
            <div className="w-px h-6 bg-white/[0.08] self-center" />
            <div className="flex gap-1 flex-wrap">
              {["ALL", ...categories].map((c) => (
                <FilterPill
                  key={c}
                  active={categoryFilter === c}
                  onClick={() => setCategoryFilter(c)}
                  label={c.toUpperCase()}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <SortableTableHeader
              columns={[
                { key: "platform", label: "Platform" },
                { key: "category", label: "Category" },
                { key: "description", label: "Description" },
                { key: "screen_name", label: "Screen" },
                { key: "priority", label: "Priority" },
                { key: "status", label: "Status" },
                { key: "reporter_name", label: "Reporter" },
                { key: "created_at", label: "Date" },
              ]}
              sort={sort.sort}
              onSort={sort.toggle}
              className="px-6"
            />
          </thead>
          <tbody>
            {filtered.map((r) => {
              const statusColor = BUG_STATUS_COLORS[r.status ?? "new"] ?? "#6B6B6B";
              const priorityColor = BUG_PRIORITY_COLORS[r.priority ?? "none"] ?? "#6B6B6B";
              const isExpanded = expandedId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className="border-b border-white/[0.05] last:border-0 align-top">
                    <td className="px-6 py-3 font-mohave text-[12px] uppercase text-[#A0A0A0]">
                      {r.platform}
                    </td>
                    <td className="px-2 py-3 font-mohave text-[12px] text-[#A0A0A0]">
                      {r.category ?? "—"}
                    </td>
                    <td className="px-2 py-3 max-w-[420px]">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}
                        className="font-mohave text-[14px] text-[#E5E5E5] text-left hover:text-[#597794] transition-colors cursor-pointer line-clamp-2"
                      >
                        {r.description}
                      </button>
                    </td>
                    <td className="px-2 py-3 font-kosugi text-[11px] text-[#6B6B6B]">
                      {r.screen_name ?? "—"}
                    </td>
                    <td className="px-2 py-3">
                      <select
                        value={r.priority ?? "none"}
                        onChange={(e) => patchReport(r.id, { priority: e.target.value })}
                        disabled={isPending}
                        className="bg-transparent border rounded px-2 py-1 font-mohave text-[11px] uppercase cursor-pointer"
                        style={{ color: priorityColor, borderColor: priorityColor }}
                      >
                        {BUG_PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p} className="bg-[#1D1D1D] text-[#E5E5E5]">
                            {p}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-3">
                      <select
                        value={r.status ?? "new"}
                        onChange={(e) => patchReport(r.id, { status: e.target.value })}
                        disabled={isPending}
                        className="bg-transparent border rounded px-2 py-1 font-mohave text-[11px] uppercase cursor-pointer"
                        style={{ color: statusColor, borderColor: statusColor }}
                      >
                        {BUG_STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s} className="bg-[#1D1D1D] text-[#E5E5E5]">
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-3 font-kosugi text-[11px] text-[#6B6B6B] max-w-[160px] truncate">
                      {r.reporter_name || r.reporter_email || "—"}
                      {r.company_name && (
                        <div className="text-[10px] text-[#4A4A4A]">{r.company_name}</div>
                      )}
                    </td>
                    <td className="px-2 py-3 font-kosugi text-[11px] text-[#6B6B6B] whitespace-nowrap">
                      [{new Date(r.created_at).toLocaleDateString()}]
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-white/[0.05]">
                      <td colSpan={8} className="px-6 py-4 bg-white/[0.015]">
                        <BugReportDetail report={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No bug reports</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  accent = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1.5 rounded-full font-mohave text-[11px] uppercase border transition-colors whitespace-nowrap",
        active
          ? accent
            ? "text-[#597794] border-[#597794]/30 bg-[#597794]/10"
            : "text-[#E5E5E5] border-white/[0.12] bg-white/[0.05]"
          : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function BugReportDetail({ report }: { report: BugReportRow }) {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  useEffect(() => {
    if (!report.screenshot_url) return;
    let cancelled = false;
    setScreenshotLoading(true);
    setScreenshotError(null);
    fetch(`/api/admin/bug-reports/screenshot?path=${encodeURIComponent(report.screenshot_url)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: { url: string }) => {
        if (!cancelled) setScreenshotUrl(d.url);
      })
      .catch((e) => {
        if (!cancelled) setScreenshotError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setScreenshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [report.screenshot_url]);

  const consoleLogs = Array.isArray(report.console_logs) ? report.console_logs : [];
  const breadcrumbs = Array.isArray(report.breadcrumbs) ? report.breadcrumbs : [];

  return (
    <div className="grid grid-cols-[1fr_320px] gap-6">
      {/* Left: text sections */}
      <div className="space-y-4">
        <DetailSection label="DESCRIPTION">
          <p className="font-mohave text-[13px] text-[#E5E5E5] whitespace-pre-wrap">
            {report.description}
          </p>
        </DetailSection>

        <DetailSection label="DEVICE">
          <DetailGrid>
            <DetailRow k="Browser" v={`${report.browser ?? "—"} ${report.browser_version ?? ""}`.trim()} />
            <DetailRow k="OS" v={`${report.os_name ?? "—"} ${report.os_version ?? ""}`.trim()} />
            <DetailRow k="Device" v={report.device_model ?? "—"} />
            <DetailRow k="Viewport" v={report.viewport_width ? `${report.viewport_width}×${report.viewport_height}` : "—"} />
            <DetailRow k="Network" v={report.network_type ?? "—"} />
            <DetailRow k="URL" v={report.url ?? "—"} mono />
          </DetailGrid>
        </DetailSection>

        {breadcrumbs.length > 0 && (
          <DetailSection label={`BREADCRUMBS (${breadcrumbs.length})`}>
            <div className="font-mono text-[11px] text-[#A0A0A0] space-y-0.5 max-h-48 overflow-y-auto">
              {breadcrumbs.map((b, i) => {
                const crumb = b as { type?: string; message?: string; timestamp?: string };
                return (
                  <div key={i} className="truncate">
                    <span className="text-[#6B6B6B]">[{crumb.type ?? "?"}]</span>{" "}
                    {crumb.message ?? JSON.stringify(b)}
                  </div>
                );
              })}
            </div>
          </DetailSection>
        )}

        {consoleLogs.length > 0 && (
          <DetailSection label={`CONSOLE (${consoleLogs.length})`}>
            <div className="font-mono text-[11px] space-y-0.5 max-h-48 overflow-y-auto">
              {consoleLogs.map((l, i) => {
                const log = l as { level?: string; message?: string };
                const color = log.level === "error" ? "#D97757" : log.level === "warn" ? "#C4A868" : "#A0A0A0";
                return (
                  <div key={i} style={{ color }} className="truncate">
                    [{log.level ?? "log"}] {log.message ?? JSON.stringify(l)}
                  </div>
                );
              })}
            </div>
          </DetailSection>
        )}

        {report.custom_metadata && Object.keys(report.custom_metadata).length > 0 && (
          <DetailSection label="METADATA">
            <pre className="font-mono text-[10px] text-[#6B6B6B] whitespace-pre-wrap max-h-40 overflow-y-auto">
              {JSON.stringify(report.custom_metadata, null, 2)}
            </pre>
          </DetailSection>
        )}
      </div>

      {/* Right: screenshot */}
      <div>
        <DetailSection label="SCREENSHOT">
          {!report.screenshot_url ? (
            <p className="font-kosugi text-[11px] text-[#6B6B6B]">[NONE ATTACHED]</p>
          ) : screenshotLoading ? (
            <p className="font-kosugi text-[11px] text-[#6B6B6B]">[LOADING...]</p>
          ) : screenshotError ? (
            <p className="font-kosugi text-[11px] text-[#D97757]">[ERROR: {screenshotError}]</p>
          ) : screenshotUrl ? (
            <a href={screenshotUrl} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshotUrl}
                alt="Bug report screenshot"
                className="w-full border border-white/[0.08] rounded"
              />
            </a>
          ) : null}
        </DetailSection>
      </div>
    </div>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-2">
        {label}
      </p>
      {children}
    </div>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-1">{children}</div>;
}

function DetailRow({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-[12px] min-w-0">
      <span className="font-kosugi text-[#6B6B6B] whitespace-nowrap">{k}:</span>
      <span
        className={`${mono ? "font-mono" : "font-mohave"} text-[#A0A0A0] truncate`}
        title={v}
      >
        {v || "—"}
      </span>
    </div>
  );
}
