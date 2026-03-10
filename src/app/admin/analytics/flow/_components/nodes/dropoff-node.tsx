'use client'

import { Handle, Position } from '@xyflow/react'

interface DropoffNodeProps {
  data: { count: number; rate: number; sectionName: string }
}

export function DropoffNode({ data }: DropoffNodeProps) {
  return (
    <div className="px-3 py-2 min-w-[80px] opacity-60">
      <p className="font-mohave text-[14px] text-[#7C4A4A] leading-none">
        {data.count}
      </p>
      <p className="font-kosugi text-[9px] text-[#7C4A4A]/60 mt-0.5">
        [{Math.round(data.rate * 100)}% left]
      </p>
      <Handle type="target" position={Position.Top} className="!bg-[#7C4A4A] !w-2 !h-2 !border-0" />
    </div>
  )
}
