"use client";

/**
 * ProjectCard — faithful to `reference/v4-context-tabs.jsx :: ProjectCard`.
 *
 * Collapsed:
 *   ▸ {title}
 *     ● {status}    ${value}                  {done}/{total}
 *
 * Expanded:
 *   { Stage · {stage}    Dates · {start}–{end}    Lead · {foreman} }
 *
 *   Scope
 *   ☐ task one
 *   ☑ task two       (done — line-through, olive fill)
 *   ☐ task three  now (active — accent border + "now" badge)
 *
 *   Accounting
 *   {paid} paid · {due} due                              of {total}
 *   [olive paid][warn invoiced────][bgDeep remainder]   ← 4px stack bar
 *
 *   EST-118  Roof estimate                $24,500   accepted
 *   INV-091  May progress invoice          $9,800   paid
 *
 *   [⤴︎ Open project]
 */

import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Receipt,
} from "lucide-react";
import { useState } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { StatusPip, type ProjectStatus } from "./status-pip";
import { AccountingBar } from "./accounting-bar";

export interface ProjectTask {
  id: string;
  label: string;
  status: "done" | "active" | "todo";
}

export interface ProjectInvoice {
  id: string;
  number: string;
  label: string;
  amount: number;
  status: "paid" | "scheduled" | "overdue";
  issuedAt?: string | null;
}

export interface ProjectEstimate {
  id: string;
  number: string;
  label: string;
  amount: number;
  status: "accepted" | "sent" | "draft";
  issuedAt?: string | null;
}

export interface ProjectCardData {
  id: string;
  title: string;
  value: number;
  status: ProjectStatus;
  stage: string;
  startDate: string;
  endDate: string;
  leadName: string;
  tasks: ProjectTask[];
  accounting: { total: number; invoiced: number; paid: number };
  invoices: ProjectInvoice[];
  estimates: ProjectEstimate[];
}

interface ProjectCardProps {
  project: ProjectCardData;
  threadId: string;
  defaultOpen?: boolean;
}

const formatCurrency = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

const dashOrEmpty = (s: string | null | undefined) =>
  !s || s.trim() === "" || s === "—" ? null : s;

