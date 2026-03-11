# Analytics Flow Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive node-based flow visualization showing user journeys through the landing page, with session reconstruction from ab_events data.

**Architecture:** Server-side API endpoint reconstructs sessions from Supabase ab_events, computes transition counts between sections, and returns graph data. Client renders with React Flow (@xyflow/react) using custom nodes/edges. Detail panel slides in on node click. Filters for time range, device, and variant.

**Tech Stack:** Next.js 14, TypeScript, @xyflow/react, recharts (existing), TanStack Query (existing), Supabase via getAdminSupabase()

**Spec:** `C:\OPS\try-ops\docs\superpowers\specs\2026-03-10-analytics-flow-dashboard-design.md`

---

## File Structure

```
src/lib/admin/
  flow-types.ts              — TypeScript types for flow API response
  flow-queries.ts            — Supabase queries + session reconstruction logic

src/app/api/admin/analytics/
  flow/route.ts              — GET endpoint, auth-protected, returns FlowData

src/app/admin/analytics/flow/
  page.tsx                   — Server component shell (header + error boundary)
  _components/
    flow-dashboard.tsx       — Client orchestrator (filters, canvas, detail panel, summary)
    flow-canvas.tsx          — React Flow canvas with layout computation
    flow-controls.tsx        — Time range + device + variant filter bar
    flow-summary-strip.tsx   — Bottom KPI strip
    detail-panel.tsx         — Slide-in panel on node click
    nodes/
      entry-node.tsx         — Custom node: landing sources (green left border)
      section-node.tsx       — Custom node: landing page section
      conversion-node.tsx    — Custom node: signup conversions (accent border)
      dropoff-node.tsx       — Custom node: users who left
    edges/
      flow-edge.tsx          — Custom animated directional edge
      dropoff-edge.tsx       — Red fade-out edge for dropoffs
```

**Modifications to existing files:**
- `src/app/admin/analytics/_components/analytics-content.tsx` — Add "User Flow" tab link
- `src/app/admin/_components/sidebar.tsx` — No change needed (analytics already in nav)

---

## Chunk 1: Foundation (Types + Queries + API)

### Task 1: Install @xyflow/react

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
cd /c/OPS/ops-web && npm install @xyflow/react
```

- [ ] **Step 2: Verify installation**

```bash
cd /c/OPS/ops-web && node -e "require('@xyflow/react'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add package.json package-lock.json && git commit -m "chore: add @xyflow/react for analytics flow dashboard"
```

---

### Task 2: Create flow types

**Files:**
- Create: `src/lib/admin/flow-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/admin/flow-types.ts

export interface FlowNode {
  id: string                 // 'entry' | 'signup' | section name
  type: 'entry' | 'section' | 'conversion' | 'dropoff'
  label: string
  views: number
  avgDwellMs: number
  clicks: number
  clickBreakdown: { elementId: string; count: number }[]
  dropoffCount: number
  dropoffRate: number        // 0-1
  conversionRate: number     // 0-1, % of viewers who eventually signed up
  deviceBreakdown: { device: string; count: number }[]
}

export interface FlowEdge {
  source: string
  target: string
  count: number
  isConversionPath: boolean  // true if this edge is on a path that led to signup
}

export interface FlowSummary {
  totalSessions: number
  bounceRate: number         // 0-1
  avgSectionsViewed: number
  conversionRate: number     // 0-1
  totalSignups: number
}

export interface EntryBreakdown {
  utmSources: { name: string; count: number }[]
  utmMediums: { name: string; count: number }[]
  referrers: { name: string; count: number }[]
  devices: { name: string; count: number }[]
  directCount: number
}

export interface ConversionBreakdown {
  lastSectionBeforeSignup: { name: string; count: number }[]
  utmSources: { name: string; count: number }[]
  devices: { name: string; count: number }[]
  avgSectionsBeforeConversion: number
}

export interface FlowData {
  nodes: FlowNode[]
  edges: FlowEdge[]
  summary: FlowSummary
  entryBreakdown: EntryBreakdown
  conversionBreakdown: ConversionBreakdown
}

export interface FlowQueryParams {
  days: number               // 7 | 30 | 90 | 9999 (all)
  device: string             // 'all' | 'mobile' | 'tablet' | 'desktop'
  variant: string            // 'all' | variant UUID
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit src/lib/admin/flow-types.ts 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add src/lib/admin/flow-types.ts && git commit -m "feat(flow): add TypeScript types for flow dashboard data"
```

---

### Task 3: Create flow queries (session reconstruction)

**Files:**
- Create: `src/lib/admin/flow-queries.ts`

This is the core logic. It fetches all ab_events for the time range, groups by session_id, reconstructs each user journey, then computes node metrics and edge transition counts.

**Important context:**
- Supabase client: `getAdminSupabase()` from `src/lib/supabase/admin-client.ts` (service role, server-only)
- Table: `ab_events` with columns: `id`, `variant_id`, `session_id`, `event_type`, `section_name`, `element_id`, `dwell_ms`, `value`, `device_type`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `timestamp`
- Event types: `page_view`, `section_view`, `element_click`, `signup_complete`, `signup_start`, `scroll_depth`, `app_store_click`
- Session = all events sharing the same `session_id`
- A session "converted" if it contains a `signup_complete` event
- A session "bounced" if it only has a `page_view` and no `section_view`
- Section order within a session is determined by `timestamp`
- Transitions: consecutive section_view events within a session (Hero→PainSection = one transition)

- [ ] **Step 1: Create the queries file**

```typescript
// src/lib/admin/flow-queries.ts

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

