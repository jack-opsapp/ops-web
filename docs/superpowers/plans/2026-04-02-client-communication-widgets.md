# Client & Communication Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign 5 client/communication dashboard widgets to use the shared widget library, add new data triggers, inline actions, search/sort, and deep-linking.

**Architecture:** Each widget is a self-contained `"use client"` component that fetches its own data via TanStack Query hooks and renders using the shared widget library (WidgetLineItem, WidgetHeroCollapse, WidgetInlineAction, etc.). Widgets that don't receive `onNavigate` as a prop use `useRouter().push()` directly. All animations use `WIDGET_EASE_CSS` with `useReducedMotion()` support.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, TanStack Query, Tailwind CSS, Lucide React, Framer Motion (only via shared components), Zustand (WidgetActionQueue).

**Spec:** `docs/superpowers/specs/2026-04-02-client-communication-widgets-redesign.md`

**Constraints:**
- Do NOT modify: `dashboard/page.tsx`, `widget-tokens.ts`, any file in `shared/`, `tailwind.config.ts`
- Only modify: the 5 widget `.tsx` files + `src/i18n/dictionaries/en/dashboard.json`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/dashboard/widgets/top-clients-widget.tsx` | Modify | Refactor to WidgetLineItem, add revenue to SM |
| `src/components/dashboard/widgets/client-list-widget.tsx` | Modify | Search, sort, quick actions, LG metrics, WidgetLineItem |
| `src/components/dashboard/widgets/client-attention-widget.tsx` | Rewrite | 6 attention triggers, inline actions, SVG ring chart |
| `src/components/dashboard/widgets/activity-feed-widget.tsx` | Modify | WidgetLineItem, deep links, author names, LG metrics |
| `src/components/dashboard/widgets/notifications-widget.tsx` | Modify | WidgetLineItem, deep links via actionUrl |
| `src/i18n/dictionaries/en/dashboard.json` | Modify | New i18n keys for all 5 widgets |

---

### Task 1: Add i18n Keys

**Files:**
- Modify: `src/i18n/dictionaries/en/dashboard.json:747` (before closing `}`)

- [ ] **Step 1: Add all new i18n keys**

Insert before the closing `}` on line 748. Find the line `"widgetDate.yesterday": "Yesterday"` and add a comma after it, then add:

```json
  "widgetDate.yesterday": "Yesterday",

  "topClients.revenue": "revenue",

  "clientList.search": "Search clients...",
  "clientList.sortRecent": "Recent",
  "clientList.sortName": "Name",
  "clientList.sortRevenue": "Revenue",
  "clientList.activeMonth": "active this month",
  "clientList.newMonth": "new this month",
  "clientList.newClient": "New Client",
  "clientList.createProject": "Create Project",
  "clientList.createInvoice": "Create Invoice",
  "clientList.createEstimate": "Create Estimate",
  "clientList.createTask": "Create Task",

  "clientAttention.unassignedTasks": "{count} unassigned tasks",
  "clientAttention.unscheduledTasks": "{count} unscheduled tasks",
  "clientAttention.staleQuoting": "In Quoting {days}d — no estimate sent",
  "clientAttention.estimateNoResponse": "Estimate {number} — {status} {days}d, no response",
  "clientAttention.assignCrew": "Assign crew",
  "clientAttention.schedule": "Schedule",
  "clientAttention.createEstimate": "Create estimate",
  "clientAttention.sendFollowUp": "Send follow-up",
  "clientAttention.viewInvoice": "View invoice",
  "clientAttention.viewEstimate": "View estimate",
  "clientAttention.followUpQueued": "Follow-up queued — sending in 5m",
  "clientAttention.needAttention": "need attention",
  "clientAttention.overdue": "overdue",
  "clientAttention.tasks": "tasks",
  "clientAttention.staleQuotes": "stale quotes",

  "activity.by": "By",
  "activity.todayCount": "today",
  "activity.activeUsers": "users",
  "activity.mostActive": "most active"
```

Note: the last key before the closing `}` should NOT have a trailing comma. The final `}` stays on its own line.

- [ ] **Step 2: Verify JSON validity**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && node -e "JSON.parse(require('fs').readFileSync('src/i18n/dictionaries/en/dashboard.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git add src/i18n/dictionaries/en/dashboard.json && git commit -m "i18n: add keys for client & communication widget redesign"
```

---

### Task 2: Redesign Top Clients Widget

**Files:**
- Modify: `src/components/dashboard/widgets/top-clients-widget.tsx` (full file rewrite)

**Context files to read:**
- `src/components/dashboard/widgets/shared/widget-line-item.tsx` — WidgetLineItem API
- `src/components/dashboard/widgets/shared/widget-motion.ts` — widgetLineItemStyle, WIDGET_EASE_CSS
- `src/components/dashboard/widgets/shared/widget-utils.ts` — formatCompactCurrency
- `src/lib/widget-tokens.ts` — WT, isCompact, showDetail, showActions, showFooter

- [ ] **Step 1: Rewrite top-clients-widget.tsx**

Replace the entire file with:

