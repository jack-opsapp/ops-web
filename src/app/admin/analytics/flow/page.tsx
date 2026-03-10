import { AdminPageHeader } from '../../_components/admin-page-header'
import { FlowDashboard } from './_components/flow-dashboard'
import { getActiveTest } from '@/lib/ab/ab-queries'

export default async function FlowPage() {
  let variants: { id: string; label: string }[] = []
  try {
    const test = await getActiveTest()
    if (test) {
      variants = [
        { id: test.variantA.id, label: `VARIANT A (G${test.variantA.generation})` },
        { id: test.variantB.id, label: `VARIANT B (G${test.variantB.generation})` },
      ]
    }
  } catch {
    // Non-critical — filter just won't show variant options
  }

  return (
    <div className="flex flex-col h-screen">
      <AdminPageHeader title="User Flow" caption="session journey visualization" />
      <FlowDashboard variants={variants} />
    </div>
  )
}
