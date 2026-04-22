import type { MarkerKey, IndicatorKey, MarkerStatus, PmfState } from './types';

export interface Transition {
  key: MarkerKey | IndicatorKey;
  from: MarkerStatus;
  to: MarkerStatus;
  direction: 'improving' | 'worsening';
  value: number;
}

const RANK: Record<MarkerStatus, number> = { red: 0, amber: 1, green: 2 };

export function diffState(prev: PmfState, next: PmfState): Transition[] {
  const out: Transition[] = [];
  const allKeys: (MarkerKey | IndicatorKey)[] = [
    'marker_1','marker_2','marker_3','marker_4',
    'indicator_a','indicator_b','indicator_c','indicator_d','indicator_e',
  ];
  for (const key of allKeys) {
    const p = key.startsWith('marker') ? prev.markers[key as MarkerKey] : prev.indicators[key as IndicatorKey];
    const n = key.startsWith('marker') ? next.markers[key as MarkerKey] : next.indicators[key as IndicatorKey];
    if (!p || !n) continue;
    if (p.status === n.status) continue;

    const direction = RANK[n.status] > RANK[p.status] ? 'improving' : 'worsening';
    // Only alert on: any→green, or worsening-to-non-green.
    const isAlert =
      n.status === 'green' ||
      direction === 'worsening';
    if (!isAlert) continue;

    out.push({ key, from: p.status, to: n.status, direction, value: n.value });
  }
  return out;
}
