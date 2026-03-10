'use client'

import { useCallback } from 'react'
import type { FlowQueryParams } from '@/lib/admin/flow-types'

const TIME_OPTIONS = [
  { key: 7, label: '7D' },
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
  { key: 9999, label: 'ALL' },
] as const

const DEVICE_OPTIONS = ['all', 'mobile', 'tablet', 'desktop'] as const

interface FlowControlsProps {
  params: FlowQueryParams
  onChange: (params: FlowQueryParams) => void
  variants?: { id: string; label: string }[]
}

export function FlowControls({ params, onChange, variants }: FlowControlsProps) {
  const pill = useCallback(
    (active: boolean) =>
      `px-3 py-1 rounded-full font-mohave text-[12px] uppercase tracking-wider transition-colors ${
        active
          ? 'bg-[#597794]/20 text-[#597794]'
          : 'bg-white/[0.06] text-[#6B6B6B] hover:text-[#A0A0A0] hover:bg-white/[0.08]'
      }`,
    []
  )

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Time range */}
      <div className="flex items-center gap-1">
        {TIME_OPTIONS.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange({ ...params, days: t.key })}
            className={pill(params.days === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-white/[0.08]" />

      {/* Device filter */}
      <div className="flex items-center gap-1">
        {DEVICE_OPTIONS.map((d) => (
          <button
            key={d}
            onClick={() => onChange({ ...params, device: d })}
            className={pill(params.device === d)}
          >
            {d === 'all' ? 'ALL DEVICES' : d.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Variant filter */}
      {variants && variants.length > 0 && (
        <>
          <div className="w-px h-4 bg-white/[0.08]" />
          <div className="flex items-center gap-1">
            <button
              onClick={() => onChange({ ...params, variant: 'all' })}
              className={pill(params.variant === 'all')}
            >
              ALL VARIANTS
            </button>
            {variants.map((v) => (
              <button
                key={v.id}
                onClick={() => onChange({ ...params, variant: v.id })}
                className={pill(params.variant === v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
