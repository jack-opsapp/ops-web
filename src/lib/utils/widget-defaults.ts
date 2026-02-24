// ---------------------------------------------------------------------------
// Widget Defaults — Maps setup store answers to default widget instances
// ---------------------------------------------------------------------------

import type { WorkType, TrackingPriority, TeamSize, NeededFeature } from "@/stores/setup-store";
import {
  type WidgetInstance,
  type WidgetTag,
  WIDGET_TYPE_REGISTRY,
  ALL_WIDGET_TYPE_IDS,
  createWidgetInstance,
} from "@/lib/types/dashboard-widgets";

interface SetupAnswers {
  workType: WorkType | null;
  trackingPriorities: TrackingPriority[];
  teamSize: TeamSize | null;
  neededFeatures: NeededFeature[];
}

/**
 * Derives active WidgetTags from setup answers
 */
function getActiveTagsFromSetup(answers: SetupAnswers): Set<WidgetTag> {
  const tags = new Set<WidgetTag>(["essential"]);

  // Work type
  if (answers.workType === "project-based") {
    tags.add("pipeline");
    tags.add("office");
    tags.add("estimates");
  }
  if (answers.workType === "recurring" || answers.workType === "single-visit") {
    tags.add("scheduling");
    tags.add("clients");
  }
  if (answers.workType === "emergency") {
    tags.add("field-ops");
    tags.add("scheduling");
  }

  // Tracking priorities
  for (const priority of answers.trackingPriorities) {
    if (priority === "revenue") tags.add("finance");
    if (priority === "efficiency") tags.add("field-ops");
    if (priority === "pipeline") tags.add("pipeline");
    if (priority === "customers") {
      tags.add("clients");
      tags.add("office");
    }
  }

  // Team size — solo operators don't need field-ops
  if (answers.teamSize === "solo") {
    tags.delete("field-ops");
  }

  // Needed features
  for (const feature of answers.neededFeatures) {
    if (feature === "scheduling") tags.add("scheduling");
    if (feature === "invoicing") tags.add("finance");
    if (feature === "leads") {
      tags.add("pipeline");
      tags.add("estimates");
    }
    if (feature === "crew") tags.add("field-ops");
    if (feature === "expenses") tags.add("finance");
  }

  return tags;
}

/**
 * Given setup answers, returns an array of default WidgetInstance[]
 * where only tag-matching widget types are included.
 */
export function getDefaultWidgetInstancesFromSetup(
  answers: SetupAnswers
): WidgetInstance[] {
  const activeTags = getActiveTagsFromSetup(answers);
  const instances: WidgetInstance[] = [];

  for (const typeId of ALL_WIDGET_TYPE_IDS) {
    const entry = WIDGET_TYPE_REGISTRY[typeId];
    const matches = entry.tags.some((tag: WidgetTag) => activeTags.has(tag));
    if (!matches) continue;

    // For multi-instance stat types, create a single default instance
    // For single-instance types, create one instance
    instances.push(createWidgetInstance(typeId));
  }

  return instances;
}
