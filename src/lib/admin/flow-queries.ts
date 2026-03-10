import { getAdminSupabase } from '@/lib/supabase/admin-client'
import type {
  FlowData, FlowNode, FlowEdge, FlowSummary,
  EntryBreakdown, ConversionBreakdown, FlowQueryParams,
} from './flow-types'

interface RawEvent {
  session_id: string
  event_type: string
  section_name: string | null
  element_id: string | null
  dwell_ms: number | null
  device_type: string | null
  referrer: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  timestamp: string
}

interface Session {
  id: string
  device: string
  referrer: string | null
  utmSource: string | null
  utmMedium: string | null
  sections: { name: string; dwellMs: number; clicks: { elementId: string }[] }[]
  converted: boolean
  bounced: boolean
}

/**
 * Fetch ab_events and reconstruct user sessions into flow graph data.
 */
export async function getFlowData(params: FlowQueryParams): Promise<FlowData> {
  const supabase = getAdminSupabase()

  const since = params.days >= 9999
    ? '2024-01-01T00:00:00Z'
    : new Date(Date.now() - params.days * 86_400_000).toISOString()

  let query = supabase
    .from('ab_events')
    .select('session_id, event_type, section_name, element_id, dwell_ms, device_type, referrer, utm_source, utm_medium, utm_campaign, timestamp')
    .gte('timestamp', since)
    .in('event_type', ['page_view', 'section_view', 'element_click', 'signup_complete'])
    .order('timestamp', { ascending: true })

  if (params.variant !== 'all') {
    query = query.eq('variant_id', params.variant)
  }

  if (params.device !== 'all') {
    query = query.eq('device_type', params.device)
  }

  const { data: rawEvents } = await query
  const events = (rawEvents ?? []) as RawEvent[]

  // Group events by session
  const sessionMap = new Map<string, RawEvent[]>()
  for (const e of events) {
    const arr = sessionMap.get(e.session_id) ?? []
    arr.push(e)
    sessionMap.set(e.session_id, arr)
  }

  // Reconstruct sessions
  const sessions: Session[] = []
  for (const [id, evts] of sessionMap) {
    const pageView = evts.find(e => e.event_type === 'page_view')
    const sectionViews = evts.filter(e => e.event_type === 'section_view')
    const clicks = evts.filter(e => e.event_type === 'element_click')
    const converted = evts.some(e => e.event_type === 'signup_complete')
    const bounced = sectionViews.length === 0

    const sectionSequence: Session['sections'] = []
    for (const sv of sectionViews) {
      if (!sv.section_name) continue
      const sectionClicks = clicks
        .filter(c => c.section_name === sv.section_name)
        .map(c => ({ elementId: c.element_id ?? 'unknown' }))
      sectionSequence.push({
        name: sv.section_name,
        dwellMs: sv.dwell_ms ?? 0,
        clicks: sectionClicks,
      })
    }

    sessions.push({
      id,
      device: pageView?.device_type ?? 'unknown',
      referrer: pageView?.referrer ?? null,
      utmSource: pageView?.utm_source ?? null,
      utmMedium: pageView?.utm_medium ?? null,
      sections: sectionSequence,
      converted,
      bounced,
    })
  }

  const nodes = buildNodes(sessions)
  const edges = buildEdges(sessions)
  const summary = buildSummary(sessions)
  const entryBreakdown = buildEntryBreakdown(sessions)
  const conversionBreakdown = buildConversionBreakdown(sessions)

  return { nodes, edges, summary, entryBreakdown, conversionBreakdown }
}

function buildNodes(sessions: Session[]): FlowNode[] {
  const totalSessions = sessions.length
  const nodes: FlowNode[] = []

  // Entry node
  nodes.push({
    id: 'entry',
    type: 'entry',
    label: 'LANDING',
    views: totalSessions,
    avgDwellMs: 0,
    clicks: 0,
    clickBreakdown: [],
    dropoffCount: sessions.filter(s => s.bounced).length,
    dropoffRate: totalSessions > 0 ? sessions.filter(s => s.bounced).length / totalSessions : 0,
    conversionRate: 0,
    deviceBreakdown: [],
  })

  // Section nodes
  const sectionStats = new Map<string, {
    views: number; totalDwell: number; clicks: Map<string, number>;
    dropoffs: number; conversions: number;
    devices: Map<string, number>
  }>()

  for (const session of sessions) {
    for (let i = 0; i < session.sections.length; i++) {
      const sec = session.sections[i]
      const stats = sectionStats.get(sec.name) ?? {
        views: 0, totalDwell: 0, clicks: new Map(), dropoffs: 0, conversions: 0, devices: new Map()
      }

      stats.views++
      stats.totalDwell += sec.dwellMs
      for (const click of sec.clicks) {
        stats.clicks.set(click.elementId, (stats.clicks.get(click.elementId) ?? 0) + 1)
      }

      if (i === session.sections.length - 1 && !session.converted) {
        stats.dropoffs++
      }

      if (session.converted) {
        stats.conversions++
      }

      stats.devices.set(session.device, (stats.devices.get(session.device) ?? 0) + 1)
      sectionStats.set(sec.name, stats)
    }
  }

  for (const [name, stats] of sectionStats) {
    const totalClicks = Array.from(stats.clicks.values()).reduce((a, b) => a + b, 0)
    nodes.push({
      id: name,
      type: 'section',
      label: name,
      views: stats.views,
      avgDwellMs: stats.views > 0 ? Math.round(stats.totalDwell / stats.views) : 0,
      clicks: totalClicks,
      clickBreakdown: Array.from(stats.clicks.entries())
        .map(([elementId, count]) => ({ elementId, count }))
        .sort((a, b) => b.count - a.count),
      dropoffCount: stats.dropoffs,
      dropoffRate: stats.views > 0 ? stats.dropoffs / stats.views : 0,
      conversionRate: stats.views > 0 ? stats.conversions / stats.views : 0,
      deviceBreakdown: Array.from(stats.devices.entries())
        .map(([device, count]) => ({ device, count }))
        .sort((a, b) => b.count - a.count),
    })
  }

  // Conversion node
  const convertedSessions = sessions.filter(s => s.converted)
  nodes.push({
    id: 'signup',
    type: 'conversion',
    label: 'SIGNED UP',
    views: convertedSessions.length,
    avgDwellMs: 0,
    clicks: 0,
    clickBreakdown: [],
    dropoffCount: 0,
    dropoffRate: 0,
    conversionRate: totalSessions > 0 ? convertedSessions.length / totalSessions : 0,
    deviceBreakdown: [],
  })

  return nodes
}

