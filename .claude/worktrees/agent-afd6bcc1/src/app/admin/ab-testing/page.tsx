import { getActiveTest } from '@/lib/ab/ab-queries'
import { AdminPageHeader } from '../_components/admin-page-header'
import { VariantCard } from './_components/VariantCard'
import { SectionAnalyticsTable } from './_components/SectionAnalyticsTable'
import { RotationControls } from './_components/RotationControls'
import Link from 'next/link'

export const revalidate = 60

function getEligibility(test: NonNullable<Awaited<ReturnType<typeof getActiveTest>>>) {
  const daysSinceStart = (Date.now() - new Date(test.startedAt).getTime()) / (1000 * 60 * 60 * 24)
  const daysRemaining = Math.max(0, test.minDays - daysSinceStart)
  const aRemaining = Math.max(0, test.minVisitors - test.variantA.visitorCount)
  const bRemaining = Math.max(0, test.minVisitors - test.variantB.visitorCount)

  if (daysRemaining > 0 || aRemaining > 0 || bRemaining > 0) {
    const parts: string[] = []
    if (daysRemaining > 0) parts.push(`${Math.ceil(daysRemaining)} more day${Math.ceil(daysRemaining) === 1 ? '' : 's'}`)
    if (aRemaining > 0) parts.push(`${aRemaining} more visitors for A`)
    if (bRemaining > 0) parts.push(`${bRemaining} more visitors for B`)
    return { eligible: false, reason: `Need: ${parts.join(', ')}` }
  }
  return { eligible: true, reason: '' }
}

export default async function ABTestingPage() {
  const test = await getActiveTest()

  if (!test) {
    return (
      <div className="p-8">
        <AdminPageHeader title="A/B TESTING" caption="No active test found." />
        <p className="text-white/40 text-sm mt-4">Run the seed script to initialize the first test.</p>
      </div>
    )
  }

  const isWinningA = test.variantA.conversionRate >= test.variantB.conversionRate
  const eligibility = getEligibility(test)
  const daysSinceStart = Math.floor((Date.now() - new Date(test.startedAt).getTime()) / (1000 * 60 * 60 * 24))

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <AdminPageHeader
          title="A/B TESTING"
          caption={`Test started ${daysSinceStart} day${daysSinceStart === 1 ? '' : 's'} ago · ${test.status.toUpperCase()}`}
        />
        <div className="flex gap-4 text-xs text-white/40 mt-1">
          <Link href="/admin/ab-testing/components" className="hover:text-white/70">Components →</Link>
          <Link href="/admin/ab-testing/history" className="hover:text-white/70">History →</Link>
          <Link href="/admin/ab-testing/config" className="hover:text-white/70">Config →</Link>
        </div>
      </div>

      {/* Eligibility */}
      <div className="mb-6 p-4 rounded bg-white/5 border border-white/10 text-sm">
        {eligibility.eligible
          ? <span className="text-green-400">✓ Eligible for rotation</span>
          : <span className="text-white/50">{eligibility.reason}</span>
        }
      </div>

      {/* Rotation controls */}
      <div className="mb-8">
        <RotationControls
          isEligible={eligibility.eligible}
          eligibilityReason={eligibility.reason}
          isRotating={test.status === 'rotating'}
        />
      </div>

      {/* Variant cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        <VariantCard variant={test.variantA} isWinning={isWinningA} />
        <VariantCard variant={test.variantB} isWinning={!isWinningA} />
      </div>

      {/* Section analytics */}
      <div className="border border-white/10 rounded-lg p-6">
        <h2 className="font-mohave text-sm uppercase tracking-wider text-white/60 mb-4">
          Section Analytics
        </h2>
        <SectionAnalyticsTable variantA={test.variantA} variantB={test.variantB} />
      </div>
    </div>
  )
}
