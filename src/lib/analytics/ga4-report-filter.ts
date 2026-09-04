import type { protos } from "@google-analytics/data";
import {
  ANALYTICS_PROPERTY_REGISTRY,
  type AnalyticsPropertyKey,
} from "./property-registry";

type FilterExpression = protos.google.analytics.data.v1beta.IFilterExpression;

export function composeGA4ProductionHostnameFilter(
  propertyKey: AnalyticsPropertyKey,
  existingFilter?: FilterExpression
): FilterExpression | undefined {
  const productionHosts =
    ANALYTICS_PROPERTY_REGISTRY[propertyKey].productionHosts;
  if (!productionHosts) return existingFilter;

  const hostnameFilter: FilterExpression = {
    filter: {
      fieldName: "hostName",
      inListFilter: {
        values: [...productionHosts],
        caseSensitive: false,
      },
    },
  };

  if (!existingFilter) return hostnameFilter;
  return {
    andGroup: {
      expressions: [existingFilter, hostnameFilter],
    },
  };
}