  // Calculate date filter
  const since = params.days >= 9999
    ? '2024-01-01T00:00:00Z'
    : new Date(Date.now() - params.days * 86_400_000).toISOString()

  // Fetch all relevant events
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

    // Build section sequence with clicks attached
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

  // Compute nodes
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

      // Dropoff: last section viewed and didn't convert
      if (i === session.sections.length - 1 && !session.converted) {
        stats.dropoffs++
      }

      // Conversion contribution: user saw this section and converted
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
      if (from === to) continue // skip duplicate section views
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
      // Simplify referrer to domain
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit src/lib/admin/flow-queries.ts 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add src/lib/admin/flow-queries.ts && git commit -m "feat(flow): session reconstruction and flow graph computation from ab_events"
```

---

### Task 4: Create API endpoint

**Files:**
- Create: `src/app/api/admin/analytics/flow/route.ts`

**Context:**
- Auth pattern: use `verifyAdminAuth(req)` from `src/lib/firebase/admin-verify.ts` + `isAdminEmail()` from `src/lib/admin/admin-queries.ts`
- Response: JSON with FlowData
- Query params: `days`, `device`, `variant`

- [ ] **Step 1: Create the route**

```typescript
// src/app/api/admin/analytics/flow/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminAuth } from '@/lib/firebase/admin-verify'
import { isAdminEmail } from '@/lib/admin/admin-queries'
import { getFlowData } from '@/lib/admin/flow-queries'
import type { FlowQueryParams } from '@/lib/admin/flow-types'

export async function GET(req: NextRequest) {
  const user = await verifyAdminAuth(req)
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const params: FlowQueryParams = {
    days: parseInt(url.searchParams.get('days') ?? '30', 10),
    device: url.searchParams.get('device') ?? 'all',
    variant: url.searchParams.get('variant') ?? 'all',
  }

  // Validate days param
  if (![7, 30, 90, 9999].includes(params.days)) {
    params.days = 30
  }

  try {
    const data = await getFlowData(params)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[flow-api]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit src/app/api/admin/analytics/flow/route.ts 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/api/admin/analytics/flow/route.ts && git commit -m "feat(flow): add GET /api/admin/analytics/flow endpoint"
```

---

## Chunk 2: Custom React Flow Nodes & Edges

### Task 5: Create custom nodes

**Files:**
- Create: `src/app/admin/analytics/flow/_components/nodes/entry-node.tsx`
- Create: `src/app/admin/analytics/flow/_components/nodes/section-node.tsx`
- Create: `src/app/admin/analytics/flow/_components/nodes/conversion-node.tsx`
- Create: `src/app/admin/analytics/flow/_components/nodes/dropoff-node.tsx`

**Context:**
- React Flow custom nodes receive `data` prop with our FlowNode fields
- Must use `Handle` from `@xyflow/react` for edge connection points
- Design system: `bg-white/[0.02]`, `border-white/[0.08]`, Mohave uppercase, Kosugi captions, no shadows, 4px border-radius
- Entry node: green left border `#4A7C59`
- Conversion node: accent border `#597794`
- Dropoff node: red-tinted `#7C4A4A`
- Section node: default borders, size reflects traffic relative to total

- [ ] **Step 1: Create entry-node.tsx**

```typescript
// src/app/admin/analytics/flow/_components/nodes/entry-node.tsx
'use client'

import { Handle, Position } from '@xyflow/react'
import type { FlowNode } from '@/lib/admin/flow-types'

interface EntryNodeProps {
  data: FlowNode & { onClick: (nodeId: string) => void }
}

export function EntryNode({ data }: EntryNodeProps) {
  return (
    <div
      className="relative px-5 py-4 min-w-[160px] border border-white/[0.08] rounded bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] hover:border-white/[0.12] transition-colors"
      style={{ borderLeftWidth: 3, borderLeftColor: '#4A7C59' }}
      onClick={() => data.onClick(data.id)}
    >
      <p className="font-mohave text-[11px] uppercase tracking-wider text-[#6B6B6B] mb-1">
        {data.label}
      </p>
      <p className="font-mohave text-[28px] font-semibold text-[#E5E5E5] leading-none">
        {data.views.toLocaleString()}
      </p>
      <p className="font-kosugi text-[10px] text-[#6B6B6B] mt-1">
        [{data.dropoffRate > 0 ? `${Math.round(data.dropoffRate * 100)}% bounced` : 'sessions'}]
      </p>
      <Handle type="source" position={Position.Right} className="!bg-[#4A7C59] !w-2 !h-2 !border-0" />
    </div>
  )
}
```

- [ ] **Step 2: Create section-node.tsx**

```typescript
// src/app/admin/analytics/flow/_components/nodes/section-node.tsx
'use client'

import { Handle, Position } from '@xyflow/react'
import type { FlowNode } from '@/lib/admin/flow-types'

interface SectionNodeProps {
  data: FlowNode & { onClick: (nodeId: string) => void; maxViews: number }
}

export function SectionNode({ data }: SectionNodeProps) {
  const dwellSec = (data.avgDwellMs / 1000).toFixed(1)
  const opacity = data.maxViews > 0 ? 0.3 + 0.7 * (data.views / data.maxViews) : 1

  return (
    <div
      className="relative px-4 py-3 min-w-[180px] border border-white/[0.08] rounded bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] hover:border-white/[0.12] transition-colors"
      style={{ opacity }}
      onClick={() => data.onClick(data.id)}
    >
      <p className="font-mohave text-[11px] uppercase tracking-wider text-[#E5E5E5] mb-2">
        {data.label}
      </p>
      <div className="flex items-baseline gap-3">
        <div>
          <p className="font-mohave text-[20px] font-semibold text-[#E5E5E5] leading-none">
            {data.views.toLocaleString()}
          </p>
          <p className="font-kosugi text-[9px] text-[#6B6B6B] mt-0.5">[views]</p>
        </div>
        <div>
          <p className="font-mohave text-[14px] text-[#A0A0A0] leading-none">
            {dwellSec}s
          </p>
          <p className="font-kosugi text-[9px] text-[#6B6B6B] mt-0.5">[dwell]</p>
        </div>
        {data.clicks > 0 && (
          <div>
            <p className="font-mohave text-[14px] text-[#A0A0A0] leading-none">
              {data.clicks}
            </p>
            <p className="font-kosugi text-[9px] text-[#6B6B6B] mt-0.5">[clicks]</p>
          </div>
        )}
      </div>

      {data.dropoffRate > 0.05 && (
        <div className="mt-2 flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#7C4A4A]" />
          <p className="font-kosugi text-[9px] text-[#7C4A4A]">
            {Math.round(data.dropoffRate * 100)}% dropped
          </p>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="!bg-white/20 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-white/20 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} id="dropoff" className="!bg-[#7C4A4A] !w-2 !h-2 !border-0" />
    </div>
  )
}
```

- [ ] **Step 3: Create conversion-node.tsx**

```typescript
// src/app/admin/analytics/flow/_components/nodes/conversion-node.tsx
'use client'

import { Handle, Position } from '@xyflow/react'
import type { FlowNode } from '@/lib/admin/flow-types'

interface ConversionNodeProps {
  data: FlowNode & { onClick: (nodeId: string) => void }
}

export function ConversionNode({ data }: ConversionNodeProps) {
  return (
    <div
      className="relative px-5 py-4 min-w-[160px] border rounded bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] transition-colors"
      style={{ borderColor: '#597794', borderWidth: 1, boxShadow: '0 0 20px rgba(89,119,148,0.15)' }}
      onClick={() => data.onClick(data.id)}
    >
      <p className="font-mohave text-[11px] uppercase tracking-wider text-[#597794] mb-1">
        {data.label}
      </p>
      <p className="font-mohave text-[28px] font-semibold text-[#E5E5E5] leading-none">
        {data.views.toLocaleString()}
      </p>
      <p className="font-kosugi text-[10px] text-[#6B6B6B] mt-1">
        [{(data.conversionRate * 100).toFixed(1)}% conversion rate]
      </p>
      <Handle type="target" position={Position.Left} className="!bg-[#597794] !w-2 !h-2 !border-0" />
    </div>
  )
}
```

- [ ] **Step 4: Create dropoff-node.tsx**

```typescript
// src/app/admin/analytics/flow/_components/nodes/dropoff-node.tsx
'use client'

import { Handle, Position } from '@xyflow/react'

interface DropoffNodeProps {
  data: { count: number; rate: number; sectionName: string }
}

export function DropoffNode({ data }: DropoffNodeProps) {
  return (
    <div className="px-3 py-2 min-w-[80px] opacity-60">
      <p className="font-mohave text-[14px] text-[#7C4A4A] leading-none">
        {data.count}
      </p>
      <p className="font-kosugi text-[9px] text-[#7C4A4A]/60 mt-0.5">
        [{Math.round(data.rate * 100)}% left]
      </p>
      <Handle type="target" position={Position.Top} className="!bg-[#7C4A4A] !w-2 !h-2 !border-0" />
    </div>
  )
}
```

- [ ] **Step 5: Verify TypeScript compiles for all node files**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit src/app/admin/analytics/flow/_components/nodes/*.tsx 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/flow/_components/nodes/ && git commit -m "feat(flow): custom React Flow nodes — entry, section, conversion, dropoff"
```

---

### Task 6: Create custom edges

**Files:**
- Create: `src/app/admin/analytics/flow/_components/edges/flow-edge.tsx`
- Create: `src/app/admin/analytics/flow/_components/edges/dropoff-edge.tsx`

- [ ] **Step 1: Create flow-edge.tsx**

```typescript
// src/app/admin/analytics/flow/_components/edges/flow-edge.tsx
'use client'

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

interface FlowEdgeData {
  count: number
  isConversionPath: boolean
  maxCount: number
}

export function FlowEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data,
}: EdgeProps<FlowEdgeData>) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  })

  const count = data?.count ?? 0
  const maxCount = data?.maxCount ?? 1
  const isConversion = data?.isConversionPath ?? false

  // Thickness: 1-6px proportional to count
  const strokeWidth = Math.max(1, Math.min(6, 1 + 5 * (count / maxCount)))
  const stroke = isConversion ? '#597794' : 'rgba(255,255,255,0.15)'
  const opacity = isConversion ? 0.8 : 0.4 + 0.4 * (count / maxCount)

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth,
          opacity,
          fill: 'none',
        }}
      />
      {/* Count label at midpoint */}
      <text
        x={(sourceX + targetX) / 2}
        y={(sourceY + targetY) / 2 - 8}
        textAnchor="middle"
        className="fill-[#6B6B6B] font-kosugi"
        style={{ fontSize: 9 }}
      >
        {count}
      </text>
    </>
  )
}
```

- [ ] **Step 2: Create dropoff-edge.tsx**

```typescript
// src/app/admin/analytics/flow/_components/edges/dropoff-edge.tsx
'use client'

