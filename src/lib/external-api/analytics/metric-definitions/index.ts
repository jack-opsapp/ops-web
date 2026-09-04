import type { MetricId } from "../../contracts/metrics";
import {
  financialMetricIdsV1,
  metricDefinitionV1ById,
  metricDefinitionsV1,
} from "./v1";

export const CURRENT_METRIC_DEFINITION_VERSION = "1" as const;

export function getMetricDefinitions(
  version: string,
  metricIds: readonly MetricId[]
) {
  if (version !== CURRENT_METRIC_DEFINITION_VERSION) return null;
  return metricIds.map((metricId) => {
    const definition = metricDefinitionV1ById.get(metricId);
    if (!definition) throw new Error("metric definition is unavailable");
    return definition;
  });
}

export { financialMetricIdsV1, metricDefinitionV1ById, metricDefinitionsV1 };