```tsx
"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { widgetLineItemStyle, WIDGET_EASE_CSS } from "./shared/widget-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, isCompact, showActions, showFooter } from "@/lib/widget-tokens";
import type { Client, Project } from "@/lib/types/models";
import type { Invoice } from "@/lib/types/pipeline";
import { InvoiceStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface TopClientsWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  clients: Client[];
  invoices: Invoice[];
  projects: Project[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function daysSince(date: Date | null): number | null {
  if (!date) return null;
  const now = new Date();
  return Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function TopClientsWidget({
  size,
  config,
  clients,
  invoices,
  projects,
  isLoading,
  onNavigate,
}: TopClientsWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const metric = (config.metric as string) ?? "revenue";
  const period = (config.period as string) ?? "ytd";

  const rankedClients = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const clientMap = new Map<string, {
      client: Client;
      revenue: number;
      outstanding: number;
      projectCount: number;
      lastActivityAt: Date | null;
    }>();

    for (const client of clients) {
      if (client.deletedAt) continue;
      clientMap.set(client.id, {
        client,
        revenue: 0,
        outstanding: 0,
        projectCount: 0,
        lastActivityAt: null,
      });
    }

    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      const entry = clientMap.get(inv.clientId);
      if (!entry) continue;

      if (period === "ytd") {
        const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
        if (inv.status === InvoiceStatus.Paid && paidDate && paidDate >= yearStart) {
          entry.revenue += inv.amountPaid;
        }
      } else {
        if (inv.status === InvoiceStatus.Paid) {
          entry.revenue += inv.amountPaid;
        }
      }

      if (
        inv.status !== InvoiceStatus.Paid &&
        inv.status !== InvoiceStatus.Void &&
        inv.status !== InvoiceStatus.WrittenOff &&
        inv.status !== InvoiceStatus.Draft
      ) {
        entry.outstanding += inv.balanceDue;
      }

      const invDate = inv.updatedAt ? new Date(inv.updatedAt) : null;
      if (invDate && (!entry.lastActivityAt || invDate > entry.lastActivityAt)) {
        entry.lastActivityAt = invDate;
      }
    }

    for (const proj of projects) {
      if (proj.deletedAt || !proj.clientId) continue;
      const entry = clientMap.get(proj.clientId);
      if (entry) entry.projectCount++;
    }

    const entries = Array.from(clientMap.values()).filter((e) => {
      if (metric === "revenue") return e.revenue > 0;
      if (metric === "outstanding") return e.outstanding > 0;
      return e.projectCount > 0;
    });

    entries.sort((a, b) => {
      if (metric === "revenue") return b.revenue - a.revenue;
      if (metric === "outstanding") return b.outstanding - a.outstanding;
      return b.projectCount - a.projectCount;
    });

    return entries;
  }, [clients, invoices, projects, metric, period]);

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <div className="pb-1 pt-2 px-3">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("topClients.title") ?? "Top Clients"}
          </span>
        </div>
        <div className="px-3 pb-2">
          <WidgetSkeleton variant="horizontal-bars" />
        </div>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (rankedClients.length === 0) {
    return (
      <Card className="h-full cursor-pointer" onClick={() => onNavigate("/clients")}>
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("topClients.title") ?? "Top Clients"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className="font-mohave text-caption-sm text-text-disabled">
              {t("topClients.noData") ?? "No client data yet"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("topClients.viewClients") ?? "View Clients"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + top client with revenue ─────────────────────────
  if (size === "sm") {
    const topClient = rankedClients[0];
    const topRevenue = topClient
      ? metric === "revenue"
        ? topClient.revenue
        : metric === "outstanding"
          ? topClient.outstanding
          : topClient.projectCount
      : 0;

    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {rankedClients.length}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/clients"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("topClients.title") ?? "Top Clients"}
          </span>
          {topClient && (
            <span className="font-mohave text-caption-sm text-text-secondary truncate mt-0.5">
              #1: {topClient.client.name} · {metric === "projects" ? `${topRevenue}` : formatCompactCurrency(topRevenue)}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Ranked list with WidgetLineItem + proportional bars ──────
  const maxItems = size === "md" ? 5 : 15;
  const displayClients = rankedClients.slice(0, maxItems);
  const maxValue = displayClients[0]
    ? metric === "revenue"
      ? displayClients[0].revenue
      : metric === "outstanding"
        ? displayClients[0].outstanding
        : displayClients[0].projectCount
    : 1;

  function getMetricValue(entry: (typeof displayClients)[number]): number {
    if (metric === "revenue") return entry.revenue;
    if (metric === "outstanding") return entry.outstanding;
    return entry.projectCount;
  }

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("topClients.title") ?? "Top Clients"}
          </span>
        </div>

        {/* CLIENT LIST */}
        <ScrollFade>
          <div className="flex flex-col gap-[4px]">
            {displayClients.map((entry, i) => {
              const val = getMetricValue(entry);
              const barPct = maxValue > 0 ? (val / maxValue) * 100 : 0;
              const days = daysSince(entry.lastActivityAt);

              const secondary = showActions(size)
                ? `${entry.projectCount} ${t("topClients.projects") ?? "projects"}${days !== null ? ` · ${t("topClients.lastActive") ?? "Last active"} ${days}d ago` : ""}`
                : undefined;

              return (
                <div
                  key={entry.client.id}
                  className="flex items-center gap-1.5 relative"
                  style={widgetLineItemStyle(i, isVisible, reducedMotion)}
                >
                  {/* Rank number */}
                  <span className="font-mono text-micro text-text-tertiary w-[14px] shrink-0">
                    {i + 1}
                  </span>

                  {/* Line item + proportional bar */}
                  <div className="flex-1 min-w-0 relative">
                    <WidgetLineItem
                      indicator={{ type: "bar", color: WT.accent }}
                      primary={entry.client.name}
                      secondary={secondary}
                      metric={metric === "projects" ? `${val}` : formatCompactCurrency(val)}
                      onClick={() => onNavigate(`/clients/${entry.client.id}`)}
                    />

                    {/* Proportional bar behind */}
                    <div
                      className="absolute bottom-0 left-0 rounded-sm pointer-events-none"
                      style={{
                        height: isCompact(size) ? "4px" : "8px",
                        width: isVisible ? `${barPct}%` : "0%",
                        backgroundColor: WT.accentSubtle,
                        transitionDuration: reducedMotion ? "200ms" : "500ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 50 + 100}ms`,
                        transitionTimingFunction: WIDGET_EASE_CSS,
                        transitionProperty: "width",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollFade>

        {/* FOOTER */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/clients")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("topClients.viewClients") ?? "View Clients"}
          </button>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `top-clients-widget.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git add src/components/dashboard/widgets/top-clients-widget.tsx && git commit -m "feat(widgets): redesign top-clients — WidgetLineItem, revenue in SM, proportional bars"
```

---

### Task 3: Redesign Client List Widget

**Files:**
- Modify: `src/components/dashboard/widgets/client-list-widget.tsx` (full file rewrite)

**Context files to read:**
- `src/components/dashboard/widgets/shared/widget-line-item.tsx` — WidgetLineItem API
- `src/components/dashboard/widgets/shared/widget-inline-action.tsx` — WidgetInlineAction multi-mode
- `src/components/dashboard/widgets/shared/widget-period-picker.tsx` — WidgetPeriodPicker API
- `src/components/dashboard/widgets/shared/widget-hero-collapse.tsx` — WidgetHeroCollapse API
- `src/lib/hooks/use-invoices.ts` — useInvoices hook
- `src/lib/hooks/use-clients.ts` — useClients hook

- [ ] **Step 1: Rewrite client-list-widget.tsx**

Replace the entire file with:

```tsx
"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, FolderPlus, Receipt, FileText, ClipboardList } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WT, showActions } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useClients, useProjects, useInvoices } from "@/lib/hooks";
import { InvoiceStatus } from "@/lib/types/pipeline";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ClientListWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sort type
// ---------------------------------------------------------------------------
type SortBy = "recent" | "name" | "revenue";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ClientListWidget({ size, config }: ClientListWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const navigate = useCallback((path: string) => router.push(path), [router]);

  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const [sortBy, setSortBy] = useState<SortBy>(
    (config.sortBy as SortBy) ?? "recent"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();

  const isLoading = clientsLoading || projectsLoading || invoicesLoading;

  const clients = useMemo(() => {
    if (!clientsData?.clients) return [];
    return clientsData.clients.filter((c) => !c.deletedAt);
  }, [clientsData]);

  // Build project count map
  const projectCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!projectsData?.projects) return map;
    for (const p of projectsData.projects) {
      if (p.clientId && !p.deletedAt) {
        map[p.clientId] = (map[p.clientId] ?? 0) + 1;
      }
    }
    return map;
  }, [projectsData]);

  // Build revenue map (sum of paid invoices per client)
  const revenueMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!invoicesData) return map;
    const invoices = Array.isArray(invoicesData) ? invoicesData : [];
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status === InvoiceStatus.Paid) {
        map[inv.clientId] = (map[inv.clientId] ?? 0) + inv.amountPaid;
      }
    }
    return map;
  }, [invoicesData]);

  // Build last activity map (most recent updatedAt across invoices/projects)
  const lastActivityMap = useMemo(() => {
    const map: Record<string, Date> = {};

    const updateMap = (clientId: string, date: Date | string | null) => {
      if (!date || !clientId) return;
      const d = typeof date === "string" ? new Date(date) : date;
      if (!map[clientId] || d > map[clientId]) {
        map[clientId] = d;
      }
    };

    if (invoicesData) {
      const invoices = Array.isArray(invoicesData) ? invoicesData : [];
      for (const inv of invoices) {
        if (!inv.deletedAt) updateMap(inv.clientId, inv.updatedAt);
      }
    }
    if (projectsData?.projects) {
      for (const p of projectsData.projects) {
        if (!p.deletedAt && p.clientId) updateMap(p.clientId, p.updatedAt);
      }
    }

    return map;
  }, [invoicesData, projectsData]);

  // LG metrics
  const lgMetrics = useMemo(() => {
    if (!showActions(size)) return null;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let activeThisMonth = 0;
    let newThisMonth = 0;

    for (const c of clients) {
      const lastActivity = lastActivityMap[c.id];
      if (lastActivity && lastActivity >= monthStart) {
        activeThisMonth++;
      }
      if (c.createdAt) {
        const created = typeof c.createdAt === "string" ? new Date(c.createdAt) : c.createdAt;
        if (created >= monthStart) {
          newThisMonth++;
        }
      }
    }

    return { total: clients.length, activeThisMonth, newThisMonth };
  }, [clients, lastActivityMap, size]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return clients;
    const q = searchQuery.toLowerCase();
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, searchQuery]);

  // Sort
  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sortBy) {
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "revenue":
        list.sort((a, b) => (revenueMap[b.id] ?? 0) - (revenueMap[a.id] ?? 0));
        break;
      case "recent":
      default:
        list.sort((a, b) => {
          const aTime = lastActivityMap[a.id]?.getTime() ?? 0;
          const bTime = lastActivityMap[b.id]?.getTime() ?? 0;
          return bTime - aTime;
        });
        break;
    }
    return list;
  }, [filtered, sortBy, revenueMap, lastActivityMap]);

  // Most recent client (SM)
  const mostRecent = useMemo(() => {
    if (clients.length === 0) return null;
    const byRecent = [...clients].sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
    return byRecent[0] ?? null;
  }, [clients]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = (e.target as HTMLDivElement).scrollTop;
    setHeroCollapsed(scrollTop > 20);
  }, []);

  // ── SM: Hero + title + latest client ────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
            {isLoading ? "—" : clients.length}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("clientList.title")}
          </span>
          {!isLoading && mostRecent && (
            <span className="font-mohave text-caption-sm text-text-tertiary truncate mt-0.5">
              {t("clientList.latest")}: {mostRecent.name}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG ─────────────────────────────────────────────────────────────
  const sortOptions = [
    { value: "recent", label: t("clientList.sortRecent") ?? "Recent" },
    { value: "name", label: t("clientList.sortName") ?? "Name" },
    { value: "revenue", label: t("clientList.sortRevenue") ?? "Revenue" },
  ];

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER: Title + Sort + New Client */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("clientList.title")}
          </span>
          <div className="flex items-center gap-1">
            <WidgetPeriodPicker
              options={sortOptions}
              value={sortBy}
              onChange={(v) => setSortBy(v as SortBy)}
              size={size}
            />
            <button
              onClick={() => navigate("/clients/new")}
              className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors text-text-disabled hover:text-text-secondary"
              title={t("clientList.newClient") ?? "New Client"}
            >
              <Plus className="w-[14px] h-[14px]" />
            </button>
          </div>
        </div>

        {/* LG METRICS */}
        {lgMetrics && showActions(size) && (
          <WidgetHeroCollapse collapsed={heroCollapsed} collapsedHeight="0px" expandedHeight="60px">
            <div className="flex items-start gap-4 mb-2">
              <div>
                <span className="font-mono text-data-lg font-bold text-text-primary block leading-none">
                  {lgMetrics.total}
                </span>
                <span className="font-kosugi text-micro text-text-tertiary uppercase">
                  {t("clientList.total")}
                </span>
              </div>
              <div>
                <span className="font-mono text-data-lg font-bold text-text-primary block leading-none">
                  {lgMetrics.activeThisMonth}
                </span>
                <span className="font-kosugi text-micro text-text-tertiary uppercase">
                  {t("clientList.activeMonth")}
                </span>
              </div>
              <div>
                <span className="font-mono text-data-lg font-bold text-text-primary block leading-none">
                  {lgMetrics.newThisMonth}
                </span>
                <span className="font-kosugi text-micro text-text-tertiary uppercase">
                  {t("clientList.newMonth")}
                </span>
              </div>
            </div>
          </WidgetHeroCollapse>
        )}

        {/* SEARCH BOX */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("clientList.search") ?? "Search clients..."}
          className="w-full bg-background-input border border-border-input font-mohave text-caption-sm placeholder:text-text-placeholder rounded-sm px-2 py-1 outline-none focus:border-ops-accent/50 transition-colors mb-2"
        />

        {/* CLIENT LIST */}
        <ScrollFade onScroll={showActions(size) ? handleScroll : undefined}>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">
                {t("clientList.loading")}
              </span>
            </div>
          ) : sorted.length === 0 ? (
            <WidgetEmptyState
              message={searchQuery ? `No clients match "${searchQuery}"` : (t("clientList.empty") ?? "No clients yet")}
            />
          ) : (
            <div className="flex flex-col gap-[2px]">
              {sorted.map((client, i) => {
                const contact = client.email ?? client.phoneNumber ?? undefined;
                const projCount = projectCountMap[client.id] ?? 0;

                return (
                  <WidgetLineItem
                    key={client.id}
                    indicator={{
                      type: "avatar",
                      initials: client.name ? client.name[0].toUpperCase() : "?",
                      color: WT.accent,
                    }}
                    primary={client.name}
                    secondary={contact}
                    metric={
                      <span
                        className={cn(
                          "font-mohave text-[10px] px-1 py-[1px] rounded-sm uppercase tracking-wider shrink-0 border",
                          projCount > 0
                            ? "text-ops-accent bg-ops-accent/10 border-ops-accent/30"
                            : "text-text-disabled bg-text-disabled/10 border-text-disabled/30"
                        )}
                      >
                        {projCount} {projCount === 1 ? t("clientList.proj") : t("clientList.projs")}
                      </span>
                    }
                    action={
                      <WidgetInlineAction
                        icon={Plus}
                        actions={[
                          { icon: FolderPlus, label: t("clientList.createProject") ?? "Create Project", onAction: () => navigate(`/projects/new?clientId=${client.id}`) },
                          { icon: Receipt, label: t("clientList.createInvoice") ?? "Create Invoice", onAction: () => navigate(`/invoices/new?clientId=${client.id}`) },
                          { icon: FileText, label: t("clientList.createEstimate") ?? "Create Estimate", onAction: () => navigate(`/estimates/new?clientId=${client.id}`) },
                          { icon: ClipboardList, label: t("clientList.createTask") ?? "Create Task", onAction: () => navigate(`/tasks/new?clientId=${client.id}`) },
                        ]}
                      />
                    }
                    onClick={() => navigate(`/clients/${client.id}`)}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                );
              })}
            </div>
          )}
        </ScrollFade>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Check if ScrollFade accepts onScroll**

Read `src/components/dashboard/widgets/shared/scroll-fade.tsx` to verify it forwards or supports an `onScroll` prop. If it wraps a `<div>` with `overflow-y-auto`, the `onScroll` can be placed on that div. If ScrollFade does NOT accept `onScroll`, wrap the inner content in a div with `onScroll` and `overflow-y-auto scrollbar-hide` instead, and remove the ScrollFade wrapper for the LG case.

- [ ] **Step 3: Verify the build compiles**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `client-list-widget.tsx`.

- [ ] **Step 4: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git add src/components/dashboard/widgets/client-list-widget.tsx && git commit -m "feat(widgets): redesign client-list — search, sort, inline actions, LG hero metrics"
```

---

### Task 4: Rewrite Client Attention Widget

**Files:**
- Modify: `src/components/dashboard/widgets/client-attention-widget.tsx` (full file rewrite)

**Context files to read:**
- `src/components/dashboard/widgets/shared/widget-line-item.tsx` — WidgetLineItem API
- `src/components/dashboard/widgets/shared/widget-inline-action.tsx` — WidgetInlineAction single-mode
- `src/components/dashboard/widgets/shared/widget-hero-collapse.tsx` — WidgetHeroCollapse API
- `src/components/dashboard/widgets/shared/widget-background-chart.tsx` — WidgetBackgroundChart API
- `src/components/dashboard/widgets/shared/widget-empty-state.tsx` — WidgetEmptyState API
- `src/components/dashboard/widgets/shared/widget-more-button.tsx` — WidgetMoreButton API
- `src/stores/widget-action-queue.ts` — useWidgetActionQueue API
- `src/lib/types/pipeline.ts` — OpportunityStage, EstimateStatus, InvoiceStatus
- `src/lib/types/models.ts` — TaskStatus, ProjectTask

- [ ] **Step 1: Rewrite client-attention-widget.tsx**

Replace the entire file with:

```tsx
"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  CalendarDays,
  FileText,
  Send,
  ExternalLink,
  CheckCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, isCompact, showActions } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { TaskStatus } from "@/lib/types/models";
import {
  InvoiceStatus,
  EstimateStatus,
  OpportunityStage,
} from "@/lib/types/pipeline";
import {
  useClients,
  useInvoices,
  useEstimates,
  useTasks,
  useOpportunities,
  useProjects,
} from "@/lib/hooks";
import { useWidgetActionQueue } from "@/stores/widget-action-queue";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ClientAttentionWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AttentionReason =
  | "unassigned-tasks"
  | "unscheduled-tasks"
  | "stale-quoting"
  | "estimate-no-response"
  | "past-due-invoice"
  | "estimate-expiring";

interface AttentionItem {
  clientId: string;
  clientName: string;
  reason: AttentionReason;
  detail: string;
  entityId: string;
  secondaryEntityId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REASON_PRIORITY: Record<AttentionReason, number> = {
  "past-due-invoice": 0,
  "unassigned-tasks": 1,
  "unscheduled-tasks": 2,
  "stale-quoting": 3,
  "estimate-no-response": 4,
  "estimate-expiring": 5,
};

const REASON_COLORS: Record<AttentionReason, string> = {
  "past-due-invoice": WT.error,
  "unassigned-tasks": WT.warning,
  "unscheduled-tasks": WT.warning,
  "stale-quoting": WT.accent,
  "estimate-no-response": WT.accent,
  "estimate-expiring": WT.warning,
};

const REASON_ICONS: Record<AttentionReason, typeof Users> = {
  "unassigned-tasks": Users,
  "unscheduled-tasks": CalendarDays,
  "stale-quoting": FileText,
  "estimate-no-response": Send,
  "past-due-invoice": ExternalLink,
  "estimate-expiring": ExternalLink,
};

// ---------------------------------------------------------------------------
// SVG Ring Chart (SM)
// ---------------------------------------------------------------------------
function AttentionRing({
  segments,
  isVisible,
  reducedMotion,
}: {
  segments: { count: number; color: string }[];
  isVisible: boolean;
  reducedMotion: boolean | null;
}) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return null;

  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
      {segments
        .filter((s) => s.count > 0)
        .map((seg, i) => {
          const segLen = (seg.count / total) * circumference;
          const currentOffset = offset;
          offset += segLen;

          return (
            <circle
              key={i}
              cx="28"
              cy="28"
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth="5"
              strokeDasharray={`${segLen} ${circumference - segLen}`}
              strokeDashoffset={-currentOffset}
              strokeLinecap="round"
              style={{
                opacity: isVisible ? 1 : 0,
                transition:
                  reducedMotion
                    ? "opacity 150ms ease"
                    : `opacity 500ms ${WIDGET_EASE_CSS}, stroke-dashoffset 500ms ${WIDGET_EASE_CSS}`,
              }}
              transform="rotate(-90 28 28)"
            />
          );
        })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ClientAttentionWidget({ size }: ClientAttentionWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const navigate = useCallback((path: string) => router.push(path), [router]);
  const queueAction = useWidgetActionQueue((s) => s.queueAction);

  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const [expanded, setExpanded] = useState(false);
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();
  const { data: estimatesData, isLoading: estimatesLoading } = useEstimates();
  const { data: tasksData, isLoading: tasksLoading } = useTasks();
  const { data: opportunitiesData, isLoading: oppsLoading } = useOpportunities();
  const { data: projectsData, isLoading: projectsLoading } = useProjects();

  const isLoading =
    clientsLoading || invoicesLoading || estimatesLoading ||
    tasksLoading || oppsLoading || projectsLoading;

  // ── Attention items ────────────────────────────────────────────────────
  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    const now = new Date();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Build lookups
    const clientNameMap: Record<string, string> = {};
    if (clientsData?.clients) {
      for (const c of clientsData.clients) {
        if (!c.deletedAt) clientNameMap[c.id] = c.name;
      }
    }

    const projectClientMap: Record<string, string> = {};
    if (projectsData?.projects) {
      for (const p of projectsData.projects) {
        if (!p.deletedAt && p.clientId) {
          projectClientMap[p.id] = p.clientId;
        }
      }
    }

    // Track which opportunityIds have a sent estimate
    const oppHasSentEstimate = new Set<string>();
    const estimates = Array.isArray(estimatesData) ? estimatesData : [];
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (est.opportunityId && est.sentAt) {
        oppHasSentEstimate.add(est.opportunityId);
      }
    }

    // 1. Unassigned tasks — group by client
    const unassignedByClient: Record<string, { count: number; projectId: string }> = {};
    const unscheduledByClient: Record<string, { count: number; projectId: string }> = {};

    const tasks = tasksData?.tasks ?? [];
    for (const task of tasks) {
      if (task.deletedAt) continue;
      if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) continue;

      const clientId = projectClientMap[task.projectId];
      if (!clientId || !clientNameMap[clientId]) continue;

      if (task.teamMemberIds.length === 0) {
        if (!unassignedByClient[clientId]) {
          unassignedByClient[clientId] = { count: 0, projectId: task.projectId };
        }
        unassignedByClient[clientId].count++;
      }

      if (task.startDate === null) {
        if (!unscheduledByClient[clientId]) {
          unscheduledByClient[clientId] = { count: 0, projectId: task.projectId };
        }
        unscheduledByClient[clientId].count++;
      }
    }

    for (const [clientId, data] of Object.entries(unassignedByClient)) {
      items.push({
        clientId,
        clientName: clientNameMap[clientId],
        reason: "unassigned-tasks",
        detail: (t("clientAttention.unassignedTasks") ?? "{count} unassigned tasks").replace("{count}", String(data.count)),
        entityId: data.projectId,
      });
    }

    for (const [clientId, data] of Object.entries(unscheduledByClient)) {
      items.push({
        clientId,
        clientName: clientNameMap[clientId],
        reason: "unscheduled-tasks",
        detail: (t("clientAttention.unscheduledTasks") ?? "{count} unscheduled tasks").replace("{count}", String(data.count)),
        entityId: data.projectId,
      });
    }

    // 3. Stale quoting
    const opportunities = Array.isArray(opportunitiesData) ? opportunitiesData : [];
    for (const opp of opportunities) {
      if (!opp.clientId || !clientNameMap[opp.clientId]) continue;
      if (opp.stage !== OpportunityStage.Quoting) continue;

      const stageAge = now.getTime() - new Date(opp.stageEnteredAt).getTime();
      if (stageAge <= twoDaysMs) continue;
      if (oppHasSentEstimate.has(opp.id)) continue;

      const days = Math.floor(stageAge / (24 * 60 * 60 * 1000));
      items.push({
        clientId: opp.clientId,
        clientName: clientNameMap[opp.clientId],
        reason: "stale-quoting",
        detail: (t("clientAttention.staleQuoting") ?? "In Quoting {days}d — no estimate sent").replace("{days}", String(days)),
        entityId: opp.id,
      });
    }

    // 4. Estimate no response
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (est.status !== EstimateStatus.Sent && est.status !== EstimateStatus.Viewed) continue;
      if (!est.sentAt) continue;
      if (!clientNameMap[est.clientId]) continue;

      const sentAge = now.getTime() - new Date(est.sentAt).getTime();
      if (sentAge <= threeDaysMs) continue;

      const days = Math.floor(sentAge / (24 * 60 * 60 * 1000));
      const statusLabel = est.status === EstimateStatus.Sent ? "sent" : "viewed";
      items.push({
        clientId: est.clientId,
        clientName: clientNameMap[est.clientId],
        reason: "estimate-no-response",
        detail: (t("clientAttention.estimateNoResponse") ?? "Estimate {number} — {status} {days}d, no response")
          .replace("{number}", est.estimateNumber)
          .replace("{status}", statusLabel)
          .replace("{days}", String(days)),
        entityId: est.id,
        secondaryEntityId: est.opportunityId ?? undefined,
      });
    }

    // 5. Past-due invoices — group by client
    const pastDueByClient: Record<string, { count: number; invoiceId: string }> = {};
    const invoices = Array.isArray(invoicesData) ? invoicesData : [];
    for (const inv of invoices) {
      if (inv.deletedAt) continue;
      if (inv.status !== InvoiceStatus.PastDue) continue;
      if (!clientNameMap[inv.clientId]) continue;

      if (!pastDueByClient[inv.clientId]) {
        pastDueByClient[inv.clientId] = { count: 0, invoiceId: inv.id };
      }
      pastDueByClient[inv.clientId].count++;
    }

    for (const [clientId, data] of Object.entries(pastDueByClient)) {
      items.push({
        clientId,
        clientName: clientNameMap[clientId],
        reason: "past-due-invoice",
        detail: t("clientAttention.pastDueInvoice") ?? "Past Due Invoice",
        entityId: data.invoiceId,
      });
    }

    // 6. Expiring estimates
    for (const est of estimates) {
      if (est.deletedAt) continue;
      if (
        est.status === EstimateStatus.Approved ||
        est.status === EstimateStatus.Converted ||
        est.status === EstimateStatus.Declined ||
        est.status === EstimateStatus.Expired ||
        est.status === EstimateStatus.Superseded
      ) continue;
      if (!est.expirationDate) continue;
      if (!clientNameMap[est.clientId]) continue;

      const expDate = typeof est.expirationDate === "string"
        ? new Date(est.expirationDate)
        : est.expirationDate;

      if (expDate <= now || expDate.getTime() - now.getTime() > sevenDaysMs) continue;

      const days = Math.ceil((expDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      items.push({
        clientId: est.clientId,
        clientName: clientNameMap[est.clientId],
        reason: "estimate-expiring",
        detail: (t("clientAttention.estimateExpiring") ?? "Estimate Expiring").replace("{days}", String(days)),
        entityId: est.id,
      });
    }

    // Sort by priority, then client name
    items.sort((a, b) => {
      const priDiff = REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason];
      if (priDiff !== 0) return priDiff;
      return a.clientName.localeCompare(b.clientName);
    });

    return items;
  }, [clientsData, invoicesData, estimatesData, tasksData, opportunitiesData, projectsData, t]);

  const count = attentionItems.length;

  // ── Category counts for ring chart / legend ────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of attentionItems) {
      counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    }
    return counts;
  }, [attentionItems]);

  const ringSegments = useMemo(() => {
    const red = categoryCounts["past-due-invoice"] ?? 0;
    const amber =
      (categoryCounts["unassigned-tasks"] ?? 0) +
      (categoryCounts["unscheduled-tasks"] ?? 0) +
      (categoryCounts["estimate-expiring"] ?? 0);
    const accent =
      (categoryCounts["stale-quoting"] ?? 0) +
      (categoryCounts["estimate-no-response"] ?? 0);

    return [
      { count: red, color: WT.error },
      { count: amber, color: WT.warning },
      { count: accent, color: WT.accent },
    ].filter((s) => s.count > 0);
  }, [categoryCounts]);

  // ── Inline action handler ──────────────────────────────────────────────
  function getActionForItem(item: AttentionItem) {
    const Icon = REASON_ICONS[item.reason];
    const labels: Record<AttentionReason, string> = {
      "unassigned-tasks": t("clientAttention.assignCrew") ?? "Assign crew",
      "unscheduled-tasks": t("clientAttention.schedule") ?? "Schedule",
      "stale-quoting": t("clientAttention.createEstimate") ?? "Create estimate",
      "estimate-no-response": t("clientAttention.sendFollowUp") ?? "Send follow-up",
      "past-due-invoice": t("clientAttention.viewInvoice") ?? "View invoice",
      "estimate-expiring": t("clientAttention.viewEstimate") ?? "View estimate",
    };

    const onAction = () => {
      switch (item.reason) {
        case "unassigned-tasks":
        case "unscheduled-tasks":
          navigate(`/projects/${item.entityId}`);
          break;
        case "stale-quoting":
          navigate(`/estimates/new?opportunityId=${item.entityId}`);
          break;
        case "estimate-no-response":
          queueAction({
            type: "follow-up",
            label: t("clientAttention.followUpQueued") ?? "Follow-up queued — sending in 5m",
            entityId: item.entityId,
            executeFn: async () => {
              // The queue will execute after 5 minutes
              // In production this would call an API to send the follow-up
            },
          });
          break;
        case "past-due-invoice":
          navigate(`/invoices/${item.entityId}`);
          break;
        case "estimate-expiring":
          navigate(`/estimates/${item.entityId}`);
          break;
      }
    };

    return (
      <WidgetInlineAction
        icon={Icon}
        label={labels[item.reason]}
        onAction={onAction}
      />
    );
  }

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = (e.target as HTMLDivElement).scrollTop;
    setHeroCollapsed(scrollTop > 20);
  }, []);

  // ── SM ─────────────────────────────────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={
            <div className="h-full flex items-center justify-end pr-2">
              <AttentionRing
                segments={ringSegments}
                isVisible={isVisible}
                reducedMotion={reducedMotion}
              />
            </div>
          }
          opacity={0.4}
        >
          <div className="h-full flex flex-col p-3">
            <span
              className={cn(
                "font-mono text-data-lg font-bold leading-none",
                isLoading ? "text-text-disabled" : count > 0 ? "text-ops-error" : "text-status-success"
              )}
            >
              {isLoading ? "—" : count}
            </span>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("clientAttention.title")}
            </span>
            {!isLoading && count > 0 && (
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {(categoryCounts["past-due-invoice"] ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.error }} />
                    <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                      {categoryCounts["past-due-invoice"]} {t("clientAttention.overdue")}
                    </span>
                  </span>
                )}
                {((categoryCounts["unassigned-tasks"] ?? 0) + (categoryCounts["unscheduled-tasks"] ?? 0)) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.warning }} />
                    <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                      {(categoryCounts["unassigned-tasks"] ?? 0) + (categoryCounts["unscheduled-tasks"] ?? 0)} {t("clientAttention.tasks")}
                    </span>
                  </span>
                )}
                {((categoryCounts["stale-quoting"] ?? 0) + (categoryCounts["estimate-no-response"] ?? 0)) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.accent }} />
                    <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                      {(categoryCounts["stale-quoting"] ?? 0) + (categoryCounts["estimate-no-response"] ?? 0)} {t("clientAttention.staleQuotes")}
                    </span>
                  </span>
                )}
              </div>
            )}
            {!isLoading && count === 0 && (
              <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-0.5">
                {t("clientAttention.allGood")}
              </span>
            )}
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }

  // ── MD / LG ────────────────────────────────────────────────────────────
  const maxItems = showActions(size) ? attentionItems.length : 5;
  const displayItems = expanded ? attentionItems : attentionItems.slice(0, maxItems);
  const remaining = attentionItems.length - maxItems;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("clientAttention.title")}
          </span>
          <span
            className={cn(
              "font-mono text-micro",
              isLoading ? "text-text-tertiary" : count > 0 ? "text-ops-error" : "text-text-tertiary"
            )}
          >
            {isLoading
              ? "..."
              : `${count} ${count === 1 ? t("clientAttention.client") : t("clientAttention.clients")}`}
          </span>
        </div>

        {/* LG HERO */}
        {showActions(size) && count > 0 && (
          <WidgetHeroCollapse collapsed={heroCollapsed} collapsedHeight="0px" expandedHeight="50px">
            <div className="mb-2">
              <span className="font-mono text-data-lg font-bold text-ops-error leading-none">
                {count}
              </span>
              <span className="font-kosugi text-micro text-text-tertiary uppercase ml-1">
                {t("clientAttention.needAttention")}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                {(categoryCounts["past-due-invoice"] ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.error }} />
                    <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                      {categoryCounts["past-due-invoice"]} {t("clientAttention.overdue")}
                    </span>
                  </span>
                )}
                {((categoryCounts["unassigned-tasks"] ?? 0) + (categoryCounts["unscheduled-tasks"] ?? 0)) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.warning }} />
                    <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                      {(categoryCounts["unassigned-tasks"] ?? 0) + (categoryCounts["unscheduled-tasks"] ?? 0)} {t("clientAttention.tasks")}
                    </span>
                  </span>
                )}
                {((categoryCounts["stale-quoting"] ?? 0) + (categoryCounts["estimate-no-response"] ?? 0)) > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: WT.accent }} />
                    <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                      {(categoryCounts["stale-quoting"] ?? 0) + (categoryCounts["estimate-no-response"] ?? 0)} {t("clientAttention.staleQuotes")}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </WidgetHeroCollapse>
        )}

        {/* LIST */}
        <ScrollFade onScroll={showActions(size) ? handleScroll : undefined}>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <span className="font-mono text-[11px] text-text-disabled">
                {t("clientAttention.loading")}
              </span>
            </div>
          ) : count === 0 ? (
            <WidgetEmptyState
              icon={CheckCircle}
              message={t("clientAttention.allGood") ?? "All clients in good standing"}
            />
          ) : (
            <div className="flex flex-col gap-[2px]">
              {displayItems.map((item, i) => (
                <WidgetLineItem
                  key={`${item.clientId}-${item.reason}-${item.entityId}`}
                  indicator={{ type: "dot", color: REASON_COLORS[item.reason] }}
                  primary={item.clientName}
                  secondary={item.detail}
                  action={getActionForItem(item)}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              ))}
              {!showActions(size) && remaining > 0 && (
                <WidgetMoreButton
                  remaining={remaining}
                  expanded={expanded}
                  onToggle={() => setExpanded(!expanded)}
                />
              )}
            </div>
          )}
        </ScrollFade>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `client-attention-widget.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git add src/components/dashboard/widgets/client-attention-widget.tsx && git commit -m "feat(widgets): rewrite client-attention — 6 triggers, inline actions, SVG ring chart"
```

---

### Task 5: Redesign Activity Feed Widget

**Files:**
- Modify: `src/components/dashboard/widgets/activity-feed-widget.tsx` (full file rewrite)

**Context files to read:**
- `src/components/dashboard/widgets/shared/widget-line-item.tsx` — WidgetLineItem API
- `src/components/dashboard/widgets/shared/widget-hero-collapse.tsx` — WidgetHeroCollapse API
- `src/lib/types/pipeline.ts` — ActivityType enum, Activity interface
- `src/lib/hooks/use-users.ts` — useTeamMembers hook
- `src/lib/hooks/use-projects.ts` — useProjects hook

- [ ] **Step 1: Rewrite activity-feed-widget.tsx**

Replace the entire file with:

```tsx
"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import {
  StickyNote,
  Mail,
  Phone,
  MessageSquare,
  Video,
  Send,
  CheckCircle,
  XCircle,
  Receipt,
  DollarSign,
  ArrowRightLeft,
  PlusCircle,
  Trophy,
  XOctagon,
  Settings,
  MapPin,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { isCompact, showFooter, showActions } from "@/lib/widget-tokens";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useAuthStore } from "@/lib/store/auth-store";
