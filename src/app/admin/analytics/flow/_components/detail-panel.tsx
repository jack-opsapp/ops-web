'use client'

import { useEffect, useRef } from 'react'
import type { FlowNode, EntryBreakdown, ConversionBreakdown } from '@/lib/admin/flow-types'

interface DetailPanelProps {
  node: FlowNode | null
  entryBreakdown?: EntryBreakdown
  conversionBreakdown?: ConversionBreakdown
  onClose: () => void
}

export function DetailPanel({ node, entryBreakdown, conversionBreakdown, onClose }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!node) return null

  return (
    <div
      ref={panelRef}
      className="absolute top-0 right-0 w-[360px] h-full border-l border-white/[0.08] bg-[#0D0D0D] overflow-y-auto z-10"
      style={{
        animation: 'slideInRight 250ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
        <h3 className="font-mohave text-[16px] font-semibold uppercase text-[#E5E5E5]">
          {node.label}
        </h3>
        <button
          onClick={onClose}
          className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors font-mohave text-[14px]"
        >
          CLOSE
        </button>
      </div>

      <div className="p-5 space-y-6">
        {node.type === 'entry' && entryBreakdown && (
          <EntryDetails breakdown={entryBreakdown} totalSessions={node.views} />
        )}
        {node.type === 'section' && <SectionDetails node={node} />}
        {node.type === 'conversion' && conversionBreakdown && (
          <ConversionDetails breakdown={conversionBreakdown} totalSignups={node.views} />
        )}
      </div>
    </div>
  )
}

function EntryDetails({ breakdown, totalSessions }: { breakdown: EntryBreakdown; totalSessions: number }) {
  return (
    <>
      <MetricRow label="TOTAL SESSIONS" value={totalSessions.toLocaleString()} />
      <MetricRow label="DIRECT TRAFFIC" value={breakdown.directCount.toLocaleString()} />
      <BarList title="UTM SOURCES" items={breakdown.utmSources} total={totalSessions} />
      <BarList title="UTM MEDIUMS" items={breakdown.utmMediums} total={totalSessions} />
      <BarList title="REFERRERS" items={breakdown.referrers} total={totalSessions} />
      <BarList title="DEVICES" items={breakdown.devices} total={totalSessions} />
    </>
  )
}

function SectionDetails({ node }: { node: FlowNode }) {
  const dwellSec = (node.avgDwellMs / 1000).toFixed(1)

  return (
    <>
      <MetricRow label="VIEWS" value={node.views.toLocaleString()} />
      <MetricRow label="AVG DWELL" value={`${dwellSec}s`} />
      <MetricRow label="CLICKS" value={node.clicks.toLocaleString()} />
      <MetricRow label="DROPOFF RATE" value={`${Math.round(node.dropoffRate * 100)}%`} accent={node.dropoffRate > 0.3 ? 'danger' : undefined} />
      <MetricRow label="CONVERSION RATE" value={`${(node.conversionRate * 100).toFixed(1)}%`} accent={node.conversionRate > 0 ? 'accent' : undefined} />

      {node.clickBreakdown.length > 0 && (
        <BarList
          title="CLICK BREAKDOWN"
          items={node.clickBreakdown.map(c => ({ name: c.elementId, count: c.count }))}
          total={node.clicks}
        />
      )}

      {node.deviceBreakdown.length > 0 && (
        <BarList
          title="DEVICES"
          items={node.deviceBreakdown.map(d => ({ name: d.device, count: d.count }))}
          total={node.views}
        />
      )}
    </>
  )
}

function ConversionDetails({ breakdown, totalSignups }: { breakdown: ConversionBreakdown; totalSignups: number }) {
  return (
    <>
      <MetricRow label="TOTAL SIGNUPS" value={totalSignups.toLocaleString()} />
      <MetricRow label="AVG SECTIONS VIEWED" value={String(breakdown.avgSectionsBeforeConversion)} />
      <BarList title="LAST SECTION BEFORE SIGNUP" items={breakdown.lastSectionBeforeSignup} total={totalSignups} />
      <BarList title="UTM SOURCES" items={breakdown.utmSources} total={totalSignups} />
      <BarList title="DEVICES" items={breakdown.devices} total={totalSignups} />
    </>
  )
}

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: 'danger' | 'accent' }) {
  const valueColor = accent === 'danger' ? 'text-[#93321A]' : accent === 'accent' ? 'text-[#597794]' : 'text-[#E5E5E5]'
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-kosugi text-[10px] text-[#6B6B6B] uppercase tracking-wider">{label}</span>
      <span className={`font-mohave text-[18px] font-semibold ${valueColor}`}>{value}</span>
    </div>
  )
}

function BarList({ title, items, total }: { title: string; items: { name: string; count: number }[]; total: number }) {
  if (items.length === 0) return null
  const maxCount = items[0]?.count ?? 1

  return (
    <div>
      <p className="font-mohave text-[11px] uppercase tracking-wider text-[#6B6B6B] mb-2">{title}</p>
      <div className="space-y-1.5">
        {items.slice(0, 8).map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <div className="flex-1 relative h-5 bg-white/[0.04] rounded overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-white/[0.08] rounded"
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
              <span className="relative z-10 px-2 font-kosugi text-[10px] text-[#A0A0A0] leading-5 truncate block">
                {item.name}
              </span>
            </div>
            <span className="font-mohave text-[12px] text-[#E5E5E5] w-8 text-right">
              {item.count}
            </span>
            <span className="font-kosugi text-[9px] text-[#6B6B6B] w-8 text-right">
              {total > 0 ? `${Math.round((item.count / total) * 100)}%` : '0%'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
