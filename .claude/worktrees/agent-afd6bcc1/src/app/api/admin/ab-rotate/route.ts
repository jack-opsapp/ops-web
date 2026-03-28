import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminAuth } from '@/lib/firebase/admin-verify'
import { isAdminEmail } from '@/lib/admin/admin-queries'

export async function POST(req: NextRequest) {
  const user = await verifyAdminAuth(req)
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { force?: boolean }
  const tryOpsUrl = process.env.TRY_OPS_URL ?? 'https://try.opsapp.co'

  const res = await fetch(`${tryOpsUrl}/api/ab-rotate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ab-admin-secret': process.env.AB_ADMIN_SECRET!,
    },
    body: JSON.stringify({ force: body.force }),
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
