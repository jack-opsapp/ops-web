/* ── src/lib/admin/app-flow-queries.ts ── */

import { getAdminSupabase } from '@/lib/supabase/admin-client';
import type { FlowData, FlowNode, FlowEdge, FlowSummary } from './flow-types';
import type { AppEvent, AppFlowQueryParams } from './app-flow-types';

interface AppSession {
  id: string;
  device: string;
  pages: { name: string; dwellMs: number; clicks: { elementId: string }[] }[];
  completed: boolean; // had an action_complete event
}

export async function getAppFlowData(params: AppFlowQueryParams): Promise<FlowData> {
  const supabase = getAdminSupabase();

  const since = params.days >= 9999
    ? '2024-01-01T00:00:00Z'
    : new Date(Date.now() - params.days * 86_400_000).toISOString();

  let query = supabase
    .from('app_events')
    .select('session_id, event_type, page_name, feature_name, element_id, dwell_ms, device_type, timestamp')
    .gte('timestamp', since)
    .in('event_type', ['page_view', 'element_click', 'feature_use', 'action_complete'])
    .order('timestamp', { ascending: true });

  if (params.device !== 'all') {
    query = query.eq('device_type', params.device);
  }

  const { data: rawEvents } = await query;
  const events = (rawEvents ?? []) as AppEvent[];

  // Group by session
  const sessionMap = new Map<string, AppEvent[]>();
  for (const e of events) {
    const arr = sessionMap.get(e.session_id) ?? [];
    arr.push(e);
    sessionMap.set(e.session_id, arr);
  }

  // Reconstruct sessions
  const sessions: AppSession[] = [];
  for (const [id, evts] of sessionMap) {
    const pageViews = evts.filter(e => e.event_type === 'page_view');
    const clicks = evts.filter(e => e.event_type === 'element_click' || e.event_type === 'feature_use');
    const completed = evts.some(e => e.event_type === 'action_complete');
    const device = pageViews[0]?.device_type ?? 'unknown';

    const pages: AppSession['pages'] = [];
    for (const pv of pageViews) {
      if (!pv.page_name) continue;
      const pageClicks = clicks
        .filter(c => c.page_name === pv.page_name)
        .map(c => ({ elementId: c.element_id ?? c.feature_name ?? 'unknown' }));
      pages.push({
        name: pv.page_name,
        dwellMs: pv.dwell_ms ?? 0,
        clicks: pageClicks,
      });
    }

    sessions.push({ id, device, pages, completed });
  }

  const nodes = buildAppNodes(sessions);
  const edges = buildAppEdges(sessions);
  const summary = buildAppSummary(sessions);

  return {
    nodes,
    edges,
    summary,
    entryBreakdown: { utmSources: [], utmMediums: [], referrers: [], devices: [], directCount: 0 },
    conversionBreakdown: { lastSectionBeforeSignup: [], utmSources: [], devices: [], avgSectionsBeforeConversion: 0 },
  };
}

