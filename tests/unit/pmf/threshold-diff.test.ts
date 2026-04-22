import { describe, it, expect } from 'vitest';
import { diffState, type Transition } from '@/lib/pmf/threshold-diff';
import type { PmfState } from '@/lib/pmf/types';

function makeState(overrides: Partial<PmfState['markers']> = {}, ind: Partial<PmfState['indicators']> = {}): PmfState {
  return {
    capturedAt: '2026-04-21T00:00:00Z',
    markers: {
      marker_1: { status: 'red',   value: 0, target: 2, label: 'M1' },
      marker_2: { status: 'red',   value: 0, target: 5, label: 'M2' },
      marker_3: { status: 'red',   value: 0, target: 1, label: 'M3' },
      marker_4: { status: 'red',   value: 0, target: 15000, label: 'M4' },
      ...overrides,
    } as any,
    indicators: {
      indicator_a: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'A' },
      indicator_b: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'B' },
      indicator_c: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'C' },
      indicator_d: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'D' },
      indicator_e: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'E' },
      ...ind,
    } as any,
  };
}

describe('diffState', () => {
  it('detects marker red → green', () => {
    const prev = makeState();
    const next = makeState({ marker_1: { status: 'green', value: 2, target: 2, label: 'M1' } as any });
    const transitions = diffState(prev, next);
    expect(transitions).toContainEqual(
      expect.objectContaining({ key: 'marker_1', from: 'red', to: 'green' })
    );
  });

  it('detects marker green → amber (worsening)', () => {
    const prev = makeState({ marker_1: { status: 'green', value: 2, target: 2, label: 'M1' } as any });
    const next = makeState({ marker_1: { status: 'amber', value: 1, target: 2, label: 'M1' } as any });
    expect(diffState(prev, next)).toContainEqual(
      expect.objectContaining({ key: 'marker_1', from: 'green', to: 'amber', direction: 'worsening' })
    );
  });

  it('does NOT alert on red → amber (recovery but not green)', () => {
    const prev = makeState();
    const next = makeState({ marker_2: { status: 'amber', value: 3, target: 5, label: 'M2' } as any });
    const transitions = diffState(prev, next);
    expect(transitions.find(t => t.key === 'marker_2')).toBeUndefined();
  });

  it('empty transitions when no change', () => {
    const s = makeState();
    expect(diffState(s, s)).toEqual([]);
  });
});
