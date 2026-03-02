'use client'
import { useState } from 'react'
import type { VariantData } from '@/lib/ab/ab-queries'

export function VariantCard({ variant, isWinning }: { variant: VariantData; isWinning: boolean }) {
  const [showConfig, setShowConfig] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)

  return (
    <div className={`rounded-lg border p-6 ${isWinning ? 'border-green-500/40 bg-green-900/10' : 'border-white/10 bg-white/5'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mohave text-lg uppercase tracking-wider">
          Variant {variant.slot.toUpperCase()} — Gen {variant.generation}
        </h3>
        {isWinning && (
          <span className="text-xs font-mono text-green-400 border border-green-400/40 px-2 py-1 rounded">
            WINNING
          </span>
        )}
      </div>

      <div className="text-4xl font-mohave font-bold mb-1">
        {(variant.conversionRate * 100).toFixed(2)}%
      </div>
      <div className="text-sm text-white/50 mb-4">
        {variant.signupCount} signups / {variant.visitorCount} visitors
      </div>

      <button
        className="text-xs text-white/40 underline mb-2 block"
        onClick={() => setShowConfig(v => !v)}
      >
        {showConfig ? 'Hide' : 'Show'} section config
      </button>
      {showConfig && (
        <div className="text-xs font-mono bg-black/40 rounded p-3 mb-3 space-y-1">
          {variant.config?.sections?.map((s, i) => (
            <div key={i}>
              <span className="text-blue-400">{s.type}</span>
              {s.props.headline && (
                <span className="text-white/60"> — {String(s.props.headline).slice(0, 60)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        className="text-xs text-white/40 underline mb-2 block"
        onClick={() => setShowReasoning(v => !v)}
      >
        {showReasoning ? 'Hide' : 'Show'} AI reasoning
      </button>
      {showReasoning && (
        <p className="text-xs text-white/60 bg-black/40 rounded p-3 leading-relaxed">
          {variant.aiReasoning || 'No reasoning available (seed variant).'}
        </p>
      )}
    </div>
  )
}
