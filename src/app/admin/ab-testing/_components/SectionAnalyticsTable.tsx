import type { VariantData } from '@/lib/ab/ab-queries'

export function SectionAnalyticsTable({ variantA, variantB }: { variantA: VariantData; variantB: VariantData }) {
  const allSections = Array.from(new Set([
    ...variantA.sections.map(s => s.sectionName),
    ...variantB.sections.map(s => s.sectionName),
  ]))

  if (allSections.length === 0) {
    return <p className="text-xs text-white/30 py-4">No section data yet — waiting for traffic.</p>
  }

  const getSection = (variant: VariantData, name: string) =>
    variant.sections.find(s => s.sectionName === name)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-white/40 text-xs uppercase tracking-wider border-b border-white/10">
            <th className="text-left py-3 pr-4">Section</th>
            <th className="text-right py-3 px-4">A % Viewed</th>
            <th className="text-right py-3 px-4">A Dwell</th>
            <th className="text-right py-3 px-4">A Clicks</th>
            <th className="text-right py-3 px-4">B % Viewed</th>
            <th className="text-right py-3 px-4">B Dwell</th>
            <th className="text-right py-3 px-4">B Clicks</th>
          </tr>
        </thead>
        <tbody>
          {allSections.map(name => {
            const a = getSection(variantA, name)
            const b = getSection(variantB, name)
            return (
              <tr key={name} className="border-b border-white/5">
                <td className="py-3 pr-4 font-mono text-xs text-white/70">{name}</td>
                <td className="py-3 px-4 text-right">{a ? `${a.pctViewers}%` : '—'}</td>
                <td className="py-3 px-4 text-right">{a ? `${(a.avgDwellMs / 1000).toFixed(1)}s` : '—'}</td>
                <td className="py-3 px-4 text-right">{a ? a.clickRate.toFixed(2) : '—'}</td>
                <td className="py-3 px-4 text-right">{b ? `${b.pctViewers}%` : '—'}</td>
                <td className="py-3 px-4 text-right">{b ? `${(b.avgDwellMs / 1000).toFixed(1)}s` : '—'}</td>
                <td className="py-3 px-4 text-right">{b ? b.clickRate.toFixed(2) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
