"use client";

// ---------------------------------------------------------------------------
// ClusterLegend — frosted-glass legend in the bottom-left HUD position.
// Shows color dots + labels for each cluster. Click toggles visibility.
// ---------------------------------------------------------------------------

import { useIntelStore } from "@/stores/intel-store";
import { useDictionary } from "@/i18n/client";
import { CLUSTER_COLORS } from "../galaxy-layout";

const CLUSTER_ORDER = [
  "voice",
  "internal",
  "client",
  "project",
  "vendor",
  "subtrade",
  "financial",
] as const;

export function ClusterLegend() {
  const { t } = useDictionary("intel");
  const visibleClusters = useIntelStore((s) => s.visibleClusters);
  const toggleCluster = useIntelStore((s) => s.toggleCluster);

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2"
      style={{
        background: "var(--surface-glass)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "3px",
      }}
    >
      {CLUSTER_ORDER.map((cluster) => {
        const isVisible = visibleClusters.has(cluster);
        const color = CLUSTER_COLORS[cluster] || "#8E8E93";
        const label = t(`clusters.${cluster}`);

        return (
          <button
            key={cluster}
            onClick={() => toggleCluster(cluster)}
            className="flex items-center gap-2 py-0.5 group"
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0 transition-opacity"
              style={{
                backgroundColor: color,
                opacity: isVisible ? 1 : 0.2,
              }}
            />
            <span
              className="font-kosugi text-micro uppercase tracking-wider transition-colors"
              style={{
                color: isVisible ? "#999" : "#444",
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
