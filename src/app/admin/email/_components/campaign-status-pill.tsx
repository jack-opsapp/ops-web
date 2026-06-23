"use client";
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { CampaignStatus } from "@/lib/email/campaigns";
import {
  statusPillVariants,
  statusPillVariantsReduced,
} from "@/lib/utils/motion";

interface PillStyle {
  fg: string;
  bg: string;
  bd: string;
  label: string;
}

const STYLES: Record<CampaignStatus, PillStyle> = {
  draft:     { fg: "#8A8A8A", bg: "rgba(138,138,138,0.08)", bd: "rgba(138,138,138,0.30)", label: "DRAFT" },
  scheduled: { fg: "#B5B5B5", bg: "rgba(181,181,181,0.08)", bd: "rgba(181,181,181,0.30)", label: "SCHEDULED" },
  in_flight: { fg: "#C4A868", bg: "rgba(196,168,104,0.08)", bd: "rgba(196,168,104,0.40)", label: "SENDING" },
  completed: { fg: "#9DB582", bg: "rgba(157,181,130,0.08)", bd: "rgba(157,181,130,0.40)", label: "SENT" },
  failed:    { fg: "#B58289", bg: "rgba(181,130,137,0.08)", bd: "rgba(147,50,26,0.50)",   label: "FAILED" },
  cancelled: { fg: "#6A6A6A", bg: "rgba(106,106,106,0.06)", bd: "rgba(106,106,106,0.25)", label: "CANCELLED" },
  paused:    { fg: "#C4A868", bg: "transparent",            bd: "rgba(196,168,104,0.55)", label: "PAUSED" },
};

interface Props {
  status: CampaignStatus;
}

export function CampaignStatusPill({ status }: Props) {
  const reduce = useReducedMotion();
  const s = STYLES[status];
  return (
    <motion.span
      variants={reduce ? statusPillVariantsReduced : statusPillVariants}
      initial="hidden"
      animate="visible"
      className="inline-flex items-center font-cakemono font-light text-[11px] tracking-[0.06em] px-2 py-[3px] rounded-chip"
      style={{
        color: s.fg,
        background: s.bg,
        border: `1px solid ${s.bd}`,
      }}
    >
      {s.label}
    </motion.span>
  );
}
