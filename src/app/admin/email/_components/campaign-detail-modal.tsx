"use client";
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CampaignStatusPill } from "./campaign-status-pill";
import { CampaignProgressBar } from "./campaign-progress-bar";
import type { Campaign, CampaignStatus } from "@/lib/email/campaigns";
import { EASE_SMOOTH } from "@/lib/utils/motion";

interface JobRow {
  id: string;
  recipient_email: string;
  status: string;
  sent_at: string | null;
  last_error: string | null;
  retry_count: number;
  sg_message_id: string | null;
}

interface DetailResponse {
  campaign: Campaign;
  jobs: JobRow[];
  jobsTotal: number;
}

interface Props {
  campaignId: string | null;
  onClose: () => void;
}

const POLL_STATUSES: CampaignStatus[] = ["scheduled", "in_flight"];

export function CampaignDetailModal({ campaignId, onClose }: Props) {
  const reduce = useReducedMotion();
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      const r = await fetch(
        `/api/admin/email/campaigns/${campaignId}?jobLimit=50`
      );
      if (!r.ok) throw new Error("detail_failed");
      return (await r.json()) as DetailResponse;
    },
    enabled: !!campaignId,
    refetchInterval: (q) => {
      const status = q.state.data?.campaign.sendStatus;
      return status && POLL_STATUSES.includes(status) ? 5000 : false;
    },
  });

  const pause = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/admin/email/campaigns/${campaignId}/pause`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "manual operator pause" }),
      });
      if (!r.ok) throw new Error("pause_failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const resume = useMutation({
    mutationFn: async () => {
      const r = await fetch(
        `/api/admin/email/campaigns/${campaignId}/resume`,
        { method: "POST" }
      );
      if (!r.ok) throw new Error("resume_failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const r = await fetch(
        `/api/admin/email/campaigns/${campaignId}/cancel`,
        { method: "POST" }
      );
      if (!r.ok) throw new Error("cancel_failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      onClose();
    },
  });

  const t = reduce
    ? { duration: 0.15 }
    : { duration: 0.32, ease: EASE_SMOOTH };

  const c = detail.data?.campaign;
  const showPause = c?.sendStatus === "in_flight";
  const showResume = c?.sendStatus === "paused";
  const showCancel =
    c?.sendStatus === "scheduled" ||
    c?.sendStatus === "in_flight" ||
    c?.sendStatus === "paused";

  return (
    <AnimatePresence>
      {campaignId && c ? (
        <motion.div
          className="fixed inset-0 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.65)", zIndex: 3000 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={t}
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-detail-title"
            className="w-full max-w-[720px] max-h-[80vh] overflow-y-auto p-6 rounded-modal"
            style={{
              background: "rgba(18,18,20,0.78)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.09)",
            }}
          >
            <div className="flex items-start justify-between mb-4 gap-3">
              <div className="min-w-0">
                <h2
                  id="campaign-detail-title"
                  className="font-cakemono font-light text-[14px] tracking-[0.06em] text-[#EDEDED] mb-1 truncate"
                >
                  {"// "}{c.name.toUpperCase()}
                </h2>
                <span className="font-mono text-[11px] text-[#8A8A8A]">
                  [{c.slug}] [template = {c.templateId}]
                </span>
              </div>
              <CampaignStatusPill status={c.sendStatus} />
            </div>

            <div
              className="grid grid-cols-3 gap-4 mb-5"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              <Counter label="DELIVERED" value={c.deliveredCount} />
              <Counter label="OPENED" value={c.openedCount} />
              <Counter label="CLICKED" value={c.clickedCount} />
              <Counter label="BOUNCED" value={c.bouncedCount} accent="brick" />
              <Counter label="FAILED" value={c.failedCount} accent="brick" />
              <Counter
                label="SUPPRESSED"
                value={c.suppressedSkippedCount}
                accent="mute"
              />
            </div>

            <CampaignProgressBar
              sent={c.sentCount}
              bounced={c.bouncedCount}
              failed={c.failedCount}
              total={c.recipientCountActual ?? c.recipientCountEstimate}
            />

            <div className="mt-6 mb-2 flex items-center justify-between">
              <span className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B5B5B5]">
                JOBS [{detail.data?.jobsTotal ?? 0}]
              </span>
              <div className="flex gap-2">
                {showPause ? (
                  <button
                    onClick={() => pause.mutate()}
                    disabled={pause.isPending}
                    className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#C4A868] border border-[#C4A868]/40 px-2 py-1 rounded-chip hover:bg-[#C4A868]/10 disabled:opacity-40 transition-colors"
                  >
                    {pause.isPending ? "PAUSING…" : "PAUSE"}
                  </button>
                ) : null}
                {showResume ? (
                  <button
                    onClick={() => resume.mutate()}
                    disabled={resume.isPending}
                    className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#9DB582] border border-[#9DB582]/40 px-2 py-1 rounded-chip hover:bg-[#9DB582]/10 disabled:opacity-40 transition-colors"
                  >
                    {resume.isPending ? "RESUMING…" : "RESUME"}
                  </button>
                ) : null}
                {showCancel ? (
                  <button
                    onClick={() => cancel.mutate()}
                    disabled={cancel.isPending}
                    className="font-cakemono font-light text-[11px] tracking-[0.06em] text-[#B58289] border border-[#93321A]/50 px-2 py-1 rounded-chip hover:bg-[#93321A]/10 disabled:opacity-40 transition-colors"
                  >
                    {cancel.isPending ? "CANCELLING…" : "CANCEL"}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="border-t border-white/[0.06]">
              {detail.data?.jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center justify-between gap-3 py-2 border-b border-white/[0.04]"
                >
                  <span className="font-mono text-[12px] text-[#EDEDED] truncate">
                    {j.recipient_email}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {j.last_error ? (
                      <span
                        className="font-mono text-[10px] text-[#B58289] max-w-[240px] truncate"
                        title={j.last_error}
                      >
                        [{j.last_error}]
                      </span>
                    ) : null}
                    <span
                      className="font-cakemono font-light text-[10px] tracking-[0.06em]"
                      style={{ color: jobStatusColor(j.status) }}
                    >
                      {j.status.toUpperCase().replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
              {(detail.data?.jobs.length ?? 0) === 0 ? (
                <p className="font-mono text-[11px] text-[#6A6A6A] py-4">
                  [no jobs yet — dispatcher will enqueue when scheduled time arrives]
                </p>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Counter({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "brick" | "mute";
}) {
  const reduce = useReducedMotion();
  const color =
    accent === "brick" ? "#B58289" : accent === "mute" ? "#6A6A6A" : "#EDEDED";
  const t = reduce
    ? { duration: 0.15 }
    : { duration: 0.3, ease: EASE_SMOOTH };
  return (
    <div>
      <span className="font-cakemono font-light text-[10px] tracking-[0.06em] text-[#8A8A8A] block">
        {label}
      </span>
      <motion.span
        key={value}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t}
        className="font-mono text-[20px]"
        style={{ color, fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {value}
      </motion.span>
    </div>
  );
}

function jobStatusColor(s: string): string {
  switch (s) {
    case "sent":
      return "#9DB582";
    case "bounced":
      return "#B58289";
    case "failed":
      return "#93321A";
    case "skipped_suppressed":
      return "#6A6A6A";
    case "dispatching":
      return "#C4A868";
    case "cancelled":
      return "#6A6A6A";
    default:
      return "#8A8A8A";
  }
}
