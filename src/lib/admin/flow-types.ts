export interface FlowNode {
  id: string
  type: 'entry' | 'section' | 'conversion' | 'dropoff'
  label: string
  views: number
  avgDwellMs: number
  clicks: number
  clickBreakdown: { elementId: string; count: number }[]
  dropoffCount: number
  dropoffRate: number
  conversionRate: number
  deviceBreakdown: { device: string; count: number }[]
}

export interface FlowEdge {
  source: string
  target: string
  count: number
  isConversionPath: boolean
}

export interface FlowSummary {
  totalSessions: number
  bounceRate: number
  avgSectionsViewed: number
  conversionRate: number
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
  days: number
  device: string
  variant: string
}
