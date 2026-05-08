"use client";

import * as React from "react";
import {
  MapPin,
  Mail,
  Phone,
  CalendarDays,
  CloudSun,
  CloudRain,
  Cloud,
  Sun,
  Snowflake,
  Link2,
} from "lucide-react";
import { useProject } from "@/lib/hooks/use-projects";
import { useClient } from "@/lib/hooks/use-clients";
import { useProjectTeam } from "@/lib/hooks/use-project-team";
import { useProjectTasksGrouped } from "@/lib/hooks/use-project-tasks-grouped";
import { useProjectLedger } from "@/lib/hooks/use-project-ledger";
import { useProjectPipeline } from "@/lib/hooks/use-project-pipeline";
import { useWeather } from "@/lib/hooks/use-weather";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import type { WeatherForecast } from "@/lib/types/weather";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Inline } from "@/components/ops/projects/workspace/atoms/inline";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { UserAvatar } from "@/components/ops/user-avatar";
import { formatDate } from "@/lib/utils/date";
import { formatCurrency, formatPhoneNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

// `ProjectSidebar` — always-on workspace right rail. 7 sections in fixed
// order (no toggle, no collapsing). NO Quick Actions: every action lives in
// the ModeFooter or the title bar — the sidebar is read-only context.
//
// Sections, top → bottom:
//   1. HEALTH    — progress + tile pair (tasks / overdue), financial pair
//                  (invoiced / outstanding) gated by invoices|estimates view.
//   2. CLIENT    — name + email + tel
//   3. LOCATION  — address + Maps link
//   4. TEAM      — flat avatar stack with task-type role
//   5. DATES     — start · end · duration
//   6. WEATHER   — open-meteo current + 5-day forecast, attribution line
//   7. LINKED    — estimates + invoices count + recent quick-links
//
// Permissions: financial tiles + LINKED ledger rows gate on
// `can("invoices.view") || can("estimates.view")`. The sidebar itself does
// not gate — non-financial sections always render.

interface ProjectSidebarProps {
  projectId: string;
  className?: string;
}

const SIDEBAR_WIDTH = 280;

// ─── HEALTH ────────────────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "rose" | "olive" | "tan" | "text-3";
}) {
  const colorVar =
    tone === "rose"
      ? "var(--rose)"
      : tone === "olive"
        ? "var(--olive)"
        : tone === "tan"
          ? "var(--tan)"
          : tone === "text-3"
            ? "var(--text-3)"
            : "var(--text)";
  return (
    <div className="flex flex-col gap-0.5 rounded border border-glass-border bg-[rgba(255,255,255,0.02)] px-2 py-1.5">
      <Mono color="mute" size={9}>
        {label}
      </Mono>
      <span
        className="font-mono text-[14px] leading-[1.1] tabular-nums"
        style={{ color: colorVar, fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {value}
      </span>
    </div>
  );
}

function HealthSection({ projectId }: { projectId: string }) {
  const tasks = useProjectTasksGrouped(projectId);
  const pipeline = useProjectPipeline(projectId);
  const can = usePermissionStore((s) => s.can);
  const canViewFinancials = can("invoices.view") || can("estimates.view");

  const totals = tasks.data?.totals ?? { done: 0, total: 0 };
  const progressPct =
    totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
  const overdueCount = (tasks.data?.upcoming ?? []).filter((t) => {
    if (!t.endDate) return false;
    const today = new Date();
    const end = new Date(t.endDate);
    return end < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }).length;

  return (
    <Section title="HEALTH">
      <Stack gap={1.5} className="pt-1">
        <div>
          <Inline justify="between" className="pb-1">
            <Mono color="text-3" size={10}>{`${progressPct}%`}</Mono>
            <Mono color="mute" size={9}>{`${totals.done}/${totals.total}`}</Mono>
          </Inline>
          <div className="h-1.5 overflow-hidden rounded-bar bg-[rgba(255,255,255,0.06)]">
            <div
              data-testid="health-progress"
              className="h-full bg-text-2 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <MetricTile label="TASKS" value={`${totals.done}/${totals.total}`} />
          <MetricTile
            label="OVERDUE"
            value={String(overdueCount)}
            tone={overdueCount > 0 ? "rose" : "text-3"}
          />
          {canViewFinancials && (
            <>
              <MetricTile
                label="INVOICED"
                value={
                  pipeline.data && pipeline.data.invoiced.total > 0
                    ? formatCurrency(pipeline.data.invoiced.total)
                    : "—"
                }
                tone="tan"
              />
              <MetricTile
                label="OUTSTANDING"
                value={
                  pipeline.data && pipeline.data.outstanding.total > 0
                    ? formatCurrency(pipeline.data.outstanding.total)
                    : "—"
                }
                tone={
                  pipeline.data &&
                  pipeline.data.outstanding.daysAged != null &&
                  pipeline.data.outstanding.daysAged > 30
                    ? "rose"
                    : "text-3"
                }
              />
            </>
          )}
        </div>
      </Stack>
    </Section>
  );
}

// ─── CLIENT ────────────────────────────────────────────────────────────────────

function ClientSection({ clientId }: { clientId: string | null }) {
  const { data: client } = useClient(clientId ?? undefined);
  return (
    <Section title="CLIENT">
      {!client ? (
        <Body size={14} color="text-3" className="pt-1">
          Unassigned.
        </Body>
      ) : (
        <Stack gap={1} className="pt-1">
          <Body size={14} color="text">
            {client.name}
          </Body>
          {client.email && (
            <a
              href={`mailto:${client.email}`}
              className="inline-flex items-center gap-1.5 text-[12px] text-text-2 transition-colors hover:text-ops-accent"
            >
              <Mail className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              <span className="truncate">{client.email}</span>
            </a>
          )}
          {client.phoneNumber && (
            <a
              href={`tel:${client.phoneNumber}`}
              className="inline-flex items-center gap-1.5 text-[12px] text-text-2 transition-colors hover:text-ops-accent"
            >
              <Phone className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              <span>{formatPhoneNumber(client.phoneNumber)}</span>
            </a>
          )}
        </Stack>
      )}
    </Section>
  );
}

// ─── LOCATION ──────────────────────────────────────────────────────────────────

function LocationSection({
  address,
  latitude,
  longitude,
}: {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}) {
  const mapsHref = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
  return (
    <Section title="LOCATION">
      {!address ? (
        <Body size={14} color="text-3" className="pt-1">
          No address.
        </Body>
      ) : (
        <Stack gap={1} className="pt-1">
          <Body size={14} color="text-2" className="break-words">
            {address}
          </Body>
          <Inline gap={2}>
            {mapsHref && (
              <a
                href={mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-ops-accent hover:underline"
              >
                <MapPin className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                MAPS
              </a>
            )}
            {latitude != null && longitude != null && (
              <Mono color="mute" size={9}>{`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}</Mono>
            )}
          </Inline>
        </Stack>
      )}
    </Section>
  );
}

// ─── TEAM ──────────────────────────────────────────────────────────────────────

function TeamSection({ projectId }: { projectId: string }) {
  const { members } = useProjectTeam(projectId);
  return (
    <Section
      title="TEAM"
      rightSlot={<Mono color="text-3" size={9}>{`${members.length}`}</Mono>}
    >
      {members.length === 0 ? (
        <Body size={14} color="text-3" className="py-2">
          None.
        </Body>
      ) : (
        <Stack gap={1.5} className="pt-1">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <UserAvatar name={m.name} imageUrl={m.profileImageURL} size="sm" />
              <div className="min-w-0 flex-1">
                <Body size={12} color="text" className="truncate block">
                  {m.name}
                </Body>
                {m.taskTypeNames.length > 0 && (
                  <Mono color="text-3" size={9} className="block">
                    {m.taskTypeNames.join(" · ")}
                  </Mono>
                )}
              </div>
            </div>
          ))}
        </Stack>
      )}
    </Section>
  );
}

// ─── DATES ─────────────────────────────────────────────────────────────────────

function DatesSection({
  startDate,
  endDate,
  status,
}: {
  startDate: Date | null;
  endDate: Date | null;
  status: ProjectStatus;
}) {
  const duration = (() => {
    if (!startDate || !endDate) return null;
    const ms = endDate.getTime() - startDate.getTime();
    return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  })();
  return (
    <Section title="DATES">
      <Stack gap={1} className="pt-1">
        <Inline justify="between">
          <Mono color="mute" size={9}>START</Mono>
          <Body size={12} color="text-2">
            {startDate ? formatDate(startDate, "MMM d, yyyy") : "—"}
          </Body>
        </Inline>
        <Inline justify="between">
          <Mono color="mute" size={9}>END</Mono>
          <Body size={12} color="text-2">
            {endDate ? formatDate(endDate, "MMM d, yyyy") : "—"}
          </Body>
        </Inline>
        <Inline justify="between">
          <Mono color="mute" size={9}>DURATION</Mono>
          <Mono
            color="text-3"
            size={10}
            caseSensitive
            style={{
              color: PROJECT_STATUS_COLORS[status],
              fontFeatureSettings: '"tnum" 1, "zero" 1',
            }}
          >
            {duration != null ? `${duration}D` : "—"}
          </Mono>
        </Inline>
      </Stack>
    </Section>
  );
}

// ─── WEATHER ───────────────────────────────────────────────────────────────────

function weatherIcon(conditions: string | null) {
  const c = (conditions ?? "").toLowerCase();
  const cls = "h-3.5 w-3.5";
  if (c.includes("snow")) return <Snowflake className={cls} strokeWidth={1.5} aria-hidden="true" />;
  if (c.includes("rain") || c.includes("drizzle"))
    return <CloudRain className={cls} strokeWidth={1.5} aria-hidden="true" />;
  if (c.includes("cloud") || c.includes("overcast"))
    return <Cloud className={cls} strokeWidth={1.5} aria-hidden="true" />;
  if (c.includes("clear") || c.includes("sun"))
    return <Sun className={cls} strokeWidth={1.5} aria-hidden="true" />;
  return <CloudSun className={cls} strokeWidth={1.5} aria-hidden="true" />;
}

function tempLabel(c: number | null): string {
  if (c == null) return "—";
  return `${Math.round(c)}°`;
}

function WeatherRow({ forecast }: { forecast: WeatherForecast }) {
  return (
    <Inline gap={1.5} justify="between" className="py-0.5">
      <Inline gap={1}>
        <span style={{ color: "var(--text-3)" }}>
          {weatherIcon(forecast.conditions)}
        </span>
        <Mono color="text-3" size={9}>
          {formatDate(forecast.forecastDate, "EEE").toUpperCase()}
        </Mono>
      </Inline>
      <Mono
        color="text-2"
        size={10}
        caseSensitive
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {`${tempLabel(forecast.tempHighC)} / ${tempLabel(forecast.tempLowC)}`}
      </Mono>
    </Inline>
  );
}

function WeatherSection({ projectId, hasCoords }: { projectId: string; hasCoords: boolean }) {
  const { data, isLoading } = useWeather(hasCoords ? projectId : null);
  if (!hasCoords) {
    return (
      <Section title="WEATHER">
        <Body size={12} color="text-3" className="pt-1">
          No coordinates.
        </Body>
      </Section>
    );
  }
  return (
    <Section title="WEATHER">
      {isLoading ? (
        <Body size={12} color="text-3" className="py-2">
          Loading…
        </Body>
      ) : !data?.current ? (
        <Body size={12} color="text-3" className="py-2">
          Unavailable.
        </Body>
      ) : (
        <Stack gap={1} className="pt-1">
          <Inline gap={2} justify="between">
            <Inline gap={1}>
              <span style={{ color: "var(--text-2)" }}>{weatherIcon(data.current.conditions)}</span>
              <Body size={12} color="text-2">
                {data.current.conditions ?? "—"}
              </Body>
            </Inline>
            <span
              className="font-mono text-[18px] leading-[1] tabular-nums"
              style={{ color: "var(--text)", fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {tempLabel(data.current.tempCurrentC)}
            </span>
          </Inline>
          <div className="divide-y divide-glass-border">
            {data.forecast.slice(0, 5).map((f) => (
              <WeatherRow key={f.id} forecast={f} />
            ))}
          </div>
          <Mono color="mute" size={9} caseSensitive className="block pt-1">
            {data.attribution}
          </Mono>
        </Stack>
      )}
    </Section>
  );
}

// ─── LINKED ────────────────────────────────────────────────────────────────────

function LinkedSection({ projectId }: { projectId: string }) {
  const can = usePermissionStore((s) => s.can);
  const canViewFinancials = can("invoices.view") || can("estimates.view");
  const ledger = useProjectLedger(canViewFinancials ? projectId : null);

  if (!canViewFinancials) {
    return (
      <Section title="LINKED">
        <Body size={12} color="text-3" className="pt-1">
          Restricted.
        </Body>
      </Section>
    );
  }

  const rows = ledger.data ?? [];
  const estimates = rows.filter((r) => r.source === "estimate");
  const invoices = rows.filter((r) => r.source === "invoice" || r.source === "change_order");
  const top = [...estimates.slice(0, 2), ...invoices.slice(0, 3)];

  return (
    <Section
      title="LINKED"
      rightSlot={
        <Mono color="text-3" size={9}>{`${estimates.length}E · ${invoices.length}I`}</Mono>
      }
    >
      {top.length === 0 ? (
        <Body size={12} color="text-3" className="py-2">
          None.
        </Body>
      ) : (
        <Stack gap={1} className="pt-1">
          {top.map((r) => (
            <Inline
              key={`${r.source}-${r.recordId}`}
              gap={1.5}
              justify="between"
              className="py-0.5"
            >
              <Inline gap={1} className="min-w-0">
                <span style={{ color: "var(--text-3)" }}>
                  <Link2 className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <Mono color="text-3" size={9} className="truncate">
                  {r.recordId}
                </Mono>
              </Inline>
              <Mono
                color="text-2"
                size={10}
                caseSensitive
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {formatCurrency(Math.abs(r.amount))}
              </Mono>
            </Inline>
          ))}
        </Stack>
      )}
    </Section>
  );
}

// ─── Composer ──────────────────────────────────────────────────────────────────

export function ProjectSidebar({ projectId, className }: ProjectSidebarProps) {
  const { data: project } = useProject(projectId);
  const hasCoords = !!project?.latitude && !!project?.longitude;
  return (
    <aside
      data-testid="project-sidebar"
      className={cn("flex flex-col gap-4 px-3 py-3", className)}
      style={{ width: SIDEBAR_WIDTH }}
    >
      <HealthSection projectId={projectId} />
      <ClientSection clientId={project?.clientId ?? null} />
      <LocationSection
        address={project?.address ?? null}
        latitude={project?.latitude ?? null}
        longitude={project?.longitude ?? null}
      />
      <TeamSection projectId={projectId} />
      <DatesSection
        startDate={project?.startDate ?? null}
        endDate={project?.endDate ?? null}
        status={project?.status ?? ProjectStatus.RFQ}
      />
      <WeatherSection projectId={projectId} hasCoords={hasCoords} />
      <LinkedSection projectId={projectId} />
    </aside>
  );
}
