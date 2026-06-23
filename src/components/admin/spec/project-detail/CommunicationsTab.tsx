"use client";

import { useMemo, useState } from "react";
import { logCommunication } from "@/app/admin/spec/[id]/_actions/log-communication";
import { sendTemplateEmail } from "@/app/admin/spec/[id]/_actions/send-template-email";
import type {
  SpecCommunicationChannel,
  SpecCommunicationRow,
  SpecCommunicationsTab,
} from "@/lib/admin/spec-types";
import { formatDateTime } from "./format";

interface CommunicationsTabProps {
  data: SpecCommunicationsTab;
  projectId: string;
}

type ChannelFilter = "all" | SpecCommunicationChannel;

const CHANNEL_LABEL: Record<SpecCommunicationChannel, string> = {
  email: "EMAIL",
  admin_note: "NOTE",
  call_log: "CALL",
  video_message: "VIDEO",
  system: "SYSTEM",
};

const CHANNEL_TONE: Record<SpecCommunicationChannel, string> = {
  email: "text-[#6F94B0] border-[#6F94B0]/40",
  admin_note: "text-[#C4A868] border-[#C4A868]/40",
  call_log: "text-[#9DB582] border-[#9DB582]/40",
  video_message: "text-[#9DB582] border-[#9DB582]/40",
  system: "text-[#8A8A8A] border-white/[0.10]",
};

export function CommunicationsTab({ data, projectId }: CommunicationsTabProps) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [composer, setComposer] = useState<"none" | "log" | "email">("none");

  const filtered = useMemo(() => {
    if (channelFilter === "all") return data.rows;
    return data.rows.filter((r) => r.channel === channelFilter);
  }, [data.rows, channelFilter]);

  const counts = useMemo(() => {
    const out: Record<SpecCommunicationChannel, number> = {
      email: 0,
      admin_note: 0,
      call_log: 0,
      video_message: 0,
      system: 0,
    };
    for (const r of data.rows) out[r.channel] = (out[r.channel] ?? 0) + 1;
    return out;
  }, [data.rows]);

  return (
    <div className="space-y-6">
      <section
        aria-label="Communications summary"
        className="rounded-panel border border-white/[0.10] bg-[rgba(18,18,20,0.58)] p-5 backdrop-blur-[28px]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-cakemono text-[14px] font-light uppercase leading-none text-[#EDEDED]">
            <span aria-hidden="true" className="mr-2 font-mono text-[#6A6A6A]">
              {"//"}
            </span>
            COMMUNICATIONS
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setComposer(composer === "log" ? "none" : "log")}
              className="rounded border border-white/[0.10] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-[#EDEDED] hover:text-[#EDEDED]"
            >
              LOG CALL / VIDEO
            </button>
            <button
              type="button"
              onClick={() => setComposer(composer === "email" ? "none" : "email")}
              className="rounded border border-[#6F94B0] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
            >
              SEND TEMPLATE EMAIL
            </button>
          </div>
        </div>

        <FilterChips
          filter={channelFilter}
          onChange={setChannelFilter}
          counts={counts}
          total={data.rows.length}
        />

        {composer === "log" && <LogCommunicationForm projectId={projectId} onCancel={() => setComposer("none")} />}
        {composer === "email" && (
          <SendTemplateForm
            projectId={projectId}
            templates={data.emailTemplates}
            defaultRecipient={data.customerEmail}
            onCancel={() => setComposer("none")}
          />
        )}
      </section>

      {filtered.length === 0 ? (
        <EmptyState filtered={channelFilter !== "all"} />
      ) : (
        <ol className="space-y-2">
          {filtered.map((row) => (
            <CommunicationRow key={row.id} row={row} />
          ))}
        </ol>
      )}
    </div>
  );
}

function CommunicationRow({ row }: { row: SpecCommunicationRow }) {
  return (
    <li className="rounded-panel border border-white/[0.08] bg-[rgba(18,18,20,0.40)] p-4 backdrop-blur-[28px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-chip border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.16em] ${CHANNEL_TONE[row.channel]}`}
            >
              {CHANNEL_LABEL[row.channel]}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
              {row.direction === "outbound" ? "→ OUT" : "← IN"}
            </span>
            {row.loggedByLabel && (
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
                · {row.loggedByLabel}
              </span>
            )}
          </div>
          <p className="mt-2 text-[13px] text-[#EDEDED]">{row.summary}</p>
          {row.body && (
            <p className="mt-1 whitespace-pre-wrap text-[12px] text-[#B5B5B5]">{row.body}</p>
          )}
        </div>
        <span className="font-mono text-[10px] tabular-nums text-[#6A6A6A]">
          {formatDateTime(row.occurredAt)}
        </span>
      </div>
    </li>
  );
}

