"use client";

import { useState } from "react";
import { createTicket } from "@/app/admin/spec/[id]/_actions/create-ticket";
import { escalateTicket } from "@/app/admin/spec/[id]/_actions/escalate-ticket";
import type {
  SpecSupportTicketRow,
  SpecTicketPhase,
  SpecTicketSeverity,
  SpecTicketStatus,
  SpecTicketsTab,
} from "@/lib/admin/spec-types";
import { formatDate, statusLabel } from "./format";

interface TicketsTabProps {
  data: SpecTicketsTab;
  projectId: string;
}

const SEVERITY_TONE: Record<SpecTicketSeverity, string> = {
  critical: "text-[#B58289] border-[#93321A]/60",
  high: "text-[#C4A868] border-[#C4A868]/40",
  cosmetic_enhancement: "text-[#8A8A8A] border-white/[0.10]",
};

const STATUS_TONE: Record<SpecTicketStatus, string> = {
  open: "text-[#C4A868] border-[#C4A868]/40",
  in_progress: "text-[#6F94B0] border-[#6F94B0]/40",
  resolved: "text-[#9DB582] border-[#9DB582]/40",
  escalated_to_change_order: "text-[#6F94B0] border-[#6F94B0]/40",
};

const PHASE_LABEL: Record<SpecTicketPhase, string> = {
  support: "SUPPORT",
  retainer: "RETAINER",
  ad_hoc: "AD HOC",
};

const SEVERITY_LABEL: Record<SpecTicketSeverity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  cosmetic_enhancement: "COSMETIC",
};

export function TicketsTab({ data, projectId }: TicketsTabProps) {
  const [wizardOpen, setWizardOpen] = useState(false);

  const counts = {
    open: data.rows.filter((r) => r.status === "open").length,
    inProgress: data.rows.filter((r) => r.status === "in_progress").length,
    resolved: data.rows.filter((r) => r.status === "resolved").length,
    escalated: data.rows.filter((r) => r.status === "escalated_to_change_order").length,
  };

  return (
    <div className="space-y-6">
      <section
        aria-label="Tickets summary"
        className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            SUPPORT TICKETS
          </h2>
          <button
            type="button"
            onClick={() => setWizardOpen((v) => !v)}
            className="rounded-[5px] border border-[#6F94B0] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
          >
            {wizardOpen ? "CLOSE" : "NEW TICKET"}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Kpi label="OPEN" value={counts.open} tone={counts.open > 0 ? "text-[#C4A868]" : "text-[#EDEDED]"} />
          <Kpi label="IN PROGRESS" value={counts.inProgress} />
          <Kpi label="RESOLVED" value={counts.resolved} tone="text-[#9DB582]" />
          <Kpi label="ESCALATED" value={counts.escalated} />
        </div>

        {wizardOpen && <NewTicketForm projectId={projectId} onCancel={() => setWizardOpen(false)} />}
      </section>

      {data.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {data.rows.map((row) => (
            <TicketCard key={row.id} ticket={row} projectId={projectId} />
          ))}
        </div>
      )}

      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
        <span className="text-[#3A3A3A]">[</span>
        CRITICAL / HIGH IN-SCOPE FREE · COSMETIC + ENHANCEMENT BILLABLE VIA CHANGE ORDER · CUSTOMER FILING UI SHIPS PHASE 2
        <span className="text-[#3A3A3A]">]</span>
      </p>
    </div>
  );
}

