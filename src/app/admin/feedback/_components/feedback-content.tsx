"use client";

import { useState, useTransition } from "react";
import { SubTabs } from "../../_components/sub-tabs";
import type { FeatureRequest, AppMessage, PromoCode } from "@/lib/admin/types";

const STATUS_OPTIONS = ["new", "reviewing", "planned", "in-progress", "done", "wont-fix"] as const;
const STATUS_COLORS: Record<string, string> = {
  new: "#C4A868",
  reviewing: "#8195B5",
  planned: "#597794",
  "in-progress": "#9DB582",
  done: "#6B8F71",
  "wont-fix": "#6B6B6B",
};

interface FeedbackContentProps {
  featureRequests: FeatureRequest[];
  appMessages: AppMessage[];
  promoCodes: PromoCode[];
}

export function FeedbackContent({ featureRequests, appMessages, promoCodes }: FeedbackContentProps) {
  return (
    <SubTabs tabs={["Feature Requests", "App Messages", "Promo Codes"]}>
      {(tab) => {
        if (tab === "Feature Requests") return <FeatureRequestsTab requests={featureRequests} />;
        if (tab === "App Messages") return <AppMessagesTab messages={appMessages} />;
        if (tab === "Promo Codes") return <PromoCodesTab codes={promoCodes} />;
        return null;
      }}
    </SubTabs>
  );
}

function FeatureRequestsTab({ requests }: { requests: FeatureRequest[] }) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [items, setItems] = useState(requests);
  const [isPending, startTransition] = useTransition();

  const filtered = statusFilter === "ALL"
    ? items
    : items.filter((r) => r.status === statusFilter);

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
      {/* Status Filters */}
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

      {/* Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="grid grid-cols-6 px-6 py-3 border-b border-white/[0.08]">
          {["TYPE", "TITLE", "PLATFORM", "STATUS", "USER", "DATE"].map((h) => (
            <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
          ))}
        </div>
        {filtered.map((r) => {
          const statusColor = STATUS_COLORS[r.status] ?? "#6B6B6B";
          return (
            <div key={r.id} className="grid grid-cols-6 px-6 items-center min-h-[56px] border-b border-white/[0.05] last:border-0">
              <span className="font-mohave text-[13px] text-[#A0A0A0]">{r.type}</span>
              <span className="font-mohave text-[14px] text-[#E5E5E5] truncate pr-2" title={r.description ?? undefined}>
                {r.title}
              </span>
              <span className="font-mohave text-[13px] text-[#A0A0A0]">{r.platform ?? "—"}</span>
              <span>
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
              </span>
              <span className="font-kosugi text-[12px] text-[#6B6B6B] truncate">{r.user_email ?? "—"}</span>
              <span className="font-kosugi text-[12px] text-[#6B6B6B]">
                [{new Date(r.created_at).toLocaleDateString()}]
              </span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No feature requests</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AppMessagesTab({ messages }: { messages: AppMessage[] }) {
  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      <div className="grid grid-cols-4 px-6 py-3 border-b border-white/[0.08]">
        {["TITLE", "BODY", "STATUS", "DATE"].map((h) => (
          <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
        ))}
      </div>
      {messages.map((m) => (
        <div key={m.id} className="grid grid-cols-4 px-6 items-center min-h-[56px] border-b border-white/[0.05] last:border-0">
          <span className="font-mohave text-[14px] text-[#E5E5E5]">{m.title}</span>
          <span className="font-kosugi text-[12px] text-[#A0A0A0] truncate pr-4">{m.body ?? "—"}</span>
          <span className={`font-mohave text-[13px] ${m.active ? "text-[#9DB582]" : "text-[#6B6B6B]"}`}>
            {m.active ? "ACTIVE" : "INACTIVE"}
          </span>
          <span className="font-kosugi text-[12px] text-[#6B6B6B]">
            [{new Date(m.created_at).toLocaleDateString()}]
          </span>
        </div>
      ))}
      {messages.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No app messages</p>
        </div>
      )}
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
