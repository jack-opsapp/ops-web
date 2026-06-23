"use client";

import { useMemo, useState } from "react";
import type {
  SpecCommunicationChannel,
  SpecTimelineEvent,
  SpecTimelineEventKind,
  SpecTimelineFilter,
} from "@/lib/admin/spec-types";
import { SPEC_MILESTONE_LABELS } from "@/lib/admin/spec-types";
import { formatCents, formatDateTime, formatRelative, statusLabel, truncateHash } from "./format";

interface TimelineTabProps {
  events: SpecTimelineEvent[];
}

const FILTERS: Array<{ key: SpecTimelineFilter; label: string }> = [
  { key: "all", label: "ALL" },
  { key: "comms", label: "COMMS" },
  { key: "money", label: "MONEY" },
  { key: "status", label: "STATUS" },
  { key: "tickets", label: "TICKETS" },
  { key: "acceptance", label: "ACCEPTANCE" },
];

function kindMatchesFilter(kind: SpecTimelineEventKind, filter: SpecTimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "comms") return kind === "communication";
  if (filter === "money") return kind === "payment" || kind === "change_order";
  if (filter === "status") return kind === "status_change" || kind === "scope_document";
  if (filter === "tickets") return kind === "support_ticket";
  if (filter === "acceptance") return kind === "acceptance" || kind === "satisfaction_rating";
  return true;
}

const KIND_LABEL: Record<SpecTimelineEventKind, string> = {
  status_change: "STATUS",
  acceptance: "ACCEPTANCE",
  communication: "COMMS",
  payment: "MONEY",
  change_order: "MONEY",
  scope_document: "SCOPE",
  satisfaction_rating: "RATING",
  support_ticket: "TICKET",
  system: "SYS",
};

const KIND_TONE: Record<SpecTimelineEventKind, string> = {
  status_change: "text-[#8A8A8A]",
  acceptance: "text-[#6F94B0]",
  communication: "text-[#B5B5B5]",
  payment: "text-[#C4A868]",
  change_order: "text-[#C4A868]",
  scope_document: "text-[#9DB582]",
  satisfaction_rating: "text-[#9DB582]",
  support_ticket: "text-[#B58289]",
  system: "text-[#6A6A6A]",
};

const CHANNEL_LABEL: Record<SpecCommunicationChannel, string> = {
  email: "EMAIL",
  admin_note: "NOTE",
  call_log: "CALL",
  video_message: "VIDEO",
  system: "SYS",
};