function buildAppNodes(sessions: AppSession[]): FlowNode[] {
  const total = sessions.length;
  const nodes: FlowNode[] = [];

  // Entry node (app launch)
  nodes.push({
    id: 'app-entry',
    type: 'entry',
    label: 'APP LAUNCH',
    views: total,
    avgDwellMs: 0,
    clicks: 0,
    clickBreakdown: [],
    dropoffCount: sessions.filter(s => s.pages.length === 0).length,
    dropoffRate: total > 0 ? sessions.filter(s => s.pages.length === 0).length / total : 0,
    conversionRate: 0,
    deviceBreakdown: [],
  });

  // Page nodes
  const pageStats = new Map<string, {
    views: number; totalDwell: number; clicks: Map<string, number>;
    dropoffs: number; completions: number; devices: Map<string, number>;
  }>();

  for (const session of sessions) {
    for (let i = 0; i < session.pages.length; i++) {
      const page = session.pages[i];
      const stats = pageStats.get(page.name) ?? {
        views: 0, totalDwell: 0, clicks: new Map(), dropoffs: 0, completions: 0, devices: new Map(),
      };
      stats.views++;
      stats.totalDwell += page.dwellMs;
      for (const click of page.clicks) {
        stats.clicks.set(click.elementId, (stats.clicks.get(click.elementId) ?? 0) + 1);
      }
      if (i === session.pages.length - 1 && !session.completed) stats.dropoffs++;
      if (session.completed) stats.completions++;
      stats.devices.set(session.device, (stats.devices.get(session.device) ?? 0) + 1);
      pageStats.set(page.name, stats);
    }
  }

  for (const [name, stats] of pageStats) {
    const totalClicks = Array.from(stats.clicks.values()).reduce((a, b) => a + b, 0);
    nodes.push({
      id: name,
      type: 'section',
      label: name.charAt(0).toUpperCase() + name.slice(1),
      views: stats.views,
      avgDwellMs: stats.views > 0 ? Math.round(stats.totalDwell / stats.views) : 0,
      clicks: totalClicks,
      clickBreakdown: Array.from(stats.clicks.entries())
        .map(([elementId, count]) => ({ elementId, count }))
        .sort((a, b) => b.count - a.count),
      dropoffCount: stats.dropoffs,
      dropoffRate: stats.views > 0 ? stats.dropoffs / stats.views : 0,
      conversionRate: stats.views > 0 ? stats.completions / stats.views : 0,
      deviceBreakdown: Array.from(stats.devices.entries())
        .map(([device, count]) => ({ device, count }))
        .sort((a, b) => b.count - a.count),
    });
  }

  // Completion node
  const completedSessions = sessions.filter(s => s.completed);
  nodes.push({
    id: 'app-completion',
    type: 'conversion',
    label: 'ACTION COMPLETE',
    views: completedSessions.length,
    avgDwellMs: 0,
    clicks: 0,
    clickBreakdown: [],
    dropoffCount: 0,
    dropoffRate: 0,
    conversionRate: total > 0 ? completedSessions.length / total : 0,
    deviceBreakdown: [],
  });

  return nodes;
}

function buildAppEdges(sessions: AppSession[]): FlowEdge[] {
  const edgeCounts = new Map<string, { count: number; completions: number }>();

  for (const session of sessions) {
    if (session.pages.length === 0) continue;

    // Entry → first page
    const firstKey = `app-entry->${session.pages[0].name}`;
    const firstE = edgeCounts.get(firstKey) ?? { count: 0, completions: 0 };
    firstE.count++;
    if (session.completed) firstE.completions++;
    edgeCounts.set(firstKey, firstE);

    // Page → page
    for (let i = 0; i < session.pages.length - 1; i++) {
      const from = session.pages[i].name;
      const to = session.pages[i + 1].name;
      if (from === to) continue;
      const key = `${from}->${to}`;
      const e = edgeCounts.get(key) ?? { count: 0, completions: 0 };
      e.count++;
      if (session.completed) e.completions++;
      edgeCounts.set(key, e);
    }

    // Last page → completion
    if (session.completed && session.pages.length > 0) {
      const lastPage = session.pages[session.pages.length - 1].name;
      const key = `${lastPage}->app-completion`;
      const e = edgeCounts.get(key) ?? { count: 0, completions: 0 };
      e.count++;
      e.completions++;
      edgeCounts.set(key, e);
    }
  }

  return Array.from(edgeCounts.entries()).map(([key, val]) => {
    const [source, target] = key.split('->');
    return { source, target, count: val.count, isConversionPath: val.completions > 0 };
  });
}

function buildAppSummary(sessions: AppSession[]): FlowSummary {
  const total = sessions.length;
  const bounced = sessions.filter(s => s.pages.length <= 1).length;
  const completed = sessions.filter(s => s.completed).length;
  const totalPages = sessions.reduce((sum, s) => sum + s.pages.length, 0);

  return {
    totalSessions: total,
    bounceRate: total > 0 ? bounced / total : 0,
    avgSectionsViewed: total > 0 ? Math.round((totalPages / total) * 10) / 10 : 0,
    conversionRate: total > 0 ? completed / total : 0,
    totalSignups: completed,
  };
}