function LogCommunicationForm({
  projectId,
  onCancel,
}: {
  projectId: string;
  onCancel: () => void;
}) {
  return (
    <form
      action={logCommunication}
      className="mt-5 space-y-4 rounded-panel border border-white/[0.10] bg-black/40 p-4"
    >
      <input type="hidden" name="project_id" value={projectId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldRow label="CHANNEL">
          <select
            name="channel"
            defaultValue="call_log"
            required
            className="w-full rounded border border-white/[0.10] bg-black px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
          >
            <option value="call_log">CALL LOG</option>
            <option value="video_message">VIDEO MESSAGE</option>
            <option value="admin_note">ADMIN NOTE</option>
          </select>
        </FieldRow>

        <FieldRow label="DIRECTION">
          <select
            name="direction"
            defaultValue="outbound"
            required
            className="w-full rounded border border-white/[0.10] bg-black px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
          >
            <option value="outbound">OUTBOUND · we initiated</option>
            <option value="inbound">INBOUND · customer initiated</option>
          </select>
        </FieldRow>
      </div>

      <FieldRow label="SUMMARY">
        <input
          type="text"
          name="summary"
          required
          maxLength={200}
          placeholder="One-line — what was discussed"
          className="w-full rounded border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        />
      </FieldRow>

      <FieldRow label="NOTES">
        <textarea
          name="body"
          rows={3}
          placeholder="Optional details — decisions, follow-ups, next steps"
          className="w-full rounded border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        />
      </FieldRow>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded border border-[#6F94B0] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
        >
          LOG
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

function SendTemplateForm({
  projectId,
  templates,
  defaultRecipient,
  onCancel,
}: {
  projectId: string;
  templates: SpecCommunicationsTab["emailTemplates"];
  defaultRecipient: string;
  onCancel: () => void;
}) {
  const [showOverride, setShowOverride] = useState(false);
  return (
    <form
      action={sendTemplateEmail}
      className="mt-5 space-y-4 rounded-panel border border-[#6F94B0]/30 bg-black/40 p-4"
    >
      <input type="hidden" name="project_id" value={projectId} />

      <FieldRow label="TEMPLATE">
        <select
          name="template_id"
          required
          className="w-full rounded border border-white/[0.10] bg-black px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        >
          {templates.map((t) => (
            <option key={t.templateId} value={t.templateId}>
              {t.label}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="RECIPIENT">
        {!showOverride ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-[12px] tabular-nums text-[#EDEDED]">{defaultRecipient}</span>
            <button
              type="button"
              onClick={() => setShowOverride(true)}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED]"
            >
              [OVERRIDE]
            </button>
          </div>
        ) : (
          <input
            type="email"
            name="recipient_email_override"
            defaultValue={defaultRecipient}
            required
            className="w-full rounded border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] tabular-nums text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
          />
        )}
      </FieldRow>

      <FieldRow label="OPERATOR NOTE">
        <textarea
          name="operator_note"
          rows={3}
          placeholder="Optional — passed to the template renderer as `operator_note`"
          className="w-full rounded border border-white/[0.10] bg-black px-3 py-2 font-mono text-[12px] text-[#EDEDED] outline-none transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:border-[#6F94B0]"
        />
      </FieldRow>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded border border-[#6F94B0] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black"
        >
          QUEUE FOR SEND
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A] hover:text-[#EDEDED]"
        >
          CANCEL
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>
          STAGE H OUTBOX CRON SHIPS WITHIN 5 MIN
          <span className="text-[#3A3A3A]">]</span>
        </span>
      </div>
    </form>
  );
}

function FilterChips({
  filter,
  onChange,
  counts,
  total,
}: {
  filter: ChannelFilter;
  onChange: (v: ChannelFilter) => void;
  counts: Record<SpecCommunicationChannel, number>;
  total: number;
}) {
  const opts: { value: ChannelFilter; label: string; count: number }[] = [
    { value: "all", label: "ALL", count: total },
    { value: "email", label: "EMAIL", count: counts.email },
    { value: "call_log", label: "CALLS", count: counts.call_log },
    { value: "video_message", label: "VIDEO", count: counts.video_message },
    { value: "admin_note", label: "NOTES", count: counts.admin_note },
    { value: "system", label: "SYSTEM", count: counts.system },
  ];
  return (
    <div className="mt-5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Filter by channel">
      {opts.map((o) => {
        const active = filter === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`rounded-chip border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              active ? "border-[#6F94B0] text-[#EDEDED]" : "border-white/[0.10] text-[#8A8A8A] hover:text-[#EDEDED]"
            }`}
          >
            {o.label}
            <span className="ml-1.5 tabular-nums text-[#6A6A6A]">({o.count})</span>
          </button>
        );
      })}
    </div>
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

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-panel border border-white/[0.08] bg-[rgba(18,18,20,0.40)] p-8 text-center backdrop-blur-[28px]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
        {filtered ? "— no entries matching filter" : "— no communications logged yet"}
      </p>
      {!filtered && (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
          system entries appear automatically. log calls / video / template emails above.
        </p>
      )}
    </div>
  );
}

