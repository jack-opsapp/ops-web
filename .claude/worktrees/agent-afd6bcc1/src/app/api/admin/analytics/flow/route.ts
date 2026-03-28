import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminAuth } from '@/lib/firebase/admin-verify'
import { isAdminEmail } from '@/lib/admin/admin-queries'
import { getFlowData } from '@/lib/admin/flow-queries'
import type { FlowQueryParams } from '@/lib/admin/flow-types'

export async function GET(req: NextRequest) {
  const user = await verifyAdminAuth(req)
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const params: FlowQueryParams = {
    days: parseInt(url.searchParams.get('days') ?? '30', 10),
    device: url.searchParams.get('device') ?? 'all',
    variant: url.searchParams.get('variant') ?? 'all',
  }

  if (![7, 30, 90, 9999].includes(params.days)) {
    params.days = 30
  }

  try {
    const data = await getFlowData(params)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[flow-api]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
