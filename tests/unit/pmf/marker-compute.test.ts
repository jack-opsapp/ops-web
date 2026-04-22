import { describe, it, expect } from 'vitest';
import {
  statusForMarker1,
  statusForMarker2,
  statusForMarker3,
  statusForMarker4,
  statusForIndicatorA,
  statusForIndicatorB,
  statusForIndicatorC,
  statusForIndicatorD,
} from '@/lib/pmf/marker-compute';

describe('Marker 1 — Tier A paid & delivered (target 2)', () => {
  it('green at >=2', () => expect(statusForMarker1(2)).toBe('green'));
  it('amber at 1',    () => expect(statusForMarker1(1)).toBe('amber'));
  it('red at 0',      () => expect(statusForMarker1(0)).toBe('red'));
});

describe('Marker 2 — retained base SaaS (target 5)', () => {
  it('green at >=5', () => expect(statusForMarker2(5)).toBe('green'));
  it('amber at 3-4', () => {
    expect(statusForMarker2(3)).toBe('amber');
    expect(statusForMarker2(4)).toBe('amber');
  });
  it('red at <=2', () => {
    expect(statusForMarker2(2)).toBe('red');
    expect(statusForMarker2(0)).toBe('red');
  });
});

describe('Marker 3 — inbound leads (target 1)', () => {
  it('green at >=1', () => expect(statusForMarker3(1)).toBe('green'));
  it('red at 0',     () => expect(statusForMarker3(0)).toBe('red'));
});

describe('Marker 4 — CAC ($15K spend, 5 paid)', () => {
  it('green at >=15000 and >=5 paid', () =>
    expect(statusForMarker4({ spendUsd: 15000, attributedPaid: 5 })).toBe('green'));
  it('amber at >=75% of either axis', () =>
    expect(statusForMarker4({ spendUsd: 11250, attributedPaid: 4 })).toBe('amber'));
  it('red below', () =>
    expect(statusForMarker4({ spendUsd: 5000, attributedPaid: 1 })).toBe('red'));
});

describe('Indicator A — active Tier A (healthy 5-8)', () => {
  it('red <3',        () => expect(statusForIndicatorA(2)).toBe('red'));
  it('amber 3-4',     () => expect(statusForIndicatorA(4)).toBe('amber'));
  it('green 5-8',     () => expect(statusForIndicatorA(6)).toBe('green'));
  it('amber >10',     () => expect(statusForIndicatorA(11)).toBe('amber'));
});

describe('Indicator B — weekly new trials', () => {
  it('red <30',    () => expect(statusForIndicatorB(10)).toBe('red'));
  it('amber 30-39',() => expect(statusForIndicatorB(35)).toBe('amber'));
  it('green 40-100',() => expect(statusForIndicatorB(60)).toBe('green'));
  it('amber >100', () => expect(statusForIndicatorB(120)).toBe('amber'));
});

describe('Indicator C — trial→paid conversion', () => {
  it('red <4%',    () => expect(statusForIndicatorC(0.03)).toBe('red'));
  it('green 5-10%',() => expect(statusForIndicatorC(0.07)).toBe('green'));
  it('amber in between', () => expect(statusForIndicatorC(0.045)).toBe('amber'));
});

describe('Indicator D — cohort churn', () => {
  it('green 4-7%',() => expect(statusForIndicatorD(0.05)).toBe('green'));
  it('amber 8-10%',() => expect(statusForIndicatorD(0.09)).toBe('amber'));
  it('red >10%',  () => expect(statusForIndicatorD(0.11)).toBe('red'));
});
