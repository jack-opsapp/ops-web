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
  reviewing: "#D99A3E",
  planned: "#6F94B0",
  "in-progress": "#9DB582",
  done: "#6B8F71",
  "wont-fix": "#6B6B6B",
};

const BUG_STATUS_OPTIONS = ["new", "triaged", "in_progress", "resolved", "closed", "duplicate"] as const;
const BUG_STATUS_COLORS: Record<string, string> = {
  new: "#C4A868",
  triaged: "#D99A3E",
  in_progress: "#6F94B0",
  resolved: "#9DB582",
  closed: "#6B8F71",
  duplicate: "#6B6B6B",
};

const BUG_PRIORITY_OPTIONS = ["none", "low", "medium", "high", "urgent"] as const;
const BUG_PRIORITY_COLORS: Record<string, string> = {
  urgent: "#D97757",
  high: "#C4A868",
  medium: "#D99A3E",
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
                  ? "text-[#EDEDED] border-white/[0.12] bg-white/[0.05]"
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
                      ? "text-[#6F94B0] border-[#6F94B0]/30 bg-ops-accent/10"
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
                  className="font-mohave text-[14px] text-[#EDEDED] truncate text-left hover:text-[#6F94B0] transition-colors cursor-pointer"
                >
                  {r.title}
                </button>
                {expandedId === r.id && r.description && (
                  <p className="font-mono text-[12px] text-[#A0A0A0] mt-2 whitespace-pre-wrap">
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
                    <option key={s} value={s} className="bg-glass glass-surface text-[#EDEDED]">
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-3 font-mono text-[12px] text-[#6B6B6B] truncate">{r.user_email ?? "\u2014"}</td>
              <td className="px-2 py-3 font-mono text-[12px] text-[#6B6B6B]">
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
          <span className="font-mohave text-[14px] text-[#EDEDED] font-mono">{c.code}</span>
          <span className="font-mohave text-[14px] text-[#A0A0A0]">
            {c.discount_value == null
              ? "—"
              : c.discount_type === "percent" || c.discount_type === "percentage"
                ? `${c.discount_value}%`
                : `$${c.discount_value}`}
          </span>
          <span className="font-mohave text-[14px] text-[#A0A0A0]">
            {c.current_uses}{c.max_uses != null ? ` / ${c.max_uses}` : ""}
          </span>
          <span className="font-mohave text-[14px] text-[#A0A0A0]">{c.max_uses ?? "∞"}</span>
          <span className={`font-mohave text-[13px] ${c.is_active ? "text-[#9DB582]" : "text-[#6B6B6B]"}`}>
            {c.is_active ? "ACTIVE" : "INACTIVE"}
          </span>
          <span className="font-mono text-[12px] text-[#6B6B6B]">
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
                        className="font-mohave text-[14px] text-[#EDEDED] text-left hover:text-[#6F94B0] transition-colors cursor-pointer line-clamp-2"
                      >
                        {r.description}
                      </button>
                    </td>
                    <td className="px-2 py-3 font-mono text-[11px] text-[#6B6B6B]">
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
                          <option key={p} value={p} className="bg-glass glass-surface text-[#EDEDED]">
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
                          <option key={s} value={s} className="bg-glass glass-surface text-[#EDEDED]">
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-3 font-mono text-[11px] text-[#6B6B6B] max-w-[160px] truncate">
                      {r.reporter_name || r.reporter_email || "—"}
                      {r.company_name && (
                        <div className="text-micro text-[#4A4A4A]">{r.company_name}</div>
                      )}
                    </td>
                    <td className="px-2 py-3 font-mono text-[11px] text-[#6B6B6B] whitespace-nowrap">
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
            ? "text-[#6F94B0] border-[#6F94B0]/30 bg-ops-accent/10"
            : "text-[#EDEDED] border-white/[0.12] bg-white/[0.05]"
          : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/**
 * A picked element as it survives the round-trip through `custom_metadata`
 * (bug 1f2bf7e9). Only the fields this view renders are required — the shape
 * is client-written JSON, so it is validated rather than trusted.
 */
interface AdminElementReference {
  id: string;
  label: string;
  role: string;
  selector: string;
  classes: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  page: { x: number; y: number };
  componentChain: string[];
  attachmentIndex: number | null;
}

function isNumeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readElementReferences(
  metadata: Record<string, unknown> | null
): AdminElementReference[] {
  const raw = metadata?.elementReferences;
  if (!Array.isArray(raw)) return [];

  const parsed: AdminElementReference[] = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    const rect = e.rect as Record<string, unknown> | undefined;
    const page = e.page as Record<string, unknown> | undefined;
    if (typeof e.selector !== "string" || typeof e.label !== "string") return;

    parsed.push({
      id: typeof e.id === "string" ? e.id : `element-${i}`,
      label: e.label,
      role: typeof e.role === "string" ? e.role : "generic",
      selector: e.selector,
      classes: typeof e.classes === "string" ? e.classes : "",
      text: typeof e.text === "string" ? e.text : "",
      rect: {
        x: isNumeric(rect?.x) ? rect.x : 0,
        y: isNumeric(rect?.y) ? rect.y : 0,
        width: isNumeric(rect?.width) ? rect.width : 0,
        height: isNumeric(rect?.height) ? rect.height : 0,
      },
      page: {
        x: isNumeric(page?.x) ? page.x : 0,
        y: isNumeric(page?.y) ? page.y : 0,
      },
      componentChain: Array.isArray(e.componentChain)
        ? e.componentChain.filter((c): c is string => typeof c === "string")
        : [],
      attachmentIndex: isNumeric(e.attachmentIndex) ? e.attachmentIndex : null,
    });
  });
  return parsed;
}

function BugReportDetail({ report }: { report: BugReportRow }) {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [cropUrls, setCropUrls] = useState<Record<number, string>>({});

  const elementReferences = readElementReferences(report.custom_metadata);

  // Presign each element crop the same way the full screenshot is presigned.
  useEffect(() => {
    const attachments = report.additional_attachments ?? [];
    const wanted = readElementReferences(report.custom_metadata)
      .map((r) => r.attachmentIndex)
      .filter(
        (i): i is number =>
          typeof i === "number" && i >= 0 && i < attachments.length
      );
    if (wanted.length === 0) return;

    let cancelled = false;
    Promise.all(
      wanted.map(async (index) => {
        const path = attachments[index];
        const res = await fetch(
          `/api/admin/bug-reports/screenshot?path=${encodeURIComponent(path)}`
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { url: string };
        return [index, data.url] as const;
      })
    )
      .then((pairs) => {
        if (!cancelled) setCropUrls(Object.fromEntries(pairs));
      })
      .catch(() => {
        // A crop that will not presign is not worth breaking the detail over;
        // the reference itself still carries the identity.
      });

    return () => {
      cancelled = true;
    };
  }, [report.additional_attachments, report.custom_metadata]);

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
          <p className="font-mohave text-[13px] text-[#EDEDED] whitespace-pre-wrap">
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
            <pre className="font-mono text-micro text-[#6B6B6B] whitespace-pre-wrap max-h-40 overflow-y-auto">
              {JSON.stringify(report.custom_metadata, null, 2)}
            </pre>
          </DetailSection>
        )}
      </div>

      {/* Right: screenshot */}
      <div>
        <DetailSection label="SCREENSHOT">
          {!report.screenshot_url ? (
            <p className="font-mono text-[11px] text-[#6B6B6B]">[NONE ATTACHED]</p>
          ) : screenshotLoading ? (
            <p className="font-mono text-[11px] text-[#6B6B6B]">[LOADING...]</p>
          ) : screenshotError ? (
            <p className="font-mono text-[11px] text-[#D97757]">[ERROR: {screenshotError}]</p>
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

        {elementReferences.length > 0 && (
          <div className="mt-4">
            <DetailSection label={`ELEMENTS (${elementReferences.length})`}>
              <div className="space-y-3">
                {elementReferences.map((ref) => (
                  <ElementReferenceCard
                    key={ref.id}
                    reference={ref}
                    cropUrl={
                      ref.attachmentIndex !== null
                        ? cropUrls[ref.attachmentIndex] ?? null
                        : null
                    }
                  />
                ))}
              </div>
            </DetailSection>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One picked element: what it is, where it was, and a crop of it. Reads
 * top-down — the crop and name first (recognition), then the selector the
 * engineer will grep for, then the supporting geometry.
 */
function ElementReferenceCard({
  reference,
  cropUrl,
}: {
  reference: AdminElementReference;
  cropUrl: string | null;
}) {
  const { rect } = reference;
  const geometry = `${Math.round(rect.x)},${Math.round(rect.y)} · ${Math.round(
    rect.width
  )}×${Math.round(rect.height)}`;

  function copySelector() {
    void navigator.clipboard?.writeText?.(reference.selector);
  }

  return (
    <div className="border-t border-white/[0.05] pt-3 first:border-0 first:pt-0 space-y-1.5">
      <div className="flex gap-3 items-start">
        {cropUrl ? (
          <a href={cropUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              data-element-crop-thumb=""
              src={cropUrl}
              alt={`${reference.role} ${reference.label}`}
              className="w-24 border border-white/[0.08] rounded"
            />
          </a>
        ) : reference.attachmentIndex === null ? (
          <p className="font-mono text-[11px] text-[#6B6B6B] shrink-0">[NO CROP]</p>
        ) : (
          <p className="font-mono text-[11px] text-[#6B6B6B] shrink-0">[LOADING...]</p>
        )}

        <div className="min-w-0 flex-1">
          <p className="font-mohave text-[13px] text-[#EDEDED] truncate">
            {`${reference.role} · ${reference.label}`}
          </p>
          <p className="font-mono text-[11px] text-[#A0A0A0] break-all">
            {reference.selector}
          </p>
          <button
            onClick={copySelector}
            className="font-mono text-micro uppercase tracking-wider text-[#6B6B6B] hover:text-[#A0A0A0] transition-colors mt-0.5"
          >
            COPY
          </button>
        </div>
      </div>

      <DetailRow k="Classes" v={reference.classes} mono />
      <DetailRow k="Text" v={reference.text} />
      <DetailRow k="Rect" v={geometry} mono />
      <DetailRow k="Page" v={`${Math.round(reference.page.x)},${Math.round(reference.page.y)}`} mono />
      <DetailRow k="Component" v={reference.componentChain.join(" › ")} />
    </div>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-micro uppercase tracking-wider text-[#6B6B6B] mb-2">
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
      <span className="font-mono text-[#6B6B6B] whitespace-nowrap">{k}:</span>
      <span
        className={`${mono ? "font-mono" : "font-mohave"} text-[#A0A0A0] truncate`}
        title={v}
      >
        {v || "—"}
      </span>
    </div>
  );
}