import { useTeamMembers, useProjects } from "@/lib/hooks";
import {
  ActivityType,
  ACTIVITY_TYPE_COLORS,
} from "@/lib/types/pipeline";
import type { Activity } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { parseDateRequired } from "@/lib/supabase/helpers";
import { ScrollFade } from "./shared/scroll-fade";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Inline hook — company-wide recent activities
// ---------------------------------------------------------------------------
function useRecentActivities(companyId: string | undefined) {
  return useQuery<Activity[]>({
    queryKey: ["activities", "company-feed", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        throw new Error(`Failed to fetch activities: ${error.message}`);
      }

      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        companyId: row.company_id as string,
        opportunityId: (row.opportunity_id as string) ?? null,
        clientId: (row.client_id as string) ?? null,
        estimateId: (row.estimate_id as string) ?? null,
        invoiceId: (row.invoice_id as string) ?? null,
        projectId: (row.project_id as string) ?? null,
        siteVisitId: (row.site_visit_id as string) ?? null,
        type: row.type as ActivityType,
        subject: row.subject as string,
        content: (row.content as string) ?? null,
        outcome: (row.outcome as string) ?? null,
        direction: (row.direction as Activity["direction"]) ?? null,
        durationMinutes:
          row.duration_minutes != null ? Number(row.duration_minutes) : null,
        attachments: (row.attachments as string[]) ?? [],
        emailThreadId: (row.email_thread_id as string) ?? null,
        emailMessageId: (row.email_message_id as string) ?? null,
        isRead: (row.is_read as boolean) ?? true,
        fromEmail: (row.from_email as string) ?? null,
        createdBy: (row.created_by as string) ?? null,
        createdAt: parseDateRequired(row.created_at),
      }));
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACTIVITY_TYPE_ICONS: Record<ActivityType, LucideIcon> = {
  [ActivityType.Note]: StickyNote,
  [ActivityType.Email]: Mail,
  [ActivityType.Call]: Phone,
  [ActivityType.TextMessage]: MessageSquare,
  [ActivityType.Meeting]: Video,
  [ActivityType.EstimateSent]: Send,
  [ActivityType.EstimateAccepted]: CheckCircle,
  [ActivityType.EstimateDeclined]: XCircle,
  [ActivityType.InvoiceSent]: Receipt,
  [ActivityType.PaymentReceived]: DollarSign,
  [ActivityType.StageChange]: ArrowRightLeft,
  [ActivityType.Created]: PlusCircle,
  [ActivityType.Won]: Trophy,
  [ActivityType.Lost]: XOctagon,
  [ActivityType.System]: Settings,
  [ActivityType.SiteVisitScheduled]: MapPin,
  [ActivityType.SiteVisit]: MapPin,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function activityColor(type: ActivityType): string {
  return ACTIVITY_TYPE_COLORS[type] ?? "#6B7280";
}

function activityTypeLabel(type: ActivityType, t: (key: string) => string): string {
  return t(`activity.type.${type}`) ?? type;
}

function timeAgo(date: Date, t: (key: string) => string): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return t("activity.justNow");
  if (diffMinutes < 60) return t("activity.minutesAgo").replace("{count}", String(diffMinutes));
  if (diffHours < 24) return t("activity.hoursAgo").replace("{count}", String(diffHours));
  if (diffDays === 0) return t("activity.today");
  return t("activity.daysAgo").replace("{count}", String(diffDays));
}

