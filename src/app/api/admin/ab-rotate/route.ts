import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
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
