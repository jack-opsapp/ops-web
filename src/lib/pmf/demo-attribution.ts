import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isProductionAnalyticsRequest } from '@/lib/analytics/signup-attribution';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type DemoAttributionResult = { status: 'absent' | 'excluded' | 'staged' | 'already_staged' | 'attached' | 'already_attached' | 'rejected' | 'pending'; reason?: string };
const REASONS = new Set(['invalid_actor','invalid_token','expired_session','actor_already_staged','session_already_staged','existing_company','company_mismatch','ineligible_company','trial_before_demo','company_already_attributed','attribution_conflict','trial_not_ready']);
export function readDemoToken(header: string | null): string | null {
  const cookies = header?.split(';').map(v => v.trim()).filter(v => v.startsWith('__ops_demo=')) ?? [];
  if (cookies.length !== 1) return null;
  const token = cookies[0].slice('__ops_demo='.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function eligible(req: Request, actorId: string) {
  const excludedQuery = (value: string) => ['qa', 'preview', 'variant', 'ab_preview'].some(key => new URL(value).searchParams.has(key));
  return isProductionAnalyticsRequest(req) && UUID.test(actorId) &&
    !excludedQuery(req.url) && (!req.headers.get('referer') || !excludedQuery(req.headers.get('referer')!)) &&
    !/(?:bot|crawler|spider|headless|lighthouse|preview|monitor)/i.test(req.headers.get('user-agent') ?? '') &&
    !req.headers.get('x-ops-qa') && !req.headers.get('x-ops-internal') &&
    !/(?:^|;\s*)ops_qa=1(?:;|$)/.test(req.headers.get('cookie') ?? '');
}
async function call(db: SupabaseClient, operation: 'stage' | 'retry', args: Record<string, string>): Promise<DemoAttributionResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { data, error } = await Promise.race([
      db.rpc(operation === 'stage' ? 'stage_tryops_demo_signup' : 'retry_tryops_demo_trial', args).abortSignal(controller.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('storage_unavailable')); }, 1000); }),
    ]);
    if (error || !data || typeof data !== 'object') throw new Error('storage_unavailable');
    if (operation === 'stage' && ['staged','already_staged'].includes(data.status)) return { status: data.status };
    if (operation === 'retry' && ['attached','already_attached','absent'].includes(data.status)) return { status: data.status };
    if (data.status === 'rejected' && REASONS.has(data.reason)) return { status: 'rejected', reason: data.reason };
    if (data.status === 'pending' && data.reason === 'trial_not_ready') return { status: 'pending', reason: data.reason };
    throw new Error('invalid_response');
  } catch {
    console.error('[demo/attribution] recovery_required', { operation });
    return { status: 'pending', reason: 'storage_unavailable' };
  } finally { clearTimeout(timer); }
}
/** Called only after cryptographic account identity has been resolved and saved.
 * The hash/binding stays in service-only SQL, never user-editable setup_progress.
 */
export async function stageSignupDemo(db: SupabaseClient, req: Request, actorId: string): Promise<DemoAttributionResult> {
  if (!eligible(req, actorId)) return { status: 'excluded' };
  const token = readDemoToken(req.headers.get('cookie'));
  if (!token) return { status: 'absent' };
  const args = { p_token_hash: createHash('sha256').update(token).digest('hex'), p_actor_id: actorId };
  const result = await call(db, 'stage', args);
  if (result.reason === 'storage_unavailable') {
    const key = randomUUID();
    try {
      after(async () => {
        for (const delay of [100,300,700]) {
          await new Promise(resolve => setTimeout(resolve, delay));
          if ((await call(db, 'stage', args)).reason !== 'storage_unavailable') return;
        }
        // No durable promise can be made when every staging attempt failed.
        console.error('[demo/attribution] measurement_lost', { key, reason: 'staging_exhausted' });
      });
    } catch {
      console.error('[demo/attribution] measurement_lost', { key, reason: 'scheduler_unavailable' });
    }
  }
  return result;
}
/** No cookie needed after staging. SQL rechecks original times and owner/company
 * membership; it cannot create or duplicate a trial or an email claim.
 */
export async function retrySignupDemo(db: SupabaseClient, req: Request, actorId: string, companyId: string | null): Promise<DemoAttributionResult> {
  if (!eligible(req, actorId)) return { status: 'excluded' };
  if (!companyId || !UUID.test(companyId)) return { status: 'absent' };
  return call(db, 'retry', { p_actor_id: actorId, p_company_id: companyId });
}
