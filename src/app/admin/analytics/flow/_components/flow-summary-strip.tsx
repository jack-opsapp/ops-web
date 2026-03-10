'use client'

import type { FlowSummary } from '@/lib/admin/flow-types'

interface FlowSummaryStripProps {
  summary: FlowSummary
}

export function FlowSummaryStrip({ summary }: FlowSummaryStripProps) {
  const metrics = [
    { label: 'SESSIONS', value: summary.totalSessions.toLocaleString() },
    { label: 'BOUNCE RATE', value: `${Math.round(summary.bounceRate * 100)}%` },
    { label: 'AVG SECTIONS', value: String(summary.avgSectionsViewed) },
    { label: 'SIGNUPS', value: summary.totalSignups.toLocaleString() },
    { label: 'CONVERSION', value: `${(summary.conversionRate * 100).toFixed(1)}%` },
  ]

  return (
    <div className="flex items-center gap-6 px-6 py-3 border-t border-white/[0.08] bg-white/[0.02]">
      {metrics.map((m) => (
        <div key={m.label} className="flex items-baseline gap-2">
          <span className="font-kosugi text-[10px] text-[#6B6B6B] uppercase tracking-wider">
            {m.label}
          </span>
          <span className="font-mohave text-[16px] font-semibold text-[#E5E5E5]">
            {m.value}
          </span>
        </div>
      ))}
    </div>
  )
}
