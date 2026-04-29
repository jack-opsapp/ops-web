"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { VersionCompareResult } from "@/lib/admin/email-campaign-types";

interface Props {
  emailType: string;
  versions: string[];
}

async function fetchCompare(
  emailType: string,
  a: string,
  b: string
): Promise<VersionCompareResult | null> {
  const r = await fetch(
    `/api/admin/email/templates/${encodeURIComponent(emailType)}/versions/compare` +
      `?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
  );
  if (!r.ok) return null;
  const j = (await r.json()) as { result?: VersionCompareResult | null };
  return j.result ?? null;
}

interface RowProps {
  label: string;
  valueA: number;
  valueB: number;
  isPct?: boolean;
}

const Row = ({ label, valueA, valueB, isPct }: RowProps) => {
  const delta = valueA - valueB;
  const winner = delta > 0 ? "a" : delta < 0 ? "b" : "tie";
  return (
    <tr>
      <td className="py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
        {label}
      </td>
      <td
        className={`py-2 text-right font-mono text-[14px] ${
          winner === "a" ? "text-[var(--color-olive)]" : "text-text-2"
        }`}
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {valueA}
        {isPct ? "%" : ""}
      </td>
      <td
        className={`py-2 text-right font-mono text-[14px] ${
          winner === "b" ? "text-[var(--color-olive)]" : "text-text-2"
        }`}
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {valueB}
        {isPct ? "%" : ""}
      </td>
    </tr>
  );
};

export function TemplateVersionCompareCard({ emailType, versions }: Props) {
  const dedup = Array.from(new Set(versions)).slice(0, 2);
  const a = dedup[0];
  const b = dedup[1];
  const enabled = Boolean(a && b);

  const { data } = useQuery({
    queryKey: ["template-version-compare", emailType, a, b],
    queryFn: () => fetchCompare(emailType, a as string, b as string),
    staleTime: 60_000,
    enabled,
  });

  if (!enabled) return null;
  if (!data) return null;

  const versA = data.versions[a as string];
  const versB = data.versions[b as string];
  if (!versA || !versB) return null;

  return (
    <div className="rounded-panel border border-glass-border px-5 py-5">
      <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        {"// VERSION COMPARE"}
      </div>
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute" />
            <th className="text-right font-mono text-[11px] uppercase tracking-[0.14em] text-text-2">
              v{a}
            </th>
            <th className="text-right font-mono text-[11px] uppercase tracking-[0.14em] text-text-2">
              v{b}
            </th>
          </tr>
        </thead>
        <tbody>
          <Row label="Sent" valueA={versA.sent} valueB={versB.sent} />
          <Row label="Open rate" valueA={versA.open_rate} valueB={versB.open_rate} isPct />
          <Row label="Click rate" valueA={versA.click_rate} valueB={versB.click_rate} isPct />
          <Row label="Bounce rate" valueA={versA.bounce_rate} valueB={versB.bounce_rate} isPct />
        </tbody>
      </table>
    </div>
  );
}