export function ProjectCard({
  project,
  threadId,
  defaultOpen = false,
}: ProjectCardProps) {
  const { t } = useDictionary("inbox");
  const [open, setOpen] = useState(defaultOpen);
  const done = project.tasks.filter((task) => task.status === "done").length;
  const total = project.tasks.length;

  return (
    <article className="overflow-hidden rounded-[5px] border border-line bg-inbox-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-inbox-elev/60"
      >
        <span className="mt-1 shrink-0 text-text-3">
          {open ? (
            <ChevronDown aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          ) : (
            <ChevronRight aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-mohave text-[12px] leading-tight tracking-[-0.003em] text-text">
            {project.title}
          </span>
          <div className="flex items-center gap-2.5">
            <StatusPip status={project.status} label={project.status} />
            <span
              className="font-mono text-[11px] tabular-nums text-text-mute"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {formatCurrency(project.value)}
            </span>
            {total > 0 && (
              <span
                className="ml-auto font-mono text-[11px] tabular-nums text-text-mute"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {done}/{total}
              </span>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-line bg-inbox-bg px-3 pb-3">
          {/* Stage / dates / lead — wrapped chips with muted label prefixes */}
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 pt-2.5 font-mono text-[11px] tracking-[0.18em] text-text-3">
            <Detail label="Stage" value={dashOrEmpty(project.stage)} />
            <DateDetail
              start={dashOrEmpty(project.startDate)}
              end={dashOrEmpty(project.endDate)}
            />
            <Detail label="Lead" value={dashOrEmpty(project.leadName)} />
          </div>

          {/* Scope / tasks */}
          {total > 0 && (
            <Section label={t("project.scope", "Scope")}>
              <ol className="flex flex-col gap-0.5">
                {project.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ol>
            </Section>
          )}

          {/* Accounting */}
          {(project.invoices.length + project.estimates.length > 0 ||
            project.accounting.total > 0) && (
            <Section label={t("project.accounting", "Accounting")}>
              {project.accounting.total > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div
                    className="flex items-baseline justify-between font-mono text-[11px] tracking-[0.18em] text-text-3"
                    style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                  >
                    <span>
                      {formatCurrency(project.accounting.paid)}{" "}
                      {t("project.paid", "paid")} ·{" "}
                      {formatCurrency(
                        Math.max(
                          0,
                          project.accounting.invoiced -
                            project.accounting.paid,
                        ),
                      )}{" "}
                      {t("project.due", "due")}
                    </span>
                    <span className="text-text-mute">
                      {t("project.ofTotal", "of {total}").replace(
                        "{total}",
                        formatCurrency(project.accounting.total),
                      )}
                    </span>
                  </div>
                  <AccountingBar
                    total={project.accounting.total}
                    invoiced={project.accounting.invoiced}
                    paid={project.accounting.paid}
                  />
                </div>
              )}
              {(project.invoices.length > 0 || project.estimates.length > 0) && (
                <ul className="flex flex-col gap-1">
                  {project.invoices.map((i) => (
                    <LedgerRow
                      key={i.id}
                      icon="invoice"
                      number={i.number}
                      label={i.label}
                      amount={formatCurrency(i.amount)}
                      meta={i.status}
                    />
                  ))}
                  {project.estimates.map((e) => (
                    <LedgerRow
                      key={e.id}
                      icon="estimate"
                      number={e.number}
                      label={e.label}
                      amount={formatCurrency(e.amount)}
                      meta={e.status}
                    />
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* Open project */}
          <a
            href={`?project=${project.id}&thread=${threadId}`}
            className="mt-3 inline-flex h-[26px] items-center gap-1.5 rounded-[2.5px] border border-line bg-transparent px-2.5 font-mohave text-[11px] tracking-normal text-text-2 hover:bg-inbox-elev hover:text-text"
          >
            <ExternalLink aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("project.openProject", "Open project")}
          </a>
        </div>
      )}
    </article>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <h4 className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
        {label}
      </h4>
      {children}
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <span>
      <span className="text-text-mute">{label}</span>
      <span className="text-text-mute"> · </span>
      <span className="text-text-3 normal-case">{value}</span>
    </span>
  );
}

function DateDetail({
  start,
  end,
}: {
  start: string | null;
  end: string | null;
}) {
  if (!start && !end) return null;
  const range =
    start && end ? `${start}–${end}` : start ?? end ?? "—";
  return (
    <span>
      <span className="text-text-mute">Dates</span>
      <span className="text-text-mute"> · </span>
      <span className="text-text-3 normal-case">{range}</span>
    </span>
  );
}

function TaskRow({ task }: { task: ProjectTask }) {
  const isDone = task.status === "done";
  const isActive = task.status === "active";
  return (
    <li className="flex items-center gap-2 py-[3px]">
      <span
        aria-hidden
        className={cn(
          "flex h-3 w-3 shrink-0 items-center justify-center rounded-[2px] border-[1.25px]",
          isDone
            ? "border-olive bg-olive"
            : isActive
              ? "border-ops-accent"
              : "border-text-mute",
        )}
      >
        {isDone && (
          <Check
            aria-hidden
            className="h-2 w-2 text-inbox-bg-deep"
            strokeWidth={1.5}
          />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mohave text-[12px]",
          isDone ? "text-text-3 line-through" : "text-text-2",
        )}
      >
        {task.label}
      </span>
      {isActive && (
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.4em] text-ops-accent">
          now
        </span>
      )}
    </li>
  );
}

type LedgerIcon = "invoice" | "estimate";

function LedgerRow({
  icon,
  number,
  label,
  amount,
  meta,
}: {
  icon: LedgerIcon;
  number: string;
  label: string;
  amount: string;
  meta: string;
}) {
  const Icon = icon === "invoice" ? Receipt : FileText;
  const tone = ledgerStatusToneSafe(meta);
  return (
    <li className="flex items-center gap-2 rounded-chip border border-line bg-inbox-panel px-2 py-1.5">
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-text-3"
        strokeWidth={1.5}
      />
      <span
        className="shrink-0 font-mono text-[11px] tracking-[0.18em] text-text-2"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 truncate font-mohave text-[11px] text-text-2">
        {label}
      </span>
      <span
        className="shrink-0 font-mono text-[11px] tabular-nums text-text-2"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {amount}
      </span>
      <StatusPip tone={tone} label={meta} className="shrink-0" />
    </li>
  );
}

/** Soft mapping for free-text meta strings; unknown statuses fall back to muted. */
function ledgerStatusToneSafe(
  meta: string,
): "olive" | "muted" | "rose" | "text-3" {
  const m = meta.toLowerCase();
  if (m.includes("paid") || m.includes("accepted")) return "olive";
  if (m.includes("overdue") || m.includes("expired")) return "rose";
  if (m.includes("draft")) return "text-3";
  return "muted";
}
