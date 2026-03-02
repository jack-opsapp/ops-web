import { getAdminSupabase } from '@/lib/supabase/admin-client'

export interface SectionData {
  sectionName: string
  pctViewers: number
  avgDwellMs: number
  clickRate: number
}

export interface VariantData {
  id: string
  slot: 'a' | 'b'
  generation: number
  visitorCount: number
  signupCount: number
  conversionRate: number
  aiReasoning: string
  config: { sections: { type: string; props: Record<string, unknown> }[] }
  sections: SectionData[]
}

export interface ActiveTestData {
  testId: string
  startedAt: string
  status: string
  minVisitors: number
  minDays: number
  variantA: VariantData
  variantB: VariantData
}

export interface ABConfig {
  brand_context: string
  min_visitors: number
  min_days: number
}

export interface HistoryTest {
  id: string
  started_at: string
  ended_at: string
  winner_variant: 'a' | 'b'
  variant_a: { slot: string; generation: number; conversion_rate: number; visitor_count: number; config: object; ai_reasoning: string }
  variant_b: { slot: string; generation: number; conversion_rate: number; visitor_count: number; config: object; ai_reasoning: string }
}

export async function getActiveTest(): Promise<ActiveTestData | null> {
  const supabase = getAdminSupabase()

  const { data: test } = await supabase
    .from('ab_tests')
    .select('id, started_at, status, min_visitors, min_days, variant_a_id, variant_b_id')
    .in('status', ['active', 'rotating'])
    .single()

  if (!test) return null

  const [{ data: varA }, { data: varB }] = await Promise.all([
    supabase.from('ab_variants').select('*').eq('id', test.variant_a_id).single(),
    supabase.from('ab_variants').select('*').eq('id', test.variant_b_id).single(),
  ])

  if (!varA || !varB) return null

  async function getSections(variantId: string, totalVisitors: number): Promise<SectionData[]> {
    const { data: events } = await supabase
      .from('ab_events')
      .select('section_name, dwell_ms, event_type')
      .eq('variant_id', variantId)
      .in('event_type', ['section_view', 'element_click'])

    const map = new Map<string, { views: number; totalDwell: number; clicks: number }>()
    for (const e of events ?? []) {
      if (!e.section_name) continue
      const s = map.get(e.section_name) ?? { views: 0, totalDwell: 0, clicks: 0 }
      if (e.event_type === 'section_view') { s.views++; if (e.dwell_ms) s.totalDwell += e.dwell_ms }
      if (e.event_type === 'element_click') s.clicks++
      map.set(e.section_name, s)
    }

    return Array.from(map.entries()).map(([name, s]) => ({
      sectionName: name,
      pctViewers: totalVisitors > 0 ? Math.round((s.views / totalVisitors) * 100) : 0,
      avgDwellMs: s.views > 0 ? Math.round(s.totalDwell / s.views) : 0,
      clickRate: totalVisitors > 0 ? Math.round((s.clicks / totalVisitors) * 100) / 100 : 0,
    }))
  }

  const [sectionsA, sectionsB] = await Promise.all([
    getSections(varA.id, varA.visitor_count),
    getSections(varB.id, varB.visitor_count),
  ])

  return {
    testId: test.id,
    startedAt: test.started_at,
    status: test.status,
    minVisitors: test.min_visitors,
    minDays: test.min_days,
    variantA: { id: varA.id, slot: 'a', generation: varA.generation, visitorCount: varA.visitor_count, signupCount: varA.signup_count, conversionRate: varA.conversion_rate, aiReasoning: varA.ai_reasoning, config: varA.config, sections: sectionsA },
    variantB: { id: varB.id, slot: 'b', generation: varB.generation, visitorCount: varB.visitor_count, signupCount: varB.signup_count, conversionRate: varB.conversion_rate, aiReasoning: varB.ai_reasoning, config: varB.config, sections: sectionsB },
  }
}

export async function getABConfig(): Promise<ABConfig> {
  const supabase = getAdminSupabase()
  const { data } = await supabase.from('ab_config').select('*').eq('id', 1).single()
  return data ?? { brand_context: '', min_visitors: 100, min_days: 7 }
}

export async function updateABConfig(updates: Partial<ABConfig>): Promise<void> {
  const supabase = getAdminSupabase()
  await supabase
    .from('ab_config')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', 1)
}

export async function getTestHistory(): Promise<HistoryTest[]> {
  const supabase = getAdminSupabase()

  const { data: tests } = await supabase
    .from('ab_tests')
    .select('id, started_at, ended_at, winner_variant, variant_a_id, variant_b_id')
    .eq('status', 'completed')
    .order('ended_at', { ascending: false })
    .limit(20)

  if (!tests?.length) return []

  const variantIds = tests.flatMap(t => [t.variant_a_id, t.variant_b_id])
  const { data: variants } = await supabase
    .from('ab_variants')
    .select('id, slot, generation, conversion_rate, visitor_count, config, ai_reasoning')
    .in('id', variantIds)

  const varMap = new Map((variants ?? []).map(v => [v.id, v]))

  return tests.map(t => ({
    id: t.id,
    started_at: t.started_at,
    ended_at: t.ended_at,
    winner_variant: t.winner_variant as 'a' | 'b',
    variant_a: varMap.get(t.variant_a_id) ?? { slot: 'a', generation: 0, conversion_rate: 0, visitor_count: 0, config: {}, ai_reasoning: '' },
    variant_b: varMap.get(t.variant_b_id) ?? { slot: 'b', generation: 0, conversion_rate: 0, visitor_count: 0, config: {}, ai_reasoning: '' },
  }))
}
