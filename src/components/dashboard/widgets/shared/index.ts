// ── Existing shared ──────────────────────────────────────────────────
export { WidgetTooltip, TooltipRow } from "./widget-tooltip";
export { WidgetSkeleton } from "./widget-skeleton";
export { Sparkline } from "./sparkline";
export { useAnimatedValue } from "./use-animated-value";
export { useWidgetIntersection } from "./use-widget-intersection";
export { ScrollFade } from "./scroll-fade";
export { useReducedMotion } from "./use-reduced-motion";

// ── Utilities ────────────────────────────────────────────────────────
export {
  formatCompactCurrency,
  formatLocaleCurrency,
  formatCompactDate,
  formatAge,
  computeDeltaPct,
  getStatusColor,
  getStatusLabel,
} from "./widget-utils";
export { WidgetTrendContext } from "./widget-trend-context";
export {
  WIDGET_EASE,
  WIDGET_EASE_CSS,
  WIDGET_DURATION_FAST,
  WIDGET_DURATION_NORMAL,
  WIDGET_DURATION_SLOW,
  WIDGET_STAGGER_DELAY,
  WIDGET_FLIP_DURATION,
  WIDGET_COLLAPSE_DURATION,
  widgetLineItemStyle,
  widgetFlipStyle,
} from "./widget-motion";

// ── Components ───────────────────────────────────────────────────────
export { WidgetTitle } from "./widget-title";
export { WidgetEmptyState } from "./widget-empty-state";
export { WidgetStatusBadge } from "./widget-status-badge";
export { WidgetLineItem } from "./widget-line-item";
export { WidgetMoreButton } from "./widget-more-button";
export { WidgetPeriodPicker } from "./widget-period-picker";
export { WidgetBackgroundChart } from "./widget-background-chart";
export { WidgetHeroCollapse } from "./widget-hero-collapse";
export { WidgetCardFlip } from "./widget-card-flip";
export { WidgetInlineAction } from "./widget-inline-action";
export { showWidgetActionToast } from "./widget-action-toast";
