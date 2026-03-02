import { NextRequest, NextResponse } from 'next/server'
import { updateABConfig } from '@/lib/ab/ab-queries'
import { verifyAdminAuth } from '@/lib/firebase/admin-verify'
import { isAdminEmail } from '@/lib/admin/admin-queries'

export async function POST(req: NextRequest) {
  const user = await verifyAdminAuth(req)
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { brand_context?: string; min_visitors?: number; min_days?: number }

  const minVisitors = body.min_visitors !== undefined ? Number(body.min_visitors) : undefined
  const minDays = body.min_days !== undefined ? Number(body.min_days) : undefined

  if (minVisitors !== undefined && (isNaN(minVisitors) || minVisitors < 1)) {
    return NextResponse.json({ error: 'min_visitors must be a positive number' }, { status: 400 })
  }
  if (minDays !== undefined && (isNaN(minDays) || minDays < 1)) {
    return NextResponse.json({ error: 'min_days must be a positive number' }, { status: 400 })
  }

  await updateABConfig({
    brand_context: body.brand_context,
    min_visitors: minVisitors,
    min_days: minDays,
  })
  return NextResponse.json({ ok: true })
}
