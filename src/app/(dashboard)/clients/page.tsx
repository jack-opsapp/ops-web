"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { trackScreenView } from "@/lib/analytics/analytics";
import { useClients, useClientOutstandingMap } from "@/lib/hooks";
import { useScopedProjects } from "@/lib/hooks/use-projects";
import { usePermissionStore, selectPermissionsReady } from "@/lib/store/permissions-store";
import { useWindowStore } from "@/stores/window-store";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";
import { getInitials } from "@/lib/types/models";
import { formatCurrency, formatPhoneNumber } from "@/lib/utils/format";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SearchInput } from "@/components/ui/search-input";
import { FilterChips } from "@/components/ui/filter-chip";
import {
  RegisterTable,
  RegisterEmpty,
  TablePrimary,
  TableMeta,
  TableMono,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import { TableShell, TableWorkbar, WorkbarButton } from "@/components/ui/table-shell";
import { MetricsStrip, type MetricCell } from "@/components/ui/metrics-strip";

type FilterMode = "all" | "with-projects" | "owes" | "new";

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  subContactCount: number;
  projectCount: number;
  outstanding: number;
  lastActivity: Date | null;
  createdAt: Date | null;
  /** Lower-cased haystack for search (name + company + contacts + sub-names). */
  search: string;
}

/** Compact tactical recency — "today" / "3d" / "6w" / "4mo" / "2y". */
function compactSince(date: Date | null, todayLabel: string): string {
  if (!date) return "—";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return todayLabel;
  if (days < 7) return `${days}d`;
  if (days < 31) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function ListSkeleton() {
  return (
    <div className="animate-pulse space-y-[2px] motion-reduce:animate-none">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="glass-surface h-[48px]" />
      ))}
    </div>
  );
}

