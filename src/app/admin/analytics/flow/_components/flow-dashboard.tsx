'use client'

import { useState, useEffect, useCallback } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { FlowData, FlowQueryParams } from '@/lib/admin/flow-types'
import { FlowControls } from './flow-controls'
import { FlowCanvas } from './flow-canvas'
import { FlowSummaryStrip } from './flow-summary-strip'
import { DetailPanel } from './detail-panel'

interface FlowDashboardProps {
  variants?: { id: string; label: string }[]
}

export function FlowDashboard({ variants }: FlowDashboardProps) {
  const [params, setParams] = useState<FlowQueryParams>({
    days: 30,
    device: 'all',
    variant: 'all',
  })
  const [data, setData] = useState<FlowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const qs = new URLSearchParams({
      days: String(params.days),
      device: params.device,
      variant: params.variant,
    })

    fetch(`/api/admin/analytics/flow?${qs}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<FlowData>
      })
      .then((flowData) => {
        if (!cancelled) {
          setData(flowData)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [params])

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
  }, [])

  const handleClosePanel = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  const selectedNode = data?.nodes.find(n => n.id === selectedNodeId) ?? null

  return (
    <div className="flex flex-col h-[calc(100vh-88px)]">
      {/* Controls */}
      <div className="px-6 py-4 border-b border-white/[0.08]">
        <FlowControls params={params} onChange={setParams} variants={variants} />
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#0D0D0D]/80">
            <p className="font-mohave text-[14px] text-[#6B6B6B] uppercase tracking-wider">
              Reconstructing sessions...
            </p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="text-center">
              <p className="font-mohave text-[14px] text-[#93321A] uppercase tracking-wider mb-2">
                Failed to load flow data
              </p>
              <p className="font-kosugi text-[12px] text-[#6B6B6B]">{error}</p>
            </div>
          </div>
        )}

        {data && !loading && (
          <ReactFlowProvider>
            <FlowCanvas data={data} onNodeClick={handleNodeClick} />
          </ReactFlowProvider>
        )}

        {/* Detail panel overlay */}
        {selectedNode && data && (
          <DetailPanel
            node={selectedNode}
            entryBreakdown={selectedNode.type === 'entry' ? data.entryBreakdown : undefined}
            conversionBreakdown={selectedNode.type === 'conversion' ? data.conversionBreakdown : undefined}
            onClose={handleClosePanel}
          />
        )}
      </div>

      {/* Summary strip */}
      {data && !loading && <FlowSummaryStrip summary={data.summary} />}
    </div>
  )
}
