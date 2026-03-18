"use client";

// ---------------------------------------------------------------------------
// StatsRibbon — frosted-glass stats display in the top-right HUD position.
// Shows entity count, connection count, profile count, and last scan date.
// Kosugi uppercase labels, Mohave values.
// ---------------------------------------------------------------------------

import { useDictionary } from "@/i18n/client";

interface StatsRibbonProps {
  entityCount: number;
  edgeCount: number;
  profileCount: number;
  lastScanAt: string | null;
}

export function StatsRibbon({
  entityCount,
  edgeCount,
  profileCount,
  lastScanAt,
}: StatsRibbonProps) {
  const { t } = useDictionary("intel");

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const stats = [
    { label: t("stats.entities"), value: entityCount },
    { label: t("stats.edges"), value: edgeCount },
    { label: t("stats.profiles"), value: profileCount },
    { label: t("stats.lastScan"), value: formatDate(lastScanAt) },
  ];

  return (
    <div
      className="flex items-center gap-4 px-3 py-2 flex-wrap"
      style={{
        background: "rgba(10, 10, 10, 0.70)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "3px",
      }}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="text-left">
          <div className="font-mohave text-sm text-white leading-tight">
            {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
          </div>
          <div className="font-kosugi text-[8px] uppercase tracking-wider text-[#666]">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
