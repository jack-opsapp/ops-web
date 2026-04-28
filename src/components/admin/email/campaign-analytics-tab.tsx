"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CampaignDetailPanel } from "./campaign-detail-panel";

interface CampaignRow {
  id: string;
  name: string;
  templateId: string;
  sendStatus: string;
  sentCount: number;
  deliveredCount: number;
  bouncedCount: number;
  recipientCountActual: number | null;
  templateVersionsSent: string[];
  completedAt: string | null;
  createdAt: string;
}

const STATUS_TOKEN: Record<string, string> = {
  draft: "var(--text-3)",
  scheduled: "var(--text-2)",
  in_flight: "var(--color-ops-accent)",
  completed: "var(--color-olive)",
  failed: "var(--color-brick)",
  cancelled: "var(--text-mute)",
  paused: "var(--color-tan)",
};

const ALL_STATUSES = Object.keys(STATUS_TOKEN);

interface ListResponse {
  rows: CampaignRow[];
  total: number;
}

async function fetchCampaigns(): Promise<CampaignRow[]> {
  const r = await fetch("/api/admin/email/campaigns?include_versions=1&limit=200");
  if (!r.ok) return [];
  const j = (await r.json()) as ListResponse;
  return j.rows ?? [];
}

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

export function CampaignAnalyticsTab() {
  const reduced = useReducedMotion();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [sortBy, setSortBy] = React.useState<"created" | "sent">("created");

  const { data: rows = [] } = useQuery({
    queryKey: ["campaign-analytics-list"],
    queryFn: fetchCampaigns,
    refetchInterval: 60_000,
  });

  const filtered = rows
    .filter((r) => statusFilter === "all" || r.sendStatus === statusFilter)
    .sort((a, b) =>
      sortBy === "sent"
        ? (b.sentCount ?? 0) - (a.sentCount ?? 0)
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-[5px] border border-glass-border bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-2"
        >
          <option value="all">all statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSortBy(sortBy === "created" ? "sent" : "created")}
          className="rounded-[5px] border border-glass-border bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-2 hover:bg-surface-hover"
        >
          sort: {sortBy === "created" ? "newest" : "most sent"}
        </button>
      </div>

      <div className="rounded-panel border border-glass-border">
        {filtered.map((row) => {
          const isOpen = openId === row.id;
          return (
            <div key={row.id}>
              <button
                onClick={() => setOpenId(isOpen ? null : row.id)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mohave text-[15px] text-text">
                    {row.name}
                  </div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
                    [{row.templateId}]
                    <span
                      className="ml-3"
                      style={{ color: STATUS_TOKEN[row.sendStatus] ?? "var(--text-3)" }}
                    >
                      {row.sendStatus}
                    </span>
                  </div>
                </div>
                <div
                  className="font-mono text-[14px] text-text-2"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                >
                  {row.sentCount}/{row.recipientCountActual ?? "—"}
                </div>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{
                      duration: reduced ? 0.15 : 0.32,
                      ease: EASE_SMOOTH,
                    }}
                    className="overflow-hidden border-t border-white/[0.06]"
                  >
                    <div className="px-5 py-5">
                      <CampaignDetailPanel
                        campaignId={row.id}
                        emailType={row.templateId}
                        templateVersionsSent={row.templateVersionsSent}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
            // NO CAMPAIGNS MATCH FILTERS
          </div>
        )}
      </div>
    </div>
  );
}