function buildEdges(sessions: Session[]): FlowEdge[] {
  const edgeCounts = new Map<string, { count: number; conversions: number }>()

  for (const session of sessions) {
    if (session.bounced) continue

    // Entry → first section
    if (session.sections.length > 0) {
      const key = `entry->${session.sections[0].name}`
      const e = edgeCounts.get(key) ?? { count: 0, conversions: 0 }
      e.count++
      if (session.converted) e.conversions++
      edgeCounts.set(key, e)
    }

    // Section → section transitions
    for (let i = 0; i < session.sections.length - 1; i++) {
      const from = session.sections[i].name
      const to = session.sections[i + 1].name
      if (from === to) continue
      const key = `${from}->${to}`
      const e = edgeCounts.get(key) ?? { count: 0, conversions: 0 }
      e.count++
      if (session.converted) e.conversions++
      edgeCounts.set(key, e)
    }

    // Last section → signup (if converted)
    if (session.converted && session.sections.length > 0) {
      const lastSection = session.sections[session.sections.length - 1].name
      const key = `${lastSection}->signup`
      const e = edgeCounts.get(key) ?? { count: 0, conversions: 0 }
      e.count++
      e.conversions++
      edgeCounts.set(key, e)
    }
  }

  return Array.from(edgeCounts.entries()).map(([key, val]) => {
    const [source, target] = key.split('->')
    return {
      source,
      target,
      count: val.count,
      isConversionPath: val.conversions > 0,
    }
  })
}

function buildSummary(sessions: Session[]): FlowSummary {
  const total = sessions.length
  const bounced = sessions.filter(s => s.bounced).length
  const converted = sessions.filter(s => s.converted).length
  const totalSectionsViewed = sessions.reduce((sum, s) => sum + s.sections.length, 0)

  return {
    totalSessions: total,
    bounceRate: total > 0 ? bounced / total : 0,
    avgSectionsViewed: total > 0 ? Math.round((totalSectionsViewed / total) * 10) / 10 : 0,
    conversionRate: total > 0 ? converted / total : 0,
    totalSignups: converted,
  }
}

function buildEntryBreakdown(sessions: Session[]): EntryBreakdown {
  const utmSources = new Map<string, number>()
  const utmMediums = new Map<string, number>()
  const referrers = new Map<string, number>()
  const devices = new Map<string, number>()
  let directCount = 0

  for (const s of sessions) {
    if (s.utmSource) {
      utmSources.set(s.utmSource, (utmSources.get(s.utmSource) ?? 0) + 1)
    }
    if (s.utmMedium) {
      utmMediums.set(s.utmMedium, (utmMediums.get(s.utmMedium) ?? 0) + 1)
    }
    if (s.referrer) {
      try {
        const domain = new URL(s.referrer).hostname
        referrers.set(domain, (referrers.get(domain) ?? 0) + 1)
      } catch {
        referrers.set(s.referrer, (referrers.get(s.referrer) ?? 0) + 1)
      }
    }
    if (!s.utmSource && !s.referrer) {
      directCount++
    }
    devices.set(s.device, (devices.get(s.device) ?? 0) + 1)
  }

  const toSorted = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

  return {
    utmSources: toSorted(utmSources),
    utmMediums: toSorted(utmMediums),
    referrers: toSorted(referrers),
    devices: toSorted(devices),
    directCount,
  }
}

function buildConversionBreakdown(sessions: Session[]): ConversionBreakdown {
  const converted = sessions.filter(s => s.converted)
  const lastSections = new Map<string, number>()
  const utmSources = new Map<string, number>()
  const devices = new Map<string, number>()
  let totalSectionsBeforeConversion = 0

  for (const s of converted) {
    if (s.sections.length > 0) {
      const last = s.sections[s.sections.length - 1].name
      lastSections.set(last, (lastSections.get(last) ?? 0) + 1)
    }
    if (s.utmSource) {
      utmSources.set(s.utmSource, (utmSources.get(s.utmSource) ?? 0) + 1)
    }
    devices.set(s.device, (devices.get(s.device) ?? 0) + 1)
    totalSectionsBeforeConversion += s.sections.length
  }

  const toSorted = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

  return {
    lastSectionBeforeSignup: toSorted(lastSections),
    utmSources: toSorted(utmSources),
    devices: toSorted(devices),
    avgSectionsBeforeConversion: converted.length > 0
      ? Math.round((totalSectionsBeforeConversion / converted.length) * 10) / 10
      : 0,
  }
}