import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react'

export function DropoffEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
}: EdgeProps) {
  const [edgePath] = getStraightPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  })

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: '#7C4A4A',
        strokeWidth: 1,
        opacity: 0.4,
        strokeDasharray: '4 4',
        fill: 'none',
      }}
    />
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit src/app/admin/analytics/flow/_components/edges/*.tsx 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/flow/_components/edges/ && git commit -m "feat(flow): custom React Flow edges — flow transitions and dropoff indicators"
```

---

## Chunk 3: Dashboard Components

### Task 7: Create flow controls (filter bar)

**Files:**
- Create: `src/app/admin/analytics/flow/_components/flow-controls.tsx`

**Context:**
- Reuse the pill-button styling from `src/app/admin/_components/date-range-control.tsx`
- Time ranges: 7D, 30D, 90D, All
- Device filter: All, Mobile, Tablet, Desktop
- Variant filter: All, or specific variant UUIDs (fetched from active test)

- [ ] **Step 1: Create flow-controls.tsx**

```typescript
// src/app/admin/analytics/flow/_components/flow-controls.tsx
'use client'

import { useCallback } from 'react'
import type { FlowQueryParams } from '@/lib/admin/flow-types'

const TIME_OPTIONS = [
  { key: 7, label: '7D' },
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
  { key: 9999, label: 'ALL' },
] as const

const DEVICE_OPTIONS = ['all', 'mobile', 'tablet', 'desktop'] as const

interface FlowControlsProps {
  params: FlowQueryParams
  onChange: (params: FlowQueryParams) => void
  variants?: { id: string; label: string }[]
}

export function FlowControls({ params, onChange, variants }: FlowControlsProps) {
  const pill = useCallback(
    (active: boolean) =>
      `px-3 py-1 rounded-full font-mohave text-[12px] uppercase tracking-wider transition-colors ${
        active
          ? 'bg-[#597794]/20 text-[#597794]'
          : 'bg-white/[0.06] text-[#6B6B6B] hover:text-[#A0A0A0] hover:bg-white/[0.08]'
      }`,
    []
  )

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Time range */}
      <div className="flex items-center gap-1">
        {TIME_OPTIONS.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange({ ...params, days: t.key })}
            className={pill(params.days === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-white/[0.08]" />

      {/* Device filter */}
      <div className="flex items-center gap-1">
        {DEVICE_OPTIONS.map((d) => (
          <button
            key={d}
            onClick={() => onChange({ ...params, device: d })}
            className={pill(params.device === d)}
          >
            {d === 'all' ? 'ALL DEVICES' : d.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Variant filter */}
      {variants && variants.length > 0 && (
        <>
          <div className="w-px h-4 bg-white/[0.08]" />
          <div className="flex items-center gap-1">
            <button
              onClick={() => onChange({ ...params, variant: 'all' })}
              className={pill(params.variant === 'all')}
            >
              ALL VARIANTS
            </button>
            {variants.map((v) => (
              <button
                key={v.id}
                onClick={() => onChange({ ...params, variant: v.id })}
                className={pill(params.variant === v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/flow/_components/flow-controls.tsx && git commit -m "feat(flow): filter bar — time range, device, variant pills"
```

---

### Task 8: Create summary strip

**Files:**
- Create: `src/app/admin/analytics/flow/_components/flow-summary-strip.tsx`

- [ ] **Step 1: Create flow-summary-strip.tsx**

```typescript
// src/app/admin/analytics/flow/_components/flow-summary-strip.tsx
'use client'

import type { FlowSummary } from '@/lib/admin/flow-types'

interface FlowSummaryStripProps {
  summary: FlowSummary
}

export function FlowSummaryStrip({ summary }: FlowSummaryStripProps) {
  const metrics = [
    { label: 'SESSIONS', value: summary.totalSessions.toLocaleString() },
    { label: 'BOUNCE RATE', value: `${Math.round(summary.bounceRate * 100)}%` },
    { label: 'AVG SECTIONS', value: String(summary.avgSectionsViewed) },
    { label: 'SIGNUPS', value: summary.totalSignups.toLocaleString() },
    { label: 'CONVERSION', value: `${(summary.conversionRate * 100).toFixed(1)}%` },
  ]

  return (
    <div className="flex items-center gap-6 px-6 py-3 border-t border-white/[0.08] bg-white/[0.02]">
      {metrics.map((m) => (
        <div key={m.label} className="flex items-baseline gap-2">
          <span className="font-kosugi text-[10px] text-[#6B6B6B] uppercase tracking-wider">
            {m.label}
          </span>
          <span className="font-mohave text-[16px] font-semibold text-[#E5E5E5]">
            {m.value}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/flow/_components/flow-summary-strip.tsx && git commit -m "feat(flow): summary strip with KPI metrics"
```

---

### Task 9: Create detail panel

**Files:**
- Create: `src/app/admin/analytics/flow/_components/detail-panel.tsx`

**Context:**
- Slides in from right edge of screen
- Shows different content for entry/section/conversion nodes
- Uses recharts HorizontalBarChart pattern from admin (see `src/app/admin/_components/charts/horizontal-bar-chart.tsx`)
- Animation: 250ms ease [0.22, 1, 0.36, 1]

- [ ] **Step 1: Create detail-panel.tsx**

```typescript
// src/app/admin/analytics/flow/_components/detail-panel.tsx
'use client'

import { useEffect, useRef } from 'react'
import type { FlowNode, EntryBreakdown, ConversionBreakdown } from '@/lib/admin/flow-types'

interface DetailPanelProps {
  node: FlowNode | null
  entryBreakdown?: EntryBreakdown
  conversionBreakdown?: ConversionBreakdown
  onClose: () => void
}

export function DetailPanel({ node, entryBreakdown, conversionBreakdown, onClose }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!node) return null

  return (
    <div
      ref={panelRef}
      className="absolute top-0 right-0 w-[360px] h-full border-l border-white/[0.08] bg-[#0D0D0D] overflow-y-auto z-10"
      style={{
        animation: 'slideInRight 250ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
        <h3 className="font-mohave text-[16px] font-semibold uppercase text-[#E5E5E5]">
          {node.label}
        </h3>
        <button
          onClick={onClose}
          className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors font-mohave text-[14px]"
        >
          CLOSE
        </button>
      </div>

      <div className="p-5 space-y-6">
        {node.type === 'entry' && entryBreakdown && (
          <EntryDetails breakdown={entryBreakdown} totalSessions={node.views} />
        )}
        {node.type === 'section' && <SectionDetails node={node} />}
        {node.type === 'conversion' && conversionBreakdown && (
          <ConversionDetails breakdown={conversionBreakdown} totalSignups={node.views} />
        )}
      </div>
    </div>
  )
}

function EntryDetails({ breakdown, totalSessions }: { breakdown: EntryBreakdown; totalSessions: number }) {
  return (
    <>
      <MetricRow label="TOTAL SESSIONS" value={totalSessions.toLocaleString()} />
      <MetricRow label="DIRECT TRAFFIC" value={breakdown.directCount.toLocaleString()} />
      <BarList title="UTM SOURCES" items={breakdown.utmSources} total={totalSessions} />
      <BarList title="UTM MEDIUMS" items={breakdown.utmMediums} total={totalSessions} />
      <BarList title="REFERRERS" items={breakdown.referrers} total={totalSessions} />
      <BarList title="DEVICES" items={breakdown.devices} total={totalSessions} />
    </>
  )
}

function SectionDetails({ node }: { node: FlowNode }) {
  const dwellSec = (node.avgDwellMs / 1000).toFixed(1)

  return (
    <>
      <MetricRow label="VIEWS" value={node.views.toLocaleString()} />
      <MetricRow label="AVG DWELL" value={`${dwellSec}s`} />
      <MetricRow label="CLICKS" value={node.clicks.toLocaleString()} />
      <MetricRow label="DROPOFF RATE" value={`${Math.round(node.dropoffRate * 100)}%`} accent={node.dropoffRate > 0.3 ? 'danger' : undefined} />
      <MetricRow label="CONVERSION RATE" value={`${(node.conversionRate * 100).toFixed(1)}%`} accent={node.conversionRate > 0 ? 'accent' : undefined} />

      {node.clickBreakdown.length > 0 && (
        <BarList
          title="CLICK BREAKDOWN"
          items={node.clickBreakdown.map(c => ({ name: c.elementId, count: c.count }))}
          total={node.clicks}
        />
      )}

      {node.deviceBreakdown.length > 0 && (
        <BarList
          title="DEVICES"
          items={node.deviceBreakdown.map(d => ({ name: d.device, count: d.count }))}
          total={node.views}
        />
      )}
    </>
  )
}

function ConversionDetails({ breakdown, totalSignups }: { breakdown: ConversionBreakdown; totalSignups: number }) {
  return (
    <>
      <MetricRow label="TOTAL SIGNUPS" value={totalSignups.toLocaleString()} />
      <MetricRow label="AVG SECTIONS VIEWED" value={String(breakdown.avgSectionsBeforeConversion)} />
      <BarList title="LAST SECTION BEFORE SIGNUP" items={breakdown.lastSectionBeforeSignup} total={totalSignups} />
      <BarList title="UTM SOURCES" items={breakdown.utmSources} total={totalSignups} />
      <BarList title="DEVICES" items={breakdown.devices} total={totalSignups} />
    </>
  )
}

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: 'danger' | 'accent' }) {
  const valueColor = accent === 'danger' ? 'text-[#93321A]' : accent === 'accent' ? 'text-[#597794]' : 'text-[#E5E5E5]'
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-kosugi text-[10px] text-[#6B6B6B] uppercase tracking-wider">{label}</span>
      <span className={`font-mohave text-[18px] font-semibold ${valueColor}`}>{value}</span>
    </div>
  )
}

function BarList({ title, items, total }: { title: string; items: { name: string; count: number }[]; total: number }) {
  if (items.length === 0) return null
  const maxCount = items[0]?.count ?? 1

  return (
    <div>
      <p className="font-mohave text-[11px] uppercase tracking-wider text-[#6B6B6B] mb-2">{title}</p>
      <div className="space-y-1.5">
        {items.slice(0, 8).map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <div className="flex-1 relative h-5 bg-white/[0.04] rounded overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-white/[0.08] rounded"
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
              <span className="relative z-10 px-2 font-kosugi text-[10px] text-[#A0A0A0] leading-5 truncate block">
                {item.name}
              </span>
            </div>
            <span className="font-mohave text-[12px] text-[#E5E5E5] w-8 text-right">
              {item.count}
            </span>
            <span className="font-kosugi text-[9px] text-[#6B6B6B] w-8 text-right">
              {total > 0 ? `${Math.round((item.count / total) * 100)}%` : '0%'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/flow/_components/detail-panel.tsx && git commit -m "feat(flow): detail panel with entry/section/conversion breakdowns"
```

---

## Chunk 4: Canvas + Dashboard + Page

### Task 10: Create flow canvas

**Files:**
- Create: `src/app/admin/analytics/flow/_components/flow-canvas.tsx`

**Context:**
- React Flow v12 (@xyflow/react) requires wrapping in `<ReactFlowProvider>` if using hooks outside `<ReactFlow>`
- Register custom node types and edge types with `nodeTypes` and `edgeTypes` props
- Layout: Entry node on left, section nodes in a column center, conversion node right, dropoff nodes below sections
- Use `fitView` to auto-zoom on data change
- Import React Flow CSS: `@xyflow/react/dist/style.css`

- [ ] **Step 1: Create flow-canvas.tsx**

```typescript
// src/app/admin/analytics/flow/_components/flow-canvas.tsx
'use client'

import { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { FlowData } from '@/lib/admin/flow-types'
import { EntryNode } from './nodes/entry-node'
import { SectionNode } from './nodes/section-node'
import { ConversionNode } from './nodes/conversion-node'
import { DropoffNode } from './nodes/dropoff-node'
import { FlowEdge } from './edges/flow-edge'
import { DropoffEdge } from './edges/dropoff-edge'

const nodeTypes = {
  entry: EntryNode,
  section: SectionNode,
  conversion: ConversionNode,
  dropoff: DropoffNode,
}

const edgeTypes = {
  flow: FlowEdge,
  dropoff: DropoffEdge,
}

interface FlowCanvasProps {
  data: FlowData
  onNodeClick: (nodeId: string) => void
}

const SECTION_Y_START = 40
const SECTION_Y_GAP = 100
const ENTRY_X = 50
const SECTION_X = 320
const CONVERSION_X = 640
const DROPOFF_X = 560

export function FlowCanvas({ data, onNodeClick }: FlowCanvasProps) {
  const maxEdgeCount = useMemo(
    () => Math.max(1, ...data.edges.map(e => e.count)),
    [data.edges]
  )

  const sectionNodes = useMemo(
    () => data.nodes.filter(n => n.type === 'section'),
    [data.nodes]
  )
  const maxViews = useMemo(
    () => Math.max(1, ...sectionNodes.map(n => n.views)),
    [sectionNodes]
  )

  // Build positioned React Flow nodes
  const rfNodes: Node[] = useMemo(() => {
    const nodes: Node[] = []
    const totalSectionHeight = sectionNodes.length * SECTION_Y_GAP

    // Entry node — vertically centered
    const entryNode = data.nodes.find(n => n.type === 'entry')
    if (entryNode) {
      nodes.push({
        id: 'entry',
        type: 'entry',
        position: { x: ENTRY_X, y: SECTION_Y_START + totalSectionHeight / 2 - 30 },
        data: { ...entryNode, onClick: onNodeClick },
      })
    }

    // Section nodes — stacked vertically
    sectionNodes.forEach((sn, i) => {
      nodes.push({
        id: sn.id,
        type: 'section',
        position: { x: SECTION_X, y: SECTION_Y_START + i * SECTION_Y_GAP },
        data: { ...sn, onClick: onNodeClick, maxViews },
      })

      // Dropoff node below each section (if significant dropoff)
      if (sn.dropoffCount > 0 && sn.dropoffRate > 0.05) {
        nodes.push({
          id: `dropoff-${sn.id}`,
          type: 'dropoff',
          position: { x: DROPOFF_X, y: SECTION_Y_START + i * SECTION_Y_GAP + 70 },
          data: { count: sn.dropoffCount, rate: sn.dropoffRate, sectionName: sn.id },
        })
      }
    })

    // Conversion node — vertically centered
    const convNode = data.nodes.find(n => n.type === 'conversion')
    if (convNode) {
      nodes.push({
        id: 'signup',
        type: 'conversion',
        position: { x: CONVERSION_X, y: SECTION_Y_START + totalSectionHeight / 2 - 30 },
        data: { ...convNode, onClick: onNodeClick },
      })
    }

    return nodes
  }, [data.nodes, sectionNodes, maxViews, onNodeClick])

  // Build React Flow edges
  const rfEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = []

    for (const e of data.edges) {
      edges.push({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        type: 'flow',
        data: { count: e.count, isConversionPath: e.isConversionPath, maxCount: maxEdgeCount },
        animated: e.isConversionPath,
      })
    }

    // Dropoff edges from sections to dropoff nodes
    for (const sn of sectionNodes) {
      if (sn.dropoffCount > 0 && sn.dropoffRate > 0.05) {
        edges.push({
          id: `${sn.id}->dropoff-${sn.id}`,
          source: sn.id,
          sourceHandle: 'dropoff',
          target: `dropoff-${sn.id}`,
          type: 'dropoff',
        })
      }
    }

    return edges
  }, [data.edges, sectionNodes, maxEdgeCount])

  const onNodeClickHandler = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type !== 'dropoff') {
        onNodeClick(node.id)
      }
    },
    [onNodeClick]
  )

  return (
    <div className="w-full h-full" style={{ minHeight: 500 }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClickHandler}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
        defaultEdgeOptions={{ type: 'flow' }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="rgba(255,255,255,0.03)" gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-white/[0.04] !border-white/[0.08] !rounded [&_button]:!bg-transparent [&_button]:!border-white/[0.08] [&_button]:!text-[#6B6B6B] [&_button:hover]:!text-[#E5E5E5]"
        />
      </ReactFlow>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/flow/_components/flow-canvas.tsx && git commit -m "feat(flow): React Flow canvas with node layout and edge rendering"
```

---

### Task 11: Create flow dashboard (client orchestrator)

**Files:**
- Create: `src/app/admin/analytics/flow/_components/flow-dashboard.tsx`

**Context:**
- Client component that orchestrates filter state, data fetching, canvas, detail panel, and summary strip
- Fetch from `/api/admin/analytics/flow` API endpoint using standard fetch (admin pages don't use TanStack Query hooks typically — they server-render. But since this needs client-side filter changes, use useState + useEffect + fetch pattern like RotationControls)
- Show loading state while fetching
- Pass variant list from server-side active test data

- [ ] **Step 1: Create flow-dashboard.tsx**

```typescript
// src/app/admin/analytics/flow/_components/flow-dashboard.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { FlowData, FlowQueryParams, FlowNode } from '@/lib/admin/flow-types'
import { FlowControls } from './flow-controls'
import { FlowCanvas } from './flow-canvas'
import { FlowSummaryStrip } from './flow-summary-strip'
import { DetailPanel } from './detail-panel'

interface FlowDashboardProps {
  variants?: { id: string; label: string }[]
}

export function FlowDashboard({ variants }: FlowDashboardProps) {
  const [params, setParams] = useState<FlowQueryParams>({
    days: 30,
    device: 'all',
    variant: 'all',
  })
  const [data, setData] = useState<FlowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // Fetch flow data
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const qs = new URLSearchParams({
      days: String(params.days),
      device: params.device,
      variant: params.variant,
    })

    fetch(`/api/admin/analytics/flow?${qs}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<FlowData>
      })
      .then((flowData) => {
        if (!cancelled) {
          setData(flowData)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [params])

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
  }, [])

  const handleClosePanel = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  const selectedNode = data?.nodes.find(n => n.id === selectedNodeId) ?? null

  return (
    <div className="flex flex-col h-[calc(100vh-88px)]">
      {/* Controls */}
      <div className="px-6 py-4 border-b border-white/[0.08]">
        <FlowControls params={params} onChange={setParams} variants={variants} />
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#0D0D0D]/80">
            <p className="font-mohave text-[14px] text-[#6B6B6B] uppercase tracking-wider">
              Reconstructing sessions...
            </p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="text-center">
              <p className="font-mohave text-[14px] text-[#93321A] uppercase tracking-wider mb-2">
                Failed to load flow data
              </p>
              <p className="font-kosugi text-[12px] text-[#6B6B6B]">{error}</p>
            </div>
          </div>
        )}

        {data && !loading && (
          <ReactFlowProvider>
            <FlowCanvas data={data} onNodeClick={handleNodeClick} />
          </ReactFlowProvider>
        )}

        {/* Detail panel overlay */}
        {selectedNode && data && (
          <DetailPanel
            node={selectedNode}
            entryBreakdown={selectedNode.type === 'entry' ? data.entryBreakdown : undefined}
            conversionBreakdown={selectedNode.type === 'conversion' ? data.conversionBreakdown : undefined}
            onClose={handleClosePanel}
          />
        )}
      </div>

      {/* Summary strip */}
      {data && !loading && <FlowSummaryStrip summary={data.summary} />}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/flow/_components/flow-dashboard.tsx && git commit -m "feat(flow): dashboard orchestrator with filter state, data fetching, canvas, and detail panel"
```

---

### Task 12: Create page and add CSS keyframe

**Files:**
- Create: `src/app/admin/analytics/flow/page.tsx`
- Modify: `src/app/globals.css` (add slideInRight keyframe)

**Context:**
- Server component pattern: AdminPageHeader + error boundary
- Fetch active test variants for the filter dropdown
- Pass variant IDs to FlowDashboard

- [ ] **Step 1: Create the page**

```typescript
// src/app/admin/analytics/flow/page.tsx

import { AdminPageHeader } from '../../_components/admin-page-header'
import { FlowDashboard } from './_components/flow-dashboard'
import { getActiveTest } from '@/lib/ab/ab-queries'

export default async function FlowPage() {
  // Get active test variants for filter dropdown
  let variants: { id: string; label: string }[] = []
  try {
    const test = await getActiveTest()
    if (test) {
      variants = [
        { id: test.variantA.id, label: `VARIANT A (G${test.variantA.generation})` },
        { id: test.variantB.id, label: `VARIANT B (G${test.variantB.generation})` },
      ]
    }
  } catch {
    // Non-critical — filter just won't show variant options
  }

  return (
    <div className="flex flex-col h-screen">
      <AdminPageHeader title="User Flow" caption="session journey visualization" />
      <FlowDashboard variants={variants} />
    </div>
  )
}
```

- [ ] **Step 2: Add CSS keyframe for detail panel animation**

Find the global CSS file and add the `slideInRight` keyframe. Check `src/app/globals.css` for existing keyframes and add after them:

```css
@keyframes slideInRight {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
```

Add this at the end of `src/app/globals.css` (before any closing brackets if inside a layer).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit src/app/admin/analytics/flow/page.tsx 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/flow/page.tsx src/app/globals.css && git commit -m "feat(flow): flow page with server-side variant loading and slideInRight animation"
```

---

## Chunk 5: Integration + Polish

### Task 13: Add link from analytics page

**Files:**
- Modify: `src/app/admin/analytics/_components/analytics-content.tsx`

- [ ] **Step 1: Add a link to the flow page**

In `analytics-content.tsx`, add a link button above the SubTabs to navigate to the flow visualization. Add at the top of the return, before SubTabs:

```typescript
import Link from 'next/link'

// In the return JSX, before <SubTabs>:
<div className="flex items-center justify-between mb-6">
  <div />
  <Link
    href="/admin/analytics/flow"
    className="px-4 py-2 font-mohave text-[12px] uppercase tracking-wider text-[#597794] border border-[#597794]/30 rounded hover:bg-[#597794]/10 transition-colors"
  >
    User Flow Visualization →
  </Link>
</div>
```

- [ ] **Step 2: Commit**

```bash
cd /c/OPS/ops-web && git add src/app/admin/analytics/_components/analytics-content.tsx && git commit -m "feat(flow): add link to flow visualization from analytics page"
```

---

### Task 14: Verify full build

- [ ] **Step 1: Run TypeScript check on all new files**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors from our new files

- [ ] **Step 2: Run dev server and verify page loads**

```bash
cd /c/OPS/ops-web && npm run dev
```

Navigate to `http://localhost:3000/admin/analytics/flow` and verify:
1. Page loads with header "USER FLOW" and caption "[session journey visualization]"
2. Filter controls render (7D/30D/90D/ALL + device + variant pills)
3. Flow canvas renders with nodes (may show empty state if no ab_events data)
4. Summary strip shows at bottom
5. Clicking a node opens the detail panel
6. Pressing Escape closes the detail panel

- [ ] **Step 3: Final commit with any fixes**

```bash
cd /c/OPS/ops-web && git add -A && git commit -m "feat(flow): analytics flow dashboard — complete implementation"
```

---

## Summary

| Chunk | Tasks | Files Created | Files Modified |
|-------|-------|---------------|----------------|
| 1: Foundation | 1-4 | flow-types.ts, flow-queries.ts, flow/route.ts | package.json |
| 2: Nodes & Edges | 5-6 | 4 node files, 2 edge files | — |
| 3: Dashboard Components | 7-9 | flow-controls.tsx, flow-summary-strip.tsx, detail-panel.tsx | — |
| 4: Canvas + Dashboard + Page | 10-12 | flow-canvas.tsx, flow-dashboard.tsx, page.tsx | globals.css |
| 5: Integration | 13-14 | — | analytics-content.tsx |

**Total new files:** 13
**Total modified files:** 3 (package.json, globals.css, analytics-content.tsx)
