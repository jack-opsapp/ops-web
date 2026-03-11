/* ── src/lib/admin/app-flow-types.ts ── */

// Reuses FlowData/FlowNode/FlowEdge from flow-types.ts since the galaxy
// transformer expects the same shape. This file defines the raw app event
// and query param types specific to app analytics.

export interface AppEvent {
  session_id: string;
  user_id: string | null;
  company_id: string | null;
  event_type: string;
  page_name: string | null;
  feature_name: string | null;
  element_id: string | null;
  dwell_ms: number | null;
  device_type: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface AppFlowQueryParams {
  days: number;
  device: string;
}
