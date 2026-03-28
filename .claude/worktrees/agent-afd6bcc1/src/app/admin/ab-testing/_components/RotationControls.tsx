'use client'
import { useState } from 'react'

interface Props {
  isEligible: boolean
  eligibilityReason: string
  isRotating: boolean
}

export function RotationControls({ isEligible, eligibilityReason, isRotating: initialRotating }: Props) {
  const [rotating, setRotating] = useState(initialRotating)
  const [error, setError] = useState<string | null>(null)

  async function handleRotate(force = false) {
    setRotating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ab-rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await res.json() as { error?: string; ok?: boolean }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Rotation failed')
        setRotating(false)
      } else {
        window.location.reload()
      }
    } catch (e) {
      setError(String(e))
      setRotating(false)
    }
  }

  if (rotating) {
    return (
      <div className="flex items-center gap-3 text-sm text-white/60">
        <div className="w-4 h-4 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
        Generating new challenger...
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        onClick={() => handleRotate(false)}
        disabled={!isEligible}
        title={!isEligible ? eligibilityReason : undefined}
        className="px-4 py-2 text-sm font-mono uppercase tracking-wider bg-white text-black rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors"
      >
        Rotate Now
      </button>

      <button
        onClick={() => handleRotate(true)}
        className="px-4 py-2 text-sm font-mono uppercase tracking-wider border border-white/20 text-white rounded hover:border-white/40 transition-colors"
      >
        Force Rotate
      </button>

      {!isEligible && <span className="text-xs text-white/40">{eligibilityReason}</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}