export function TimelineTab({ events }: TimelineTabProps) {
  const [filter, setFilter] = useState<SpecTimelineFilter>("all");
  const [query, setQuery] = useState("");

  // Newest first for display — events arrive ascending from the data layer.
  const ordered = useMemo(() => [...events].reverse(), [events]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((e) => {
      if (!kindMatchesFilter(e.kind, filter)) return false;
      if (!q) return true;
      const haystack = [e.summary, e.detail, e.actorLabel, e.meta?.featureName, e.meta?.payloadHash]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [ordered, filter, query]);

  return (
    <section
      aria-label="Project timeline"
      className="rounded-panel border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            TIMELINE
          </h2>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            {filtered.length} OF {events.length} EVENTS · NEWEST FIRST
            <span className="text-[#3A3A3A]">]</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const isActive = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={isActive}
                className={[
                  "rounded-chip border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  isActive
                    ? "border-[#6F94B0] bg-[#6F94B0] text-black"
                    : "border-white/[0.10] text-[#8A8A8A] hover:text-[#EDEDED]",
                ].join(" ")}
              >
                {f.label}
              </button>
            );
          })}
          <label className="flex items-center gap-2">
            <span className="sr-only">Search timeline</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="// SEARCH"
              className="w-44 rounded border border-white/[0.10] bg-black px-3 py-1 font-mono text-[11px] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0] placeholder:text-[#6A6A6A]"
            />
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="font-mono text-[12px] text-[#6A6A6A]">— nothing matches</p>
      ) : (
        <ol className="space-y-0 divide-y divide-white/[0.06]">
          {filtered.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}

function EventRow({ event }: { event: SpecTimelineEvent }) {
  const pathBTag =
    event.meta?.isPathBAcceptancePair && event.meta?.eventType === "owner_purchase_approved"
      ? "PATH B · OWNER"
      : event.meta?.isPathBAcceptancePair && event.meta?.eventType === "tos_accepted"
        ? "PATH B · BUYER"
        : null;

  return (
    <li className="grid grid-cols-[100px,1fr] gap-4 py-3">
      <div className="flex flex-col gap-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
        <span className={`tabular-nums ${KIND_TONE[event.kind]}`}>{KIND_LABEL[event.kind]}</span>
        <span className="tabular-nums text-[#8A8A8A]">{formatDateTime(event.occurredAt)}</span>
        <span className="tabular-nums text-[#6A6A6A]">{formatRelative(event.occurredAt)}</span>
      </div>

      <div className="min-w-0">
        <p className="text-[13px] leading-snug text-[#EDEDED]">
          {event.actorLabel && (
            <span className="mr-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6A6A6A]">
              {event.actorLabel} ·
            </span>
          )}
          {event.summary}
        </p>

        {event.detail && (
          <p className="mt-1 text-[12px] leading-relaxed text-[#B5B5B5]">{event.detail}</p>
        )}

        {/* Per-kind meta pills */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
          {pathBTag && (
            <span className="rounded-[3px] border border-[#6F94B0]/40 px-1.5 py-px text-[#6F94B0]">
              {pathBTag}
            </span>
          )}
          {event.meta?.signatureMethod && (
            <span className="rounded-[3px] border border-white/[0.10] px-1.5 py-px text-[#8A8A8A]">
              SIG · {event.meta.signatureMethod.toUpperCase()}
            </span>
          )}
          {event.meta?.payloadHash && (
            <span
              className="rounded-[3px] border border-white/[0.10] px-1.5 py-px text-[#6A6A6A]"
              title={event.meta.payloadHash}
            >
              HASH · {truncateHash(event.meta.payloadHash, 8)}
            </span>
          )}
          {event.meta?.milestone && (
            <span className="rounded-[3px] border border-[#C4A868]/30 px-1.5 py-px text-[#C4A868]">
              {SPEC_MILESTONE_LABELS[event.meta.milestone]}
            </span>
          )}
          {event.meta?.paymentStatus && (
            <span className="rounded-[3px] border border-white/[0.10] px-1.5 py-px text-[#8A8A8A]">
              {statusLabel(event.meta.paymentStatus)}
            </span>
          )}
          {event.meta?.amountCents != null && (
            <span className="rounded-[3px] border border-white/[0.10] px-1.5 py-px tabular-nums text-[#EDEDED]">
              {formatCents(event.meta.amountCents)}
            </span>
          )}
          {event.meta?.channel && (
            <span className="rounded-[3px] border border-white/[0.10] px-1.5 py-px text-[#8A8A8A]">
              {CHANNEL_LABEL[event.meta.channel]}
            </span>
          )}
          {event.meta?.direction && (
            <span className="rounded-[3px] border border-white/[0.10] px-1.5 py-px text-[#6A6A6A]">
              {event.meta.direction === "outbound" ? "OUT" : "IN"}
            </span>
          )}
          {event.meta?.changeOrderStatus && (
            <span className="rounded-[3px] border border-white/[0.10] px-1.5 py-px text-[#8A8A8A]">
              CO · {statusLabel(event.meta.changeOrderStatus)}
            </span>
          )}
          {event.meta?.scopeDocVersion != null && (
            <span className="rounded-[3px] border border-[#9DB582]/30 px-1.5 py-px text-[#9DB582]">
              SCOPE V{event.meta.scopeDocVersion}
            </span>
          )}
          {event.meta?.rating != null && (
            <span className="rounded-[3px] border border-white/[0.10] px-1.5 py-px tabular-nums text-[#EDEDED]">
              {event.meta.rating}/5
            </span>
          )}
          {event.meta?.ticketSeverity && (
            <span className="rounded-[3px] border border-[#B58289]/30 px-1.5 py-px text-[#B58289]">
              {statusLabel(event.meta.ticketSeverity)}
            </span>
          )}
          {event.meta?.ticketStatus && (
            <span className="rounded-[3px] border border-white/[0.10] px-1.5 py-px text-[#8A8A8A]">
              {statusLabel(event.meta.ticketStatus)}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
