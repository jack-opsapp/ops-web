/**
 * Unit tests for the unified PMF notification sender (Task 24).
 *
 * Verifies:
 *   - Dedup: when `hasRecentSend` returns a row, zero channels fire.
 *   - Retry: `withRetry` succeeds on 2nd attempt, exhausts after 3, uses
 *     the expected exponential delays (fake timers).
 *   - Logging: success writes a row with `sent_at` set and `error` null.
 *     Failure writes a row with `sent_at` null and `error` populated.
 *   - Channel gating: `daily_digest` fires email only (no SMS, no in-app).
 *     `threshold_alert` with all three fields fires all three channels.
 *
 * The supabase mock mirrors tests/integration/pmf-crud-routes.test.ts —
 * a hand-rolled method-chain recorder. SMS, email, and render are mocked
 * at module boundaries so we never touch real Twilio / SendGrid /
 * react-email from a unit test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module mocks (must be declared before importing the SUT) ───────────────

vi.mock('@/lib/pmf/recipients', () => ({
  getPmfRecipients: () => ({
    sms: '+15555550100',
    email: 'pmf@ops.test',
    operatorUserId: 'operator-uid',
    operatorCompanyId: 'ops-platform',
  }),
}));

const sendSmsMock = vi.fn<(to: string, body: string) => Promise<{ sid: string }>>();
vi.mock('@/lib/notifications/twilio', () => ({
  sendSms: (to: string, body: string) => sendSmsMock(to, body),
}));

const sendTransactionalEmailMock = vi.fn<
  (params: { to: string; subject: string; html: string }) => Promise<void>
>();
vi.mock('@/lib/email/sendgrid', () => ({
  sendTransactionalEmail: (params: { to: string; subject: string; html: string }) =>
    sendTransactionalEmailMock(params),
}));

vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<html>PMF digest</html>'),
}));

// ─── Supabase mock ──────────────────────────────────────────────────────────

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

const recordedCalls: RecordedCall[] = [];

type DbResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

let resultQueue: DbResult[] = [];

interface MockBuilder {
  select: (cols?: string) => MockBuilder;
  insert: (rows: unknown) => MockBuilder;
  update: (vals: unknown) => MockBuilder;
  delete: () => MockBuilder;
  upsert: (rows: unknown, opts?: unknown) => MockBuilder;
  eq: (col: string, val: unknown) => MockBuilder;
  gte: (col: string, val: unknown) => MockBuilder;
  is: (col: string, val: unknown) => MockBuilder;
  limit: (n: number) => MockBuilder;
  order: (col: string, opts?: unknown) => MockBuilder;
  single: () => Promise<DbResult>;
  maybeSingle: () => Promise<DbResult>;
  then: (onFulfilled: (v: DbResult) => unknown) => Promise<unknown>;
}

function makeMockClient(): { from: (table: string) => MockBuilder } {
  return {
    from(table: string): MockBuilder {
      const record = (method: string, ...args: unknown[]) =>
        recordedCalls.push({ table, method, args });

      const consumeResult = (): DbResult => {
        if (resultQueue.length > 0) return resultQueue.shift()!;
        return { data: null, error: null };
      };

      const builder: MockBuilder = {
        select: (cols) => {
          record('select', cols);
          return builder;
        },
        insert: (rows) => {
          record('insert', rows);
          return builder;
        },
        update: (vals) => {
          record('update', vals);
          return builder;
        },
        delete: () => {
          record('delete');
          return builder;
        },
        upsert: (rows, opts) => {
          record('upsert', rows, opts);
          return builder;
        },
        eq: (col, val) => {
          record('eq', col, val);
          return builder;
        },
        gte: (col, val) => {
          record('gte', col, val);
          return builder;
        },
        is: (col, val) => {
          record('is', col, val);
          return builder;
        },
        limit: (n) => {
          record('limit', n);
          return builder;
        },
        order: (col, opts) => {
          record('order', col, opts);
          return builder;
        },
        single: async () => {
          record('single');
          return consumeResult();
        },
        maybeSingle: async () => {
          record('maybeSingle');
          return consumeResult();
        },
        then: (onFulfilled) => {
          record('await');
          return Promise.resolve(consumeResult()).then(onFulfilled);
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin-client', () => ({
  getAdminSupabase: () => makeMockClient(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function callsFor(table: string): RecordedCall[] {
  return recordedCalls.filter((c) => c.table === table);
}

function logRowsFor(channel: 'sms' | 'email' | 'in_app'): Array<Record<string, unknown>> {
  return callsFor('pmf_notification_log')
    .filter((c) => c.method === 'insert')
    .map((c) => c.args[0] as Record<string, unknown>)
    .filter((row) => row.channel === channel);
}

beforeEach(() => {
  recordedCalls.length = 0;
  resultQueue = [];
  sendSmsMock.mockReset();
  sendTransactionalEmailMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests: dedup ───────────────────────────────────────────────────────────

describe('sendPmfNotification — dedup', () => {
  it('skips all channels when hasRecentSend returns a row', async () => {
    // First DB terminal op is the dedup SELECT from pmf_notification_log.
    resultQueue = [{ data: [{ id: 'prior' }], error: null }];

    const { sendPmfNotification } = await import('@/lib/notifications/pmf-send');
    await sendPmfNotification({
      kind: 'threshold_alert',
      trigger: 'marker_1_red',
      smsBody: 'PMF :: M1 RED',
      emailSubject: 'PMF alert — M1 red',
      emailReact: { type: 'div', props: {}, key: null } as unknown as React.ReactElement,
      inAppTitle: '// PMF — M1 RED',
      inAppBody: 'Marker 1 flipped red',
    });

    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    // No notifications row should have been inserted.
    const notif = callsFor('notifications').find((c) => c.method === 'insert');
    expect(notif).toBeUndefined();
    // No success/failure log row should have been written.
    expect(
      callsFor('pmf_notification_log').some((c) => c.method === 'insert')
    ).toBe(false);
  });

  it('does not treat prior failure rows as dedup hits', async () => {
    // A prior failure row exists in pmf_notification_log, but the dedup
    // query filters with `.is('error', null)` → returns empty → SMS fires.
    // The mock returns [] for the dedup SELECT, simulating the filtered
    // result (no successful prior sends in the window).
    sendSmsMock.mockResolvedValue({ sid: 'SM_after_failure' });
    resultQueue = [{ data: [], error: null }];

    const { sendPmfNotification } = await import('@/lib/notifications/pmf-send');
    await sendPmfNotification({
      kind: 'threshold_alert',
      trigger: 'marker_1_red',
      smsBody: 'PMF :: M1 RED',
    });

    // SMS must fire despite the hypothetical prior failure row.
    expect(sendSmsMock).toHaveBeenCalledTimes(1);

    // The dedup query must include `.is('error', null)` — this is the
    // filter that excludes failure rows from the dedup check.
    const dedupCalls = callsFor('pmf_notification_log');
    const isCall = dedupCalls.find(
      (c) => c.method === 'is' && c.args[0] === 'error' && c.args[1] === null
    );
    expect(isCall).toBeDefined();
  });
});

// ─── Tests: retry ───────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('succeeds on the 2nd attempt and returns the value', async () => {
    vi.useFakeTimers();
    const { withRetry } = await import('@/lib/notifications/pmf-send');

    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error('transient');
      return 42;
    });

    const p = withRetry(fn);
    // First failure → schedule a 1s wait → advance past it.
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await p;

    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts after 3 attempts and throws the last error with exponential 1s/5s delays', async () => {
    vi.useFakeTimers();
    const { withRetry } = await import('@/lib/notifications/pmf-send');

    const fn = vi.fn(async () => {
      throw new Error('permanent');
    });

    // Kick off retry loop; collect the rejection at the end.
    const p = withRetry(fn).catch((e) => e);

    // Attempt 1 runs synchronously → fails → schedule 1s.
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    // Attempt 2 fails → schedule 5s.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    // Attempt 3 is the last → no further delay, rejection propagates.
    const err = await p;
    expect(fn).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('permanent');
  });
});

// ─── Tests: logging ─────────────────────────────────────────────────────────

describe('sendPmfNotification — logging', () => {
  it('writes a success log row (sent_at populated, error null) when email send succeeds', async () => {
    sendTransactionalEmailMock.mockResolvedValue(undefined);
    // No prior dedup row.
    resultQueue = [{ data: [], error: null }];

    const { sendPmfNotification } = await import('@/lib/notifications/pmf-send');
    await sendPmfNotification({
      kind: 'daily_digest',
      trigger: '2026-04-22',
      emailSubject: '[OPS] Daily PMF digest',
      emailReact: { type: 'div', props: {}, key: null } as unknown as React.ReactElement,
    });

    const rows = logRowsFor('email');
    expect(rows.length).toBe(1);
    expect(rows[0].recipient).toBe('pmf@ops.test');
    expect(rows[0].error).toBeNull();
    expect(typeof rows[0].sent_at).toBe('string');
    expect(rows[0].sent_at).not.toBeNull();
    expect((rows[0].payload as Record<string, unknown>).subject).toBe(
      '[OPS] Daily PMF digest'
    );
  });

  it('writes a failure log row (sent_at null, error populated) when all SMS retries fail', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockRejectedValue(new Error('twilio down'));
    // No prior dedup row.
    resultQueue = [{ data: [], error: null }];

    const { sendPmfNotification } = await import('@/lib/notifications/pmf-send');
    const p = sendPmfNotification({
      kind: 'threshold_alert',
      trigger: 'marker_1_red',
      smsBody: 'PMF :: M1 RED',
    });

    // Drive retry delays: 1s + 5s = 6s between attempts.
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    vi.useRealTimers();

    expect(sendSmsMock).toHaveBeenCalledTimes(3);
    const rows = logRowsFor('sms');
    expect(rows.length).toBe(1);
    expect(rows[0].sent_at).toBeNull();
    expect(rows[0].error).toBe('twilio down');
    expect(rows[0].recipient).toBe('+15555550100');
  });
});

// ─── Tests: channel gating ──────────────────────────────────────────────────

describe('sendPmfNotification — channel gating', () => {
  it('daily_digest fires email only — no SMS, no in-app rail', async () => {
    sendTransactionalEmailMock.mockResolvedValue(undefined);
    resultQueue = [{ data: [], error: null }];

    const { sendPmfNotification } = await import('@/lib/notifications/pmf-send');
    await sendPmfNotification({
      kind: 'daily_digest',
      trigger: '2026-04-22',
      // Even if smsBody / inAppTitle are supplied, daily_digest must not fire them.
      smsBody: 'should be ignored',
      inAppTitle: 'should be ignored',
      emailSubject: 'Daily digest',
      emailReact: { type: 'div', props: {}, key: null } as unknown as React.ReactElement,
    });

    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);

    // No insert into `notifications` table.
    const railInserts = callsFor('notifications').filter(
      (c) => c.method === 'insert'
    );
    expect(railInserts.length).toBe(0);

    // Exactly one email log row, zero sms/in_app log rows.
    expect(logRowsFor('email').length).toBe(1);
    expect(logRowsFor('sms').length).toBe(0);
    expect(logRowsFor('in_app').length).toBe(0);
  });

  it('threshold_alert with all three fields fires SMS + email + in-app rail', async () => {
    sendSmsMock.mockResolvedValue({ sid: 'SM123' });
    sendTransactionalEmailMock.mockResolvedValue(undefined);
    resultQueue = [{ data: [], error: null }];

    const { sendPmfNotification } = await import('@/lib/notifications/pmf-send');
    await sendPmfNotification({
      kind: 'threshold_alert',
      trigger: 'marker_1_red',
      smsBody: 'PMF :: M1 RED',
      emailSubject: 'PMF alert — M1 red',
      emailReact: { type: 'div', props: {}, key: null } as unknown as React.ReactElement,
      inAppTitle: '// PMF — M1 RED',
      inAppBody: 'Marker 1 flipped red',
      inAppActionUrl: '/admin/pmf?marker=1',
    });

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).toHaveBeenCalledWith('+15555550100', 'PMF :: M1 RED');
    expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmailMock.mock.calls[0][0].to).toBe('pmf@ops.test');

    // In-app rail insert.
    const railInsert = callsFor('notifications').find(
      (c) => c.method === 'insert'
    );
    expect(railInsert).toBeDefined();
    const row = railInsert!.args[0] as Record<string, unknown>;
    expect(row.user_id).toBe('operator-uid');
    expect(row.company_id).toBe('ops-platform');
    expect(row.type).toBe('pmf_alert');
    expect(row.title).toBe('// PMF — M1 RED');
    expect(row.body).toBe('Marker 1 flipped red');
    expect(row.action_url).toBe('/admin/pmf?marker=1');
    expect(row.action_label).toBe('VIEW DECK');
    expect(row.persistent).toBe(false);
    expect(row.is_read).toBe(false);

    // One log row per channel.
    expect(logRowsFor('sms').length).toBe(1);
    expect(logRowsFor('email').length).toBe(1);
    expect(logRowsFor('in_app').length).toBe(1);
  });
});