function getActivityPath(activity: Activity): string | null {
  if (activity.projectId) return `/projects/${activity.projectId}`;
  if (activity.opportunityId) return `/pipeline/${activity.opportunityId}`;
  if (activity.invoiceId) return `/invoices/${activity.invoiceId}`;
  if (activity.estimateId) return `/estimates/${activity.estimateId}`;
  if (activity.siteVisitId) return `/site-visits/${activity.siteVisitId}`;
  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ActivityWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ActivityWidget({
  size,
  config,
  onNavigate,
}: ActivityWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { company } = useAuthStore();
  const companyId = company?.id;
  const { data: activities, isLoading } = useRecentActivities(companyId);
  const { data: teamData } = useTeamMembers();
  const { data: projectsData } = useProjects();

  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  const count = activities?.length ?? 0;

  // Author name lookup
  const authorMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!teamData?.users) return map;
    for (const u of teamData.users) {
      map[u.id] = `${u.firstName} ${u.lastName}`.trim() || u.email || "Unknown";
    }
    return map;
  }, [teamData]);

  // Project name lookup
  const projectNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!projectsData?.projects) return map;
    for (const p of projectsData.projects) {
      if (p.title) map[p.id] = p.title;
    }
    return map;
  }, [projectsData]);

  // LG metrics
  const lgMetrics = useMemo(() => {
    if (!activities || !showActions(size)) return null;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todayActivities = activities.filter((a) => a.createdAt >= todayStart);
    const todayCount = todayActivities.length;
    const activeUsers = new Set(todayActivities.map((a) => a.createdBy).filter(Boolean)).size;

    // Most active project
    const projectCounts: Record<string, number> = {};
    for (const a of activities) {
      if (a.projectId) {
        projectCounts[a.projectId] = (projectCounts[a.projectId] ?? 0) + 1;
      }
    }
    let mostActiveProjectName: string | null = null;
    let maxCount = 0;
    for (const [pid, cnt] of Object.entries(projectCounts)) {
      if (cnt > maxCount) {
        maxCount = cnt;
        mostActiveProjectName = projectNameMap[pid] ?? null;
      }
    }

    return { todayCount, activeUsers, mostActiveProjectName };
  }, [activities, size, projectNameMap]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setHeroCollapsed((e.target as HTMLDivElement).scrollTop > 20);
  }, []);

  // ── XS / SM: Hero-first compact card ─────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <div className="flex items-baseline justify-between">
            <span
              className={`font-mono text-data-lg font-bold leading-none ${
                isLoading
                  ? "text-text-disabled"
                  : count > 0
                    ? "text-text-primary"
                    : "text-text-disabled"
              }`}
            >
              {isLoading ? "—" : count}
            </span>
            {showFooter(size) && (
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/activity"); }}
                className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
              </button>
            )}
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("activity.title")}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-0.5 truncate">
            {isLoading
              ? "..."
              : activities && activities.length > 0
                ? activities[0].subject || activityTypeLabel(activities[0].type, t)
                : t("activity.empty")}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD+: Scrollable activity feed ──────────────────────────────────────
  const maxItems = size === "lg" || size === "xl" ? 12 : 6;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("activity.title")}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {isLoading ? "..." : `${count} ${t("activity.events")}`}
          </span>
        </div>

        {/* LG Hero Metrics */}
        {lgMetrics && showActions(size) && (
          <WidgetHeroCollapse collapsed={heroCollapsed} collapsedHeight="0px" expandedHeight="50px">
            <div className="flex items-start gap-4 mb-2">
              <div>
                <span className="font-mono text-data-lg font-bold text-text-primary block leading-none">
                  {lgMetrics.todayCount}
                </span>
                <span className="font-kosugi text-micro text-text-tertiary uppercase">
                  {t("activity.todayCount")}
                </span>
              </div>
              <div>
                <span className="font-mono text-data-lg font-bold text-text-primary block leading-none">
                  {lgMetrics.activeUsers}
                </span>
                <span className="font-kosugi text-micro text-text-tertiary uppercase">
                  {t("activity.activeUsers")}
                </span>
              </div>
              {lgMetrics.mostActiveProjectName && (
                <div className="min-w-0">
                  <span className="font-mohave text-caption-sm text-text-primary block truncate leading-none">
                    {lgMetrics.mostActiveProjectName}
                  </span>
                  <span className="font-kosugi text-micro text-text-tertiary uppercase">
                    {t("activity.mostActive")}
                  </span>
                </div>
              )}
            </div>
          </WidgetHeroCollapse>
        )}

        {/* Feed list */}
        <ScrollFade onScroll={showActions(size) ? handleScroll : undefined}>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <span className="font-mono text-[11px] text-text-disabled">
                {t("activity.loading")}
              </span>
            </div>
          ) : !activities || activities.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">
              {t("activity.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-[2px]">
              {activities.slice(0, maxItems).map((activity, i) => {
                const IconComp = ACTIVITY_TYPE_ICONS[activity.type] ?? Settings;
                const author = activity.createdBy ? authorMap[activity.createdBy] : null;
                const preview = activity.content
                  ? activity.content.slice(0, 40) + (activity.content.length > 40 ? "..." : "")
                  : null;
                const secondary = [author, preview].filter(Boolean).join(" · ") || undefined;
                const path = getActivityPath(activity);

                return (
                  <WidgetLineItem
                    key={activity.id}
                    indicator={{
                      type: "icon",
                      icon: IconComp,
                      color: activityColor(activity.type),
                    }}
                    primary={activity.subject || activityTypeLabel(activity.type, t)}
                    secondary={secondary}
                    metric={timeAgo(activity.createdAt, t)}
                    onClick={path ? () => onNavigate(path) : undefined}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                );
              })}
              {activities.length > maxItems && (
                <span className="font-mono text-[11px] text-text-disabled block px-1 pt-1">
                  +{activities.length - maxItems} more
                </span>
              )}
            </div>
          )}
        </ScrollFade>

        {/* Footer nav */}
        <button
          onClick={() => onNavigate("/activity")}
          className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
        >
          {t("activity.viewAll")}
        </button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `activity-feed-widget.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git add src/components/dashboard/widgets/activity-feed-widget.tsx && git commit -m "feat(widgets): redesign activity-feed — WidgetLineItem, deep links, author names, LG metrics"
```