function TicketCard({ ticket, projectId }: { ticket: SpecSupportTicketRow; projectId: string }) {
  const [actionOpen, setActionOpen] = useState<"reclassify" | "escalate" | null>(null);
  const isClosed = ticket.status === "resolved" || ticket.status === "escalated_to_change_order";

  return (
    <article
      aria-label={`Ticket: ${ticket.title}`}
      className="rounded-[10px] border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-mohave text-[16px] text-[#EDEDED]">{ticket.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Pill className={SEVERITY_TONE[ticket.severity]}>{SEVERITY_LABEL[ticket.severity]}</Pill>
            <Pill className={STATUS_TONE[ticket.status]}>{statusLabel(ticket.status)}</Pill>
            <Pill className="text-[#8A8A8A] border-white/[0.10]">{PHASE_LABEL[ticket.phase]}</Pill>
            {ticket.customerClassification && ticket.customerClassification !== ticket.severity && (
              <span
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]"
                title="Original severity claimed by customer"
              >
                <span className="text-[#3A3A3A]">[</span>
                CUSTOMER FILED · {ticket.customerClassification.toUpperCase()}
                <span className="text-[#3A3A3A]">]</span>
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">OPENED</p>
          <p className="font-mono text-[11px] tabular-nums text-[#B5B5B5]">{formatDate(ticket.openedAt)}</p>
          {ticket.resolvedAt && (
            <>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">CLOSED</p>
              <p className="font-mono text-[11px] tabular-nums text-[#9DB582]">{formatDate(ticket.resolvedAt)}</p>
            </>
          )}
        </div>
      </header>

      {ticket.description && (
        <p className="mt-4 whitespace-pre-wrap text-[13px] text-[#B5B5B5]">{ticket.description}</p>
      )}

      {!isClosed && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-4">
          <button
            type="button"
            onClick={() => setActionOpen(actionOpen === "reclassify" ? null : "reclassify")}
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-[#EDEDED]"
          >
            RECLASSIFY SEVERITY
          </button>
          <span className="text-[#3A3A3A]">·</span>
          <button
            type="button"
            onClick={() => setActionOpen(actionOpen === "escalate" ? null : "escalate")}
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-[#EDEDED]"
          >
            ESCALATE TO CHANGE ORDER
          </button>
        </div>
      )}

      {actionOpen === "reclassify" && (
        <ReclassifyForm
          projectId={projectId}
          ticketId={ticket.id}
          currentSeverity={ticket.severity}
          onCancel={() => setActionOpen(null)}
        />
      )}
      {actionOpen === "escalate" && (
        <EscalateForm
          projectId={projectId}
          ticketId={ticket.id}
          onCancel={() => setActionOpen(null)}
        />
      )}

      {ticket.linkedChangeOrderId && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            LINKED CHANGE ORDER · {ticket.linkedChangeOrderId.slice(0, 8)}
            <span className="text-[#3A3A3A]">]</span>
          </p>
        </div>
      )}
    </article>
  );
}

function ReclassifyForm({
  projectId,
  ticketId,
  currentSeverity,
  onCancel,
}: {
  projectId: string;
  ticketId: string;
  currentSeverity: SpecTicketSeverity;
  onCancel: () => void;
}) {
  const options: SpecTicketSeverity[] = ["critical", "high", "cosmetic_enhancement"];
  return (
    <form
      action={escalateTicket}
      className="mt-4 flex flex-wrap items-end gap-3 rounded-[5px] border border-white/[0.10] bg-black/40 p-3"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="op" value="reclassify" />
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>
          NEW SEVERITY
          <span className="text-[#3A3A3A]">]</span>
        </span>
        <select
          name="new_severity"
          defaultValue={currentSeverity}
          className="rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-[5px] border border-[#6F94B0] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
      >
        RECLASSIFY
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED]"
      >
        CANCEL
      </button>
    </form>
  );
}

function EscalateForm({
  projectId,
  ticketId,
  onCancel,
}: {
  projectId: string;
  ticketId: string;
  onCancel: () => void;
}) {
  return (
    <form
      action={escalateTicket}
      className="mt-4 flex flex-wrap items-center gap-3 rounded-[5px] border border-[#C4A868]/30 bg-black/40 p-3"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="op" value="escalate_to_change_order" />
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#C4A868]">
        <span className="text-[#3A3A3A]">[</span>
        CONFIRM · CREATES PROPOSED CHANGE ORDER · CLOSES TICKET
        <span className="text-[#3A3A3A]">]</span>
      </span>
      <button
        type="submit"
        className="rounded-[5px] border border-[#C4A868] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#C4A868] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#C4A868] hover:text-black"
      >
        ESCALATE
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED]"
      >
        CANCEL
      </button>
    </form>
  );
}

function NewTicketForm({ projectId, onCancel }: { projectId: string; onCancel: () => void }) {
  return (
    <form
      action={createTicket}
      className="mt-5 space-y-4 rounded-[10px] border border-white/[0.10] bg-black/40 p-4"
    >
      <input type="hidden" name="project_id" value={projectId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldRow label="SEVERITY">
          <select
            name="severity"
            defaultValue="high"
            required
            className="w-full rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
          >
            <option value="critical">CRITICAL · blocks daily ops</option>
            <option value="high">HIGH · degrades workflow</option>
            <option value="cosmetic_enhancement">COSMETIC / ENHANCEMENT</option>
          </select>
        </FieldRow>

        <FieldRow label="PHASE">
          <select
            name="phase"
            defaultValue="support"
            required
            className="w-full rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
          >
            <option value="support">SUPPORT · in support window</option>
            <option value="retainer">RETAINER · subscribed</option>
            <option value="ad_hoc">AD HOC · billable</option>
          </select>
        </FieldRow>
      </div>

      <FieldRow label="TITLE">
        <input
          type="text"
          name="title"
          required
          maxLength={200}
          placeholder="One-line summary"
          className="w-full rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        />
      </FieldRow>

      <FieldRow label="DESCRIPTION">
        <textarea
          name="description"
          required
          rows={4}
          placeholder="What happened, repro steps, expected vs actual"
          className="w-full rounded-[5px] border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        />
      </FieldRow>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded-[5px] border border-[#6F94B0] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
        >
          OPEN TICKET
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED]"
        >
          CANCEL
        </button>
      </div>
    </form>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`rounded-[4px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em] ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">
        <span className="text-[#3A3A3A]">[</span>
        {label}
        <span className="text-[#3A3A3A]">]</span>
      </span>
      {children}
    </label>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-[rgba(18,18,20,0.40)] p-8 text-center backdrop-blur-[28px]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        — no tickets filed
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
        log on the customer&apos;s behalf with new ticket above.
      </p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">{label}</p>
      <p className={`mt-1 font-mono text-[16px] tabular-nums leading-none ${tone ?? "text-[#EDEDED]"}`}>
        {value}
      </p>
    </div>
  );
}
