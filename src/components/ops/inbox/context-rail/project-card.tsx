"use client";

import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { StatusPip, type ProjectStatus } from "./status-pip";
import { AccountingBar } from "./accounting-bar";

export interface ProjectTask {
  id: string;
  label: string;
  done: boolean;
}

export interface ProjectInvoice {
  id: string;
  number: string;
  amount: number;
  status: "paid" | "outstanding" | "overdue";
}

export interface ProjectEstimate {
  id: string;
  number: string;
  amount: number;
  status: "pending" | "accepted" | "rejected";
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
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
};

export function ProjectCard({
  project,
  threadId,
  defaultOpen = false,
}: ProjectCardProps) {
  const { t } = useDictionary("inbox");
  const [open, setOpen] = useState(defaultOpen);
  const done = project.tasks.filter((task) => task.done).length;
  const total = project.tasks.length;

  return (
    <article
      className={cn(
        "rounded-lg border border-line bg-inbox-panel transition-colors",
        open ? "" : "hover:bg-inbox-elev",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-text-3" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-text-3" strokeWidth={1.75} />
        )}
        <span className="min-w-0 flex-1 truncate font-mohave text-[12.5px] tracking-[-0.003em] text-text">
          {project.title}
        </span>
        <StatusPip status={project.status} />
        <span
          className="font-mono text-[11px] tabular-nums text-text-2"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {formatCurrency(project.value)}
        </span>
        <span
          className="font-mono text-[9.5px] tabular-nums text-text-mute"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {done}/{total}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <p
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-3"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {project.stage} · {formatDate(project.startDate)} → {formatDate(project.endDate)} · {project.leadName}
          </p>

          <Section label={t("project.scope", "// SCOPE")}>
            <ul className="flex flex-col gap-1">
              {project.tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-2 font-mohave text-[12px] text-text-2"
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full border",
                      task.done
                        ? "border-olive bg-olive"
                        : "border-text-mute bg-transparent",
                    )}
                  />
                  <span className={task.done ? "line-through text-text-3" : ""}>
                    {task.label}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section label={t("project.accounting", "// ACCOUNTING")}>
            <AccountingBar
              total={project.accounting.total}
              invoiced={project.accounting.invoiced}
              paid={project.accounting.paid}
            />
            <ul className="mt-2 flex flex-col gap-1">
              {project.estimates.map((e) => (
                <LineRow
                  key={e.id}
                  label={e.number}
                  meta={e.status}
                  amount={formatCurrency(e.amount)}
                />
              ))}
              {project.invoices.map((i) => (
                <LineRow
                  key={i.id}
                  label={i.number}
                  meta={i.status}
                  amount={formatCurrency(i.amount)}
                />
              ))}
            </ul>
          </Section>

          <a
            href={`?project=${project.id}&thread=${threadId}`}
            className="inline-flex items-center gap-1.5 rounded-chip border border-line px-2.5 py-1.5 font-cakemono text-[10px] font-light uppercase tracking-[0.14em] text-text-2 hover:bg-inbox-elev hover:text-text"
          >
            <ExternalLink aria-hidden className="h-3 w-3" strokeWidth={1.75} />
            {t("project.openProject", "Open project")}
          </a>
        </div>
      )}
    </article>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="font-cakemono text-[9.5px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
        {label}
      </h4>
      {children}
    </div>
  );
}

function LineRow({
  label,
  meta,
  amount,
}: {
  label: string;
  meta: string;
  amount: string;
}) {
  return (
    <li className="flex items-center gap-2 font-mono text-[10.5px] text-text-2">
      <span className="font-mono">{label}</span>
      <span
        className="text-text-mute uppercase tracking-[0.18em]"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {meta}
      </span>
      <span
        className="ml-auto tabular-nums"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {amount}
      </span>
    </li>
  );
}
