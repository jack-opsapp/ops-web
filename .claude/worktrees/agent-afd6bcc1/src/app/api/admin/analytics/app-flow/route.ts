/* ── src/app/api/admin/analytics/app-flow/route.ts ── */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/firebase/admin-verify';
import { isAdminEmail } from '@/lib/admin/admin-queries';
import { getAppFlowData } from '@/lib/admin/app-flow-queries';
import type { AppFlowQueryParams } from '@/lib/admin/app-flow-types';

export async function GET(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const params: AppFlowQueryParams = {
    days: parseInt(url.searchParams.get('days') ?? '30', 10),
    device: url.searchParams.get('device') ?? 'all',
  };

  if (![7, 30, 90, 9999].includes(params.days)) params.days = 30;

  try {
    const data = await getAppFlowData(params);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
