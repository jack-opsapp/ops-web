import type { GrowthDataState } from "@/lib/admin/growth-analytics-types";

export type GrowthTranslate = (
  key: string,
  fallbackOrParams?: string | Record<string, unknown>
) => string;

export function stateKey(state: GrowthDataState): string {
  return `state${state[0].toUpperCase()}${state.slice(1)}`;
}

export function stateTone(state: GrowthDataState): string {
  switch (state) {
    case "ready":
      return "border-olive-line bg-olive-soft text-olive";
    case "partial":
    case "provisional":
    case "stale":
      return "border-tan-line bg-tan-soft text-tan";
    case "failed":
    case "missing":
      return "border-rose-line bg-rose-soft text-rose";
    default:
      return "border-border bg-surface-input text-text-3";
  }
}

export function stateMessageKey(state: GrowthDataState): string | null {
  return state === "ready" ? null : `${stateKey(state)}Message`;
}
