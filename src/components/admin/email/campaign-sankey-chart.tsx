"use client";

import * as React from "react";
import { Sankey, Tooltip, Rectangle } from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { sankeyLinkVariants, sankeyNodeVariants } from "@/lib/utils/motion";
import type { CampaignFunnelStage } from "@/lib/admin/email-campaign-types";

const STAGE_TOKEN: Record<CampaignFunnelStage["stage"], string> = {
  enqueued: "var(--text-3)",
  dispatched: "var(--text-2)",
  delivered: "var(--color-olive)",
  opened: "var(--color-ops-accent)",
  clicked: "var(--color-tan)",
};

interface CampaignSankeyChartProps {
  stages: CampaignFunnelStage[];
}

interface SankeyDatum {
  nodes: Array<{ name: string; color: string }>;
  links: Array<{ source: number; target: number; value: number }>;
}

function buildSankeyData(stages: CampaignFunnelStage[]): SankeyDatum {
  const nodes = stages.map((s) => ({
    name: s.stage.toUpperCase(),
    color: STAGE_TOKEN[s.stage],
  }));
  const links = stages.slice(0, -1).map((_, i) => ({
    source: i,
    target: i + 1,
    // Math.max(1, n) avoids Recharts collapsing zero-width links to nothing.
    value: Math.max(1, stages[i + 1].value),
  }));
  return { nodes, links };
}

interface SankeyLinkProps {
  sourceX: number;
  sourceY: number;
  sourceControlX: number;
  targetControlX: number;
  targetX: number;
  targetY: number;
  linkWidth: number;
  index: number;
}

function AnimatedSankeyLink(props: unknown) {
  const reduced = useReducedMotion();
  const p = props as SankeyLinkProps;
  const path =
    `M${p.sourceX},${p.sourceY}` +
    `C${p.sourceControlX},${p.sourceY} ${p.targetControlX},${p.targetY} ${p.targetX},${p.targetY}`;
  return (
    <motion.path
      d={path}
      fill="none"
      stroke="var(--color-ops-accent)"
      strokeOpacity={0.55}
      strokeWidth={p.linkWidth}
      variants={reduced ? undefined : sankeyLinkVariants}
      initial={reduced ? undefined : "initial"}
      animate={reduced ? undefined : "animate"}
      custom={p.index}
    />
  );
}

interface SankeyNodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: { name: string; color: string; value: number };
}

function SankeyNode(props: unknown) {
  const reduced = useReducedMotion();
  const p = props as SankeyNodeProps;
  return (
    <motion.g
      variants={reduced ? undefined : sankeyNodeVariants}
      initial={reduced ? undefined : "initial"}
      animate={reduced ? undefined : "animate"}
    >
      <Rectangle
        x={p.x}
        y={p.y}
        width={p.width}
        height={p.height}
        fill={p.payload.color}
        fillOpacity={0.85}
      />
      <text
        x={p.x + p.width + 8}
        y={p.y + p.height / 2}
        dy={4}
        fontFamily="JetBrains Mono"
        fontSize={11}
        fill="var(--text-2)"
        style={{ letterSpacing: "0.16em", textTransform: "uppercase", fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {p.payload.name} {p.payload.value}
      </text>
    </motion.g>
  );
}

export function CampaignSankeyChart({ stages }: CampaignSankeyChartProps) {
  if (stages.length < 2) {
    return (
      <div className="rounded-panel border border-glass-border px-6 py-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          // NO FUNNEL DATA YET
        </div>
        <p className="mt-2 font-mohave text-[14px] text-text-2">
          Campaign hasn&apos;t accumulated enough events. Check back after the first dispatch tick.
        </p>
      </div>
    );
  }

  const data = buildSankeyData(stages);

  return (
    <div className="rounded-panel border border-glass-border px-4 py-4" style={{ height: 320 }}>
      <Sankey
        width={760}
        height={280}
        data={data}
        nodeWidth={14}
        nodePadding={28}
        margin={{ top: 8, right: 200, bottom: 8, left: 8 }}
        link={<AnimatedSankeyLink />}
        node={<SankeyNode />}
      >
        <Tooltip
          contentStyle={{
            background: "var(--surface-glass-dense)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 5,
            fontFamily: "JetBrains Mono",
            fontSize: 11,
          }}
        />
      </Sankey>
    </div>
  );
}
