import type { MarkerStatus } from './types';

export function statusForMarker1(value: number): MarkerStatus {
  if (value >= 2) return 'green';
  if (value === 1) return 'amber';
  return 'red';
}

export function statusForMarker2(value: number): MarkerStatus {
  if (value >= 5) return 'green';
  if (value >= 3) return 'amber';
  return 'red';
}

export function statusForMarker3(value: number): MarkerStatus {
  return value >= 1 ? 'green' : 'red';
}

export function statusForMarker4(input: { spendUsd: number; attributedPaid: number }): MarkerStatus {
  const { spendUsd, attributedPaid } = input;
  if (spendUsd >= 15_000 && attributedPaid >= 5) return 'green';
  if (spendUsd >= 11_250 || attributedPaid >= 4) return 'amber';
  return 'red';
}

export function statusForIndicatorA(active: number): MarkerStatus {
  if (active < 3) return 'red';
  if (active >= 5 && active <= 8) return 'green';
  return 'amber';
}

export function statusForIndicatorB(weekly: number): MarkerStatus {
  if (weekly < 30) return 'red';
  if (weekly >= 40 && weekly <= 100) return 'green';
  return 'amber';
}

export function statusForIndicatorC(rate: number): MarkerStatus {
  if (rate < 0.04) return 'red';
  if (rate >= 0.05 && rate <= 0.10) return 'green';
  return 'amber';
}

export function statusForIndicatorD(rate: number): MarkerStatus {
  if (rate > 0.10) return 'red';
  if (rate >= 0.04 && rate <= 0.07) return 'green';
  return 'amber';
}
