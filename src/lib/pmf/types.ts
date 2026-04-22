export type ProspectSource =
  | 'outbound_cold' | 'warm_network' | 'paid_ad'
  | 'organic_search' | 'referral' | 'direct';

export type DealType = 'tier_a' | 'base_saas';

export type DealStage =
  | 'contacted' | 'qualified' | 'proposal' | 'negotiation'
  | 'signed' | 'in_delivery' | 'delivered' | 'closed_won' | 'closed_lost';

export type DealEventType =
  | 'stage_change' | 'note' | 'sow_signed'
  | 'payment_received' | 'delivered' | 'closed';

export type AdChannel = 'google_ads' | 'meta_ads' | 'apple_search_ads' | 'other';

export type AttributionChannel =
  | 'google_ads' | 'meta_ads' | 'apple_search_ads'
  | 'organic' | 'direct' | 'referral' | 'unknown';

export type MarkerStatus = 'green' | 'amber' | 'red';

export type MarkerKey = 'marker_1' | 'marker_2' | 'marker_3' | 'marker_4';
export type IndicatorKey = 'indicator_a' | 'indicator_b' | 'indicator_c' | 'indicator_d' | 'indicator_e';

export interface MarkerState {
  status: MarkerStatus;
  value: number;
  target: number;
  label: string;
  detail?: string;
}

export interface IndicatorState {
  status: MarkerStatus;
  value: number;
  delta_wow: number;
  sparkline: number[];
  label: string;
  unit?: 'count' | 'percent' | 'currency';
}

export interface PmfState {
  capturedAt: string;
  markers: Record<MarkerKey, MarkerState>;
  indicators: Record<IndicatorKey, IndicatorState>;
}

export interface Prospect {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: ProspectSource;
  referred_by_company_id: string | null;
  deal_type: DealType;
  first_contact_at: string;
  first_contact_direction: 'inbound' | 'outbound';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  prospect_id: string;
  stage: DealStage;
  stage_entered_at: string;
  deal_type: DealType;
  sow_signed_at: string | null;
  sow_url: string | null;
  implementation_fee_cents: number | null;
  deposit_paid_at: string | null;
  deposit_amount_cents: number | null;
  final_paid_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
}
