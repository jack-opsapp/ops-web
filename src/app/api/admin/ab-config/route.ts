import { NextRequest, NextResponse } from 'next/server'
import { updateABConfig } from '@/lib/ab/ab-queries'

export async function POST(req: NextRequest) {
  const body = await req.json() as { brand_context?: string; min_visitors?: number; min_days?: number }
  await updateABConfig({
    brand_context: body.brand_context,
    min_visitors: body.min_visitors !== undefined ? Number(body.min_visitors) : undefined,
    min_days: body.min_days !== undefined ? Number(body.min_days) : undefined,
  })
  return NextResponse.json({ ok: true })
}
