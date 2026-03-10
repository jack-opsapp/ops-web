'use client'

import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react'

export function DropoffEdge({
  id,
  sourceX, sourceY, targetX, targetY,
}: EdgeProps) {
  const [edgePath] = getStraightPath({
    sourceX, sourceY, targetX, targetY,
  })

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: '#7C4A4A',
        strokeWidth: 1,
        opacity: 0.4,
        strokeDasharray: '4 4',
        fill: 'none',
      }}
    />
  )
}
