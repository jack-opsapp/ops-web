import { getTestHistory } from '@/lib/ab/ab-queries'
import { AdminPageHeader } from '../../_components/admin-page-header'
import Link from 'next/link'

export const revalidate = 300

export default async function ABHistoryPage() {
  const tests = await getTestHistory()

  return (
    <div className="p-8 max-w-5xl">
      <AdminPageHeader
        title="A/B TEST HISTORY"
        subtitle={`${tests.length} completed cycle${tests.length === 1 ? '' : 's'}`}
      />

      {tests.length === 0 ? (
        <p className="text-white/40 text-sm mt-6">No completed tests yet.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {tests.map((test, i) => {
            const winner = test.winner_variant === 'a' ? test.variant_a : test.variant_b
            const loser = test.winner_variant === 'a' ? test.variant_b : test.variant_a
            const days = test.ended_at
              ? Math.round((new Date(test.ended_at).getTime() - new Date(test.started_at).getTime()) / (1000 * 60 * 60 * 24))
              : 0

            return (
              <details key={test.id} className="border border-white/10 rounded-lg overflow-hidden">
                <summary className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-white/5 list-none">
                  <div className="flex items-center gap-6">
                    <span className="text-white/40 text-xs font-mono">Cycle {tests.length - i}</span>
                    <span className="text-sm">
                      {new Date(test.started_at).toLocaleDateString()} → {test.ended_at ? new Date(test.ended_at).toLocaleDateString() : '—'}
                    </span>
                    <span className="text-xs text-white/50">{days}d</span>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <span className="text-white/50">A: {(test.variant_a.conversion_rate * 100).toFixed(2)}%</span>
                    <span className="text-white/50">B: {(test.variant_b.conversion_rate * 100).toFixed(2)}%</span>
                    <span className="text-green-400 text-xs">
                      Winner: {test.winner_variant?.toUpperCase()} Gen {winner.generation}
                    </span>
                  </div>
                </summary>

                <div className="px-6 pb-6 pt-4 grid grid-cols-2 gap-6 border-t border-white/10">
                  <div>
                    <p className="text-xs text-white/40 uppercase tracking-wider mb-2">
                      Winner — Var {test.winner_variant?.toUpperCase()} Gen {winner.generation}
                    </p>
                    <p className="text-xs text-white/60 mb-3 leading-relaxed">{winner.ai_reasoning || 'Seed variant'}</p>
                    <div className="text-xs font-mono text-white/30 space-y-1">
                      {(winner.config as { sections?: { type: string }[] })?.sections?.map((s, j) => (
                        <div key={j}>{s.type}</div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-white/40 uppercase tracking-wider mb-2">
                      Loser — Gen {loser.generation}
                    </p>
                    <p className="text-xs text-white/60 leading-relaxed">{loser.ai_reasoning || 'Seed variant'}</p>
                  </div>
                </div>
              </details>
            )
          })}
        </div>
      )}

      <div className="mt-6">
        <Link href="/admin/ab-testing" className="text-sm text-white/40 hover:text-white/70">
          ← Back to active test
        </Link>
      </div>
    </div>
  )
}
