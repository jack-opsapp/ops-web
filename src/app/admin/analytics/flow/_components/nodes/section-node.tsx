'use client'

import { Handle, Position } from '@xyflow/react'
import type { FlowNode } from '@/lib/admin/flow-types'

interface SectionNodeProps {
  data: FlowNode & { onClick: (nodeId: string) => void; maxViews: number }
}

export function SectionNode({ data }: SectionNodeProps) {
  const dwellSec = (data.avgDwellMs / 1000).toFixed(1)
  const opacity = data.maxViews > 0 ? 0.3 + 0.7 * (data.views / data.maxViews) : 1

  return (
    <div
      className="relative px-4 py-3 min-w-[180px] border border-white/[0.08] rounded bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] hover:border-white/[0.12] transition-colors"
      style={{ opacity }}
      onClick={() => data.onClick(data.id)}
    >
      <p className="font-mohave text-[11px] uppercase tracking-wider text-[#E5E5E5] mb-2">
        {data.label}
      </p>
      <div className="flex items-baseline gap-3">
        <div>
          <p className="font-mohave text-[20px] font-semibold text-[#E5E5E5] leading-none">
            {data.views.toLocaleString()}
          </p>
          <p className="font-kosugi text-[9px] text-[#6B6B6B] mt-0.5">[views]</p>
        </div>
        <div>
          <p className="font-mohave text-[14px] text-[#A0A0A0] leading-none">
            {dwellSec}s
          </p>
          <p className="font-kosugi text-[9px] text-[#6B6B6B] mt-0.5">[dwell]</p>
        </div>
        {data.clicks > 0 && (
          <div>
            <p className="font-mohave text-[14px] text-[#A0A0A0] leading-none">
              {data.clicks}
            </p>
            <p className="font-kosugi text-[9px] text-[#6B6B6B] mt-0.5">[clicks]</p>
          </div>
        )}
      </div>

      {data.dropoffRate > 0.05 && (
        <div className="mt-2 flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#7C4A4A]" />
          <p className="font-kosugi text-[9px] text-[#7C4A4A]">
            {Math.round(data.dropoffRate * 100)}% dropped
          </p>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="!bg-white/20 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-white/20 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} id="dropoff" className="!bg-[#7C4A4A] !w-2 !h-2 !border-0" />
    </div>
  )
}
