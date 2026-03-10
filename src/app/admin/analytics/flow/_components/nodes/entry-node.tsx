'use client'

import { Handle, Position } from '@xyflow/react'
import type { FlowNode } from '@/lib/admin/flow-types'

interface EntryNodeProps {
  data: FlowNode & { onClick: (nodeId: string) => void }
}

export function EntryNode({ data }: EntryNodeProps) {
  return (
    <div
      className="relative px-5 py-4 min-w-[160px] border border-white/[0.08] rounded bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] hover:border-white/[0.12] transition-colors"
      style={{ borderLeftWidth: 3, borderLeftColor: '#4A7C59' }}
      onClick={() => data.onClick(data.id)}
    >
      <p className="font-mohave text-[11px] uppercase tracking-wider text-[#6B6B6B] mb-1">
        {data.label}
      </p>
      <p className="font-mohave text-[28px] font-semibold text-[#E5E5E5] leading-none">
        {data.views.toLocaleString()}
      </p>
      <p className="font-kosugi text-[10px] text-[#6B6B6B] mt-1">
        [{data.dropoffRate > 0 ? `${Math.round(data.dropoffRate * 100)}% bounced` : 'sessions'}]
      </p>
      <Handle type="source" position={Position.Right} className="!bg-[#4A7C59] !w-2 !h-2 !border-0" />
    </div>
  )
}