---

### Task 6: Redesign Notifications Widget

**Files:**
- Modify: `src/components/dashboard/widgets/notifications-widget.tsx` (full file rewrite)

**Context files to read:**
- `src/components/dashboard/widgets/shared/widget-line-item.tsx` — WidgetLineItem API
- `src/lib/hooks/use-notifications.ts` — useNotifications, useDismissNotification

- [ ] **Step 1: Rewrite notifications-widget.tsx**

Replace the entire file with:

```tsx
"use client";

import { useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { useNotifications, useDismissNotification } from "@/lib/hooks/use-notifications";
import { isCompact, WT } from "@/lib/widget-tokens";
import type { AppNotification, NotificationType } from "@/lib/api/services/notification-service";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface NotificationsWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTypeColor(type: NotificationType): string {
  switch (type) {
    case "task_assigned":
    case "task_completed":
      return WT.accent;
    case "expense_submitted":
    case "expense_approved":
      return WT.warning;
    case "pipeline_complete":
    case "gmail_sync":
      return WT.success;
    case "mention":
    case "role_needed":
      return WT.error;
    default:
      return WT.muted;
  }
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function sortNotifications(
  notifications: AppNotification[],
  sortBy: string
): AppNotification[] {
  const copy = [...notifications];
  switch (sortBy) {
    case "priority":
      return copy.sort((a, b) => {
        if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    case "type":
      return copy.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    case "recent":
    default:
      return copy.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function NotificationsWidget({ size, config }: NotificationsWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const navigate = useCallback((path: string) => router.push(path), [router]);

  const { data: notifications, isLoading } = useNotifications();
  const dismissMutation = useDismissNotification();
  const sortBy = (config.sortBy as string) ?? "recent";

  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const sortLabel =
    sortBy === "priority"
      ? t("notifications.sortPriority")
      : sortBy === "type"
        ? t("notifications.sortType")
        : t("notifications.sortRecent");

  const sorted = useMemo(
    () => sortNotifications(notifications ?? [], sortBy),
    [notifications, sortBy]
  );

  // ── Compact rendering (XS / SM) ──────────────────────────────────────────
  if (isCompact(size)) {
    const count = sorted.length;
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col items-center justify-center p-3 gap-1">
          <Bell className="w-[16px] h-[16px] text-text-disabled" />
          <span className="font-mohave text-body-sm text-text-primary">
            {isLoading ? "—" : count}
          </span>
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("notifications.title")}
          </span>
        </div>
      </Card>
    );
  }

  // ── Expanded rendering (MD / LG) ─────────────────────────────────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("notifications.title")}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {sortLabel}
          </span>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-mohave text-body-sm text-text-disabled">
              {t("notifications.loading")}
            </p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && sorted.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Bell className="w-[20px] h-[20px] text-text-disabled" />
            <p className="font-mohave text-body-sm text-text-disabled text-center">
              {t("notifications.allClear")}
            </p>
          </div>
        )}

        {/* Notification list */}
        {!isLoading && sorted.length > 0 && (
          <ScrollFade>
            <div className="flex flex-col gap-[2px]">
              {sorted.map((notification, i) => (
                <WidgetLineItem
                  key={notification.id}
                  indicator={{
                    type: "dot",
                    color: getTypeColor(notification.type),
                  }}
                  primary={notification.title}
                  secondary={notification.body ?? undefined}
                  metric={formatTimeAgo(notification.createdAt)}
                  onClick={
                    notification.actionUrl
                      ? () => navigate(notification.actionUrl!)
                      : undefined
                  }
                  action={
                    !notification.persistent ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissMutation.mutate(notification.id);
                        }}
                        className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors text-text-disabled hover:text-text-secondary"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    ) : undefined
                  }
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              ))}
            </div>
          </ScrollFade>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `notifications-widget.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git add src/components/dashboard/widgets/notifications-widget.tsx && git commit -m "feat(widgets): redesign notifications — WidgetLineItem, deep links via actionUrl"
