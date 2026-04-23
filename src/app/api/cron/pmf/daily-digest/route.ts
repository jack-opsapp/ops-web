/**
 * GET /api/cron/pmf/daily-digest
 *
 * Vercel cron: `0 15 * * *` — 07:00 PT daily.
 *
 * Renders the {@link DailyDigestEmail} with the current PMF state and the
 * days-to-GATE-B countdown, then hands off to `sendPmfNotification` with
 * `kind: 'daily_digest'`. The sender fans this out to email only (digest
 * kinds are email-exclusive — see `pmf-send.ts` channel gating).
 *
 * The trigger is date-scoped (`daily_YYYY-MM-DD`) so a hypothetical
 * dedup-enabled future run could drop duplicates from a same-day retry.
 * Per `DEFAULT_DEDUP.daily_digest = 0` the send always fires today; we
 * keep the date suffix for operational readability in `pmf_notification_log`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { computePmfState } from '@/lib/admin/pmf-queries';
import { sendPmfNotification } from '@/lib/notifications/pmf-send';
import { DailyDigestEmail } from '@/emails/pmf/daily-digest';
import { daysUntilGate } from '@/lib/pmf/formatters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DASHBOARD_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.opsapp.co'}/admin/pmf`;

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
    const state = await computePmfState();
    // Hoist the countdown + date once per request so the subject line and
    // the email body report the same numbers even if the day rolls over
    // mid-execution (extremely unlikely, but free to fix).
    const daysToGate = daysUntilGate();
    const today = new Date().toISOString().slice(0, 10);

    await sendPmfNotification({
      kind: 'daily_digest',
      trigger: `daily_${today}`,
      emailSubject: `OPS :: PMF DAILY · GATE B ${daysToGate} DAYS`,
      emailReact: DailyDigestEmail({
        state,
        daysToGate,
        dashboardUrl: DASHBOARD_URL,
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'daily digest failed';
    console.error('[pmf-daily-digest] failed:', message, err);
    return NextResponse.json(
      { error: 'daily digest failed' },
      { status: 500 }
    );
  }
}
