'use client'

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

interface FlowEdgeData {
  count: number
  isConversionPath: boolean
  maxCount: number
}

export function FlowEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  })

  const edgeData = data as FlowEdgeData | undefined
  const count = edgeData?.count ?? 0
  const maxCount = edgeData?.maxCount ?? 1
  const isConversion = edgeData?.isConversionPath ?? false

  const strokeWidth = Math.max(1, Math.min(6, 1 + 5 * (count / maxCount)))
  const stroke = isConversion ? '#597794' : 'rgba(255,255,255,0.15)'
  const opacity = isConversion ? 0.8 : 0.4 + 0.4 * (count / maxCount)

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth,
          opacity,
          fill: 'none',
        }}
      />
      <text
        x={(sourceX + targetX) / 2}
        y={(sourceY + targetY) / 2 - 8}
        textAnchor="middle"
        className="fill-[#6B6B6B]"
        style={{ fontSize: 9, fontFamily: 'Kosugi' }}
      >
        {count}
      </text>
    </>
  )
}