```

---

### Task 7: Verify ScrollFade onScroll Compatibility

**Files:**
- Read: `src/components/dashboard/widgets/shared/scroll-fade.tsx`

Tasks 3, 4, and 5 pass `onScroll` to `ScrollFade` for hero collapse. Verify ScrollFade forwards this prop.

- [ ] **Step 1: Read ScrollFade source**

Read `src/components/dashboard/widgets/shared/scroll-fade.tsx`. Check if it:
1. Accepts an `onScroll` prop
2. Passes it to the scrollable `<div>`

- [ ] **Step 2: If ScrollFade does NOT accept onScroll**

Wrap the `ScrollFade` children in client-list, client-attention, and activity-feed widgets with a scroll-tracking div:

Replace patterns like:
```tsx
<ScrollFade onScroll={showActions(size) ? handleScroll : undefined}>
```

With:
```tsx
<ScrollFade>
  <div onScroll={showActions(size) ? handleScroll : undefined} className="overflow-y-auto scrollbar-hide h-full">
    {/* ...children... */}
  </div>
</ScrollFade>
```

Note: Only apply this fix if ScrollFade doesn't already support `onScroll`. If it does, this task is a no-op.

- [ ] **Step 3: Re-verify build if changes were made**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Commit if changes were made**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git add -A && git commit -m "fix(widgets): wrap scroll listeners for hero collapse compatibility"
```

---

### Task 8: Final Type-Check and Visual Verification

- [ ] **Step 1: Full type check**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit --pretty 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 2: Verify dev server starts**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx next build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Fix any type errors**

If there are type errors, fix them in the appropriate widget file. Common issues to check:
- `invoicesData` might be wrapped in `{ invoices: Invoice[] }` rather than being a raw array — check the `useInvoices` hook return type and adjust destructuring
- `estimatesData` same — check `useEstimates` hook return type
- `opportunitiesData` same — check `useOpportunities` hook return type
- `Project.title` might be a different field name — check the Project interface
- `Project.updatedAt` might not exist — check the Project interface

- [ ] **Step 4: Commit fixes**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && git add -A && git commit -m "fix(widgets): resolve type errors from client/communication widget redesign"
```
