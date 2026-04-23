/**
 * GET /api/cron/pmf/cleanup-snapshots
 *
 * Vercel cron: `30 14 * * *` — 06:30 PT daily (just before the digest crons).
 *
 * Deletes `pmf_threshold_snapshots` rows older than 30 days. The snapshot
 * table is append-only (one row every 15 minutes from the threshold-check
 * cron) — without pruning it would grow at ~2,880 rows/month indefinitely.
 * Thirty days is plenty of history for diff-and-forensics use cases.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RETENTION_DAYS = 30;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sb = getAdminSupabase();
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 86_400_000
    ).toISOString();

    const { error, count } = await sb
      .from('pmf_threshold_snapshots')
      .delete({ count: 'exact' })
      .lt('captured_at', cutoff);

    if (error) {
      console.error(
        '[pmf-cleanup-snapshots] delete failed:',
        error.message
      );
      return NextResponse.json(
        { error: 'snapshot cleanup failed' },
        { status: 500 }
      );
    }

    // supabase-js returns `count: number | null`; coerce null to 0 so the
    // JSON response always has a numeric `pruned`.
    return NextResponse.json({ ok: true, pruned: count ?? 0 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'snapshot cleanup failed';
    console.error('[pmf-cleanup-snapshots] failed:', message, err);
    return NextResponse.json(
      { error: 'snapshot cleanup failed' },
      { status: 500 }
    );
  }
}
