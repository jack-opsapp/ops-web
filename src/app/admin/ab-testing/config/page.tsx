import { getABConfig } from '@/lib/ab/ab-queries'
import { AdminPageHeader } from '../../_components/admin-page-header'
import { ConfigForm } from './_components/ConfigForm'
import Link from 'next/link'

export const revalidate = 0

export default async function ABConfigPage() {
  const config = await getABConfig()

  return (
    <div className="p-8 max-w-3xl">
      <AdminPageHeader
        title="A/B CONFIG"
        subtitle="System configuration — changes take effect on the next rotation"
      />

      <div className="mt-6">
        <ConfigForm initial={config} />
      </div>

      <div className="mt-8">
        <Link href="/admin/ab-testing" className="text-sm text-white/40 hover:text-white/70">
          ← Back to active test
        </Link>
      </div>
    </div>
  )
}