export default function ClientsPage() {
  const { t } = useDictionary("clients");
  usePageTitle(t("title"));

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  const permissionsReady = usePermissionStore(selectPermissionsReady);
  const can = usePermissionStore((s) => s.can);
  const clientScope = usePermissionStore((s) => s.permissions.get("clients.view"));
  const hasAllClientScope = clientScope === "all";
  const canCreate = can("clients.create");

  const openClientWindow = useWindowStore((s) => s.openClientWindow);

  const { data, isLoading } = useClients();
  const { data: projectsData } = useScopedProjects();
  const outstanding = useClientOutstandingMap();

  // ── Setup gate (parity: creation is intercepted until web setup is done) ──
  const { isComplete: setupComplete, missingSteps } = useSetupGate();
  const [showSetup, setShowSetup] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<(() => void) | null>(null);

  const openCreate = useCallback(() => {
    openClientWindow({ clientId: null, mode: "creating" });
  }, [openClientWindow]);

  const gatedCreate = useCallback(() => {
    if (!setupComplete) {
      setPendingCreate(() => openCreate);
      setShowSetup(true);
      return;
    }
    openCreate();
  }, [setupComplete, openCreate]);

  useEffect(() => {
    trackScreenView("clients");
  }, []);

  // Project count + most-recent project per client, from scoped projects.
  const { projectCountByClient, latestProjectByClient } = useMemo(() => {
    const counts = new Map<string, number>();
    const latest = new Map<string, Date>();
    for (const p of projectsData?.projects ?? []) {
      if (!p.clientId) continue;
      counts.set(p.clientId, (counts.get(p.clientId) ?? 0) + 1);
      if (p.createdAt) {
        const prev = latest.get(p.clientId);
        if (!prev || p.createdAt > prev) latest.set(p.clientId, p.createdAt);
      }
    }
    return { projectCountByClient: counts, latestProjectByClient: latest };
  }, [projectsData]);

  // Scope gate: clients.view !== "all" restricts to clients on the user's
  // accessible (scoped) projects. Preserved verbatim from the prior page.
  const allowedClientIds = useMemo(() => {
    if (hasAllClientScope) return null;
    const ids = new Set<string>();
    for (const p of projectsData?.projects ?? []) {
      if (p.clientId) ids.add(p.clientId);
    }
    return ids;
  }, [hasAllClientScope, projectsData]);

  const rows: ClientRow[] = useMemo(() => {
    return (data?.clients ?? [])
      .filter((c) => !c.deletedAt)
      .filter((c) => allowedClientIds === null || allowedClientIds.has(c.id))
      .map((c) => {
        const subs = (c.subClients ?? []).filter((sc) => !sc.deletedAt);
        const createdAt = c.createdAt ?? null;
        const latestProject = latestProjectByClient.get(c.id) ?? null;
        const lastActivity =
          latestProject && createdAt
            ? latestProject > createdAt
              ? latestProject
              : createdAt
            : latestProject ?? createdAt;
        return {
          id: c.id,
          name: c.name,
          email: c.email ?? null,
          phone: c.phoneNumber ?? null,
          address: c.address ?? null,
          subContactCount: subs.length,
          projectCount: projectCountByClient.get(c.id) ?? 0,
          outstanding: outstanding.map.get(c.id)?.outstanding ?? 0,
          lastActivity,
          createdAt,
          search: [
            c.name,
            c.email ?? "",
            c.phoneNumber ?? "",
            c.address ?? "",
            ...subs.map((sc) => sc.name),
          ]
            .join(" ")
            .toLowerCase(),
        };
      });
  }, [data, allowedClientIds, projectCountByClient, latestProjectByClient, outstanding.map]);

  const filtered = useMemo(() => {
    let list = rows;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => r.search.includes(q));
    if (filter === "with-projects") list = list.filter((r) => r.projectCount > 0);
    else if (filter === "owes") list = list.filter((r) => r.outstanding > 0);
    else if (filter === "new") {
      const cutoff = Date.now() - 30 * 86_400_000;
      list = list.filter((r) => r.createdAt != null && r.createdAt.getTime() >= cutoff);
    }
    return list;
  }, [rows, search, filter]);

  const filterOptions = useMemo(
    () => [
      { value: "all" as FilterMode, label: t("filter.all") },
      { value: "with-projects" as FilterMode, label: t("filter.withProjects") },
      { value: "owes" as FilterMode, label: t("filter.owes") },
      { value: "new" as FilterMode, label: t("filter.new") },
    ],
    [t],
  );

  const columns: RegisterTableColumn<ClientRow>[] = useMemo(
    () => [
      {
        id: "client",
        header: t("table.client"),
        cell: (r) => (
          <div className="flex items-center gap-2">
            <Avatar className="h-[28px] w-[28px] shrink-0">
              <AvatarFallback className="font-mono text-[11px] uppercase tracking-wider">
                {getInitials(r.name) || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <TablePrimary>{r.name}</TablePrimary>
              {r.subContactCount > 0 ? (
                <TableMeta>
                  {r.subContactCount}&nbsp;
                  {r.subContactCount === 1 ? t("subContact") : t("subContacts")}
                </TableMeta>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: "contact",
        header: t("table.contact"),
        cell: (r) => {
          const parts = [r.phone ? formatPhoneNumber(r.phone) : null, r.email].filter(
            Boolean,
          );
          return parts.length ? (
            <TableMono>{parts.join("  ·  ")}</TableMono>
          ) : (
            <TableMono>—</TableMono>
          );
        },
      },
      {
        id: "projects",
        header: t("table.projects"),
        align: "right",
        className: "w-[96px]",
        cell: (r) =>
          r.projectCount > 0 ? (
            <TableMono tone="default">{r.projectCount}</TableMono>
          ) : (
            <TableMono>—</TableMono>
          ),
      },
      {
        id: "outstanding",
        header: t("table.outstanding"),
        align: "right",
        className: "w-[140px]",
        cell: (r) =>
          r.outstanding > 0 ? (
            <TableMono tone="rose">{formatCurrency(r.outstanding)}</TableMono>
          ) : (
            <TableMono>—</TableMono>
          ),
      },
      {
        id: "lastSeen",
        header: t("table.lastSeen"),
        align: "right",
        className: "w-[88px]",
        cell: (r) => <TableMono>{compactSince(r.lastActivity, t("lastSeen.today"))}</TableMono>,
      },
    ],
    [t],
  );

  const showLoading = !permissionsReady || isLoading;
  const isEmptyAll = filtered.length === 0 && !search.trim() && filter === "all";
  const isEmptyFiltered = filtered.length === 0 && !isEmptyAll;

  // ── Unified metrics strip (replaces the one-off rose A/R banner; the chase
  //    action survives as the A/R cell drill). Shares the foundation every
  //    surface uses (WEB OVERHAUL P6-2). Counts read the full scoped set, not
  //    the active filter — metrics are surface-level, not filter-level. ──
  const totalClients = rows.length;
  const withProjectsCount = useMemo(() => rows.filter((r) => r.projectCount > 0).length, [rows]);
  const newCount = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    return rows.filter((r) => r.createdAt != null && r.createdAt.getTime() >= cutoff).length;
  }, [rows]);
  const arDays = outstanding.totals.oldestDueDate
    ? Math.max(0, Math.floor((Date.now() - new Date(outstanding.totals.oldestDueDate).getTime()) / 86_400_000))
    : null;

  const metricCells: MetricCell[] = useMemo(() => {
    const cells: MetricCell[] = [];
    if (outstanding.canView) {
      const owes = outstanding.totals.clientsOwing;
      const amt = outstanding.totals.amount;
      cells.push({
        label: t("metrics.ar"),
        value: amt,
        format: (n) => formatCurrency(n),
        tone: amt > 0 ? "rose" : "default",
        sub:
          amt > 0
            ? [t("metrics.owingSub", { count: String(owes) }), arDays != null ? t("ar.oldest", { days: String(arDays) }) : null]
                .filter(Boolean)
                .join("  ·  ")
            : undefined,
        onClick: amt > 0 ? () => setFilter("owes") : undefined,
      });
      cells.push({
        label: t("metrics.owing"),
        value: owes,
        tone: owes > 0 ? "rose" : "default",
        sub: t("metrics.ofClients", { count: String(totalClients) }),
        viz: totalClients > 0 ? { type: "meter", pct: owes / totalClients, color: "var(--rose)" } : undefined,
      });
    }
    cells.push({
      label: t("metrics.withProjects"),
      value: withProjectsCount,
      tone: "olive",
      viz: totalClients > 0 ? { type: "meter", pct: withProjectsCount / totalClients, color: "var(--olive)" } : undefined,
    });
    cells.push({ label: t("metrics.new"), value: newCount });
    return cells;
  }, [outstanding.canView, outstanding.totals.clientsOwing, outstanding.totals.amount, arDays, totalClients, withProjectsCount, newCount, t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TableShell
        metrics={<MetricsStrip metrics={metricCells} isLoading={showLoading} ariaLabel={t("title")} />}
        toolbar={
          <TableWorkbar>
            {/* ONE dense row. Clients carries few controls (no segment/mode
                switcher), so search + filter chips + count + the create CTA all fit
                on a single line — no need to spend a second row. `flex-wrap` lets it
                reflow to two lines only on a genuinely narrow viewport. No redundant
                `// CLIENTS` label (the page header names the surface); search takes
                the leftmost slot and the create CTA is pushed to the far right. */}
            <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search.placeholder")}
                wrapperClassName="w-[240px] max-w-full"
                aria-label={t("search.placeholder")}
              />
              <FilterChips options={filterOptions} value={filter} onChange={setFilter} />
              <span className="font-mono text-micro tabular-nums text-text-3">
                {filtered.length === 1
                  ? t("list.countOne", { count: "1" })
                  : t("list.count", { count: String(filtered.length) })}
              </span>
              {canCreate && (
                <WorkbarButton onClick={gatedCreate} className="ml-auto">
                  <Plus className="h-[11px] w-[11px] shrink-0" strokeWidth={1.5} aria-hidden />
                  {t("newClient")}
                </WorkbarButton>
              )}
            </div>
          </TableWorkbar>
        }
        isEmpty={showLoading || isEmptyAll || isEmptyFiltered}
        emptyState={
          showLoading ? (
            <div className="p-3">
              <ListSkeleton />
            </div>
          ) : (
            // DESIGN.md §2: state the fact only — no coach-mark, no button. Create
            // lives in the workbar CTA + the FAB, not the empty register.
            <RegisterEmpty noun={isEmptyAll ? t("empty.noun") : t("empty.matches")} />
          )
        }
      >
        <RegisterTable
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.id}
          onRowClick={(r) => openClientWindow({ clientId: r.id, mode: "viewing" })}
          minWidth={720}
          ariaLabel={t("title")}
          inShell
        />
      </TableShell>

      <SetupInterceptionModal
        isOpen={showSetup}
        onComplete={() => {
          setShowSetup(false);
          pendingCreate?.();
          setPendingCreate(null);
        }}
        onDismiss={() => {
          setShowSetup(false);
          setPendingCreate(null);
        }}
        missingSteps={missingSteps}
        triggerAction="clients"
      />
    </div>
  );
}
