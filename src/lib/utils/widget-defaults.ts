// ---------------------------------------------------------------------------
// Widget Defaults — Maps starfield answers to default widget instances
// ---------------------------------------------------------------------------

import {
  type WidgetInstance,
  type WidgetTag,
  type WidgetTypeId,
  WIDGET_TYPE_REGISTRY,
  ALL_WIDGET_TYPE_IDS,
  createWidgetInstance,
} from "@/lib/types/dashboard-widgets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TagPriority = "high" | "medium" | "low";

interface TagScore {
  tag: WidgetTag;
  priority: TagPriority;
}

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT: Record<TagPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function ts(tag: WidgetTag, priority: TagPriority): TagScore {
  return { tag, priority };
}

// ---------------------------------------------------------------------------
// getActiveTagsFromAnswers
// ---------------------------------------------------------------------------

/**
 * Maps each starfield answer to widget tags with priorities.
 * Only considers questions the user actually answered.
 */
export function getActiveTagsFromAnswers(
  answers: Record<string, string | number>
): TagScore[] {
  const scores: TagScore[] = [];

  // Q1 — projects
  if (answers.projects !== undefined) {
    const v = answers.projects as string;
    if (v === "1-3") {
      scores.push(ts("office", "low"));
    } else if (v === "4-10") {
      scores.push(ts("office", "medium"), ts("scheduling", "medium"));
    } else if (v === "10-20") {
      scores.push(
        ts("office", "high"),
        ts("scheduling", "high"),
        ts("field-ops", "high")
      );
    } else if (v === "20+") {
      scores.push(
        ts("office", "high"),
        ts("scheduling", "high"),
        ts("field-ops", "high"),
        ts("pipeline", "high")
      );
    }
  }

  // Q2 — estimates
  if (answers.estimates !== undefined) {
    const v = answers.estimates as string;
    if (v === "software") {
      scores.push(ts("estimates", "low"));
    } else if (v === "spreadsheets") {
      scores.push(ts("estimates", "medium"));
    } else if (v === "text-email") {
      scores.push(ts("estimates", "medium"));
    } else if (v === "pen-paper") {
      scores.push(ts("estimates", "high"));
    }
  }

  // Q3 — close_rate (likert 1-5)
  if (answers.close_rate !== undefined) {
    const v = Number(answers.close_rate);
    if (v >= 4) {
      scores.push(ts("pipeline", "low"));
    } else if (v === 3) {
      scores.push(ts("pipeline", "medium"));
    } else if (v <= 2) {
      scores.push(ts("pipeline", "high"), ts("estimates", "high"));
    }
  }

  // Q4 — invoicing (likert 1-5)
  if (answers.invoicing !== undefined) {
    const v = Number(answers.invoicing);
    if (v >= 4) {
      scores.push(ts("finance", "low"));
    } else if (v === 3) {
      scores.push(ts("finance", "medium"));
    } else if (v <= 2) {
      scores.push(ts("finance", "high"));
    }
  }

  // Q5 — scheduling
  if (answers.scheduling !== undefined) {
    const v = answers.scheduling as string;
    if (v === "calendar-app") {
      scores.push(ts("scheduling", "low"));
    } else if (v === "whiteboard") {
      scores.push(ts("scheduling", "medium"));
    } else if (v === "in-my-head") {
      scores.push(ts("scheduling", "high"));
    } else if (v === "chaos") {
      scores.push(ts("scheduling", "high"), ts("field-ops", "high"));
    }
  }

  // Q6 — schedule_detail
  if (answers.schedule_detail !== undefined) {
    const v = answers.schedule_detail as string;
    if (v === "by-the-hour" || v === "by-the-day") {
      scores.push(ts("scheduling", "medium"));
    }
  }

  // Q7 — crew
  if (answers.crew !== undefined) {
    const v = answers.crew as string;
    // "just-me" → removal handled downstream, no tags added
    if (v === "small-crew") {
      scores.push(ts("field-ops", "medium"));
    } else if (v === "multiple-crews") {
      scores.push(ts("field-ops", "high"), ts("scheduling", "high"));
    } else if (v === "office-and-field") {
      scores.push(ts("field-ops", "high"), ts("office", "high"));
    }
  }

  // Q8 — crew_morale (likert 1-5)
  if (answers.crew_morale !== undefined) {
    const v = Number(answers.crew_morale);
    if (v >= 4) {
      scores.push(ts("field-ops", "low"));
    } else if (v === 3) {
      scores.push(ts("field-ops", "medium"));
    } else if (v <= 2) {
      scores.push(ts("field-ops", "high"));
    }
  }

  // Q9 — inquiries (likert 1-5)
  if (answers.inquiries !== undefined) {
    const v = Number(answers.inquiries);
    if (v <= 2) {
      scores.push(ts("clients", "medium")); // phone/text heavy
    } else if (v === 3) {
      scores.push(ts("clients", "medium"));
    } else if (v >= 4) {
      scores.push(ts("clients", "medium")); // flag: email_priority handled in getQualificationFlags
    }
  }

  // Q10 — time
  if (answers.time !== undefined) {
    const v = answers.time as string;
    if (v === "bill-on-time") {
      scores.push(ts("scheduling", "medium"), ts("field-ops", "medium"));
    }
    // "price-by-job" → no time tracking widgets prioritized
  }

  // Q11 — inventory
  // Flag only — handled in getQualificationFlags, no tag scores

  // Q12 — numbers (likert 1-5)
  if (answers.numbers !== undefined) {
    const v = Number(answers.numbers);
    if (v >= 4) {
      scores.push(ts("finance", "low"));
    } else if (v === 3) {
      scores.push(ts("finance", "medium"));
    } else if (v <= 2) {
      scores.push(ts("finance", "high"));
    }
  }

  // Q13 — growth
  if (answers.growth !== undefined) {
    const v = answers.growth as string;
    if (v === "winning-more-work") {
      scores.push(ts("pipeline", "high"), ts("estimates", "high"));
    } else if (v === "getting-paid-faster") {
      scores.push(ts("finance", "high"));
    } else if (v === "better-organization") {
      scores.push(ts("office", "high"), ts("scheduling", "high"));
    } else if (v === "more-time-back") {
      scores.push(ts("scheduling", "high"), ts("field-ops", "high"));
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// inferUnansweredTags
// ---------------------------------------------------------------------------

/**
 * Infers tag scores for gaps in the user's answers based on cross-signal
 * heuristics. Direct answers always override these inferences.
 */
export function inferUnansweredTags(
  answers: Record<string, string | number>
): TagScore[] {
  const inferred: TagScore[] = [];

  // crew = "just-me" → scheduling is lower complexity, time tracking low need
  if (answers.crew === "just-me") {
    if (answers.scheduling === undefined) {
      inferred.push(ts("scheduling", "low"));
    }
    if (answers.time === undefined) {
      inferred.push(ts("field-ops", "low"));
    }
  }

  // crew = "multiple-crews" or "office-and-field" → scheduling high, time tracking high
  if (answers.crew === "multiple-crews" || answers.crew === "office-and-field") {
    if (answers.scheduling === undefined) {
      inferred.push(ts("scheduling", "high"));
    }
    if (answers.time === undefined) {
      inferred.push(ts("field-ops", "high"));
    }
  }

  // invoicing is likert 1-2 → numbers is probably low too
  if (answers.invoicing !== undefined && Number(answers.invoicing) <= 2) {
    if (answers.numbers === undefined) {
      inferred.push(ts("finance", "high"));
    }
  }

  // numbers is likert 4-5 → invoicing is probably fine
  if (answers.numbers !== undefined && Number(answers.numbers) >= 4) {
    if (answers.invoicing === undefined) {
      inferred.push(ts("finance", "low"));
    }
  }

  // estimates = "pen-paper" → close_rate is likely low
  if (answers.estimates === "pen-paper") {
    if (answers.close_rate === undefined) {
      inferred.push(ts("pipeline", "high"), ts("estimates", "high"));
    }
  }

  // estimates = "software" → close_rate is likely reasonable
  if (answers.estimates === "software") {
    if (answers.close_rate === undefined) {
      inferred.push(ts("pipeline", "low"));
    }
  }

  // projects = "20+" → crew is not "just-me", scheduling is high
  if (answers.projects === "20+") {
    if (answers.crew === undefined) {
      inferred.push(ts("field-ops", "high"));
    }
    if (answers.scheduling === undefined) {
      inferred.push(ts("scheduling", "high"));
    }
  }

  // projects = "1-3" → possibly solo or small crew
  if (answers.projects === "1-3") {
    if (answers.crew === undefined) {
      inferred.push(ts("field-ops", "low"));
    }
  }

  // growth = "winning-more-work" → boost pipeline, estimates
  if (answers.growth === "winning-more-work") {
    if (answers.close_rate === undefined) {
      inferred.push(ts("pipeline", "high"));
    }
    if (answers.estimates === undefined) {
      inferred.push(ts("estimates", "high"));
    }
  }

  // growth = "getting-paid-faster" → boost finance
  if (answers.growth === "getting-paid-faster") {
    if (answers.invoicing === undefined && answers.numbers === undefined) {
      inferred.push(ts("finance", "high"));
    }
  }

  // Fallback: any tag not yet covered gets medium priority
  const coveredTags = new Set<WidgetTag>();
  // Gather tags from direct answers
  const directScores = getActiveTagsFromAnswers(answers);
  for (const s of directScores) coveredTags.add(s.tag);
  // Gather tags from inferences so far
  for (const s of inferred) coveredTags.add(s.tag);

  const allTags: WidgetTag[] = [
    "scheduling",
    "finance",
    "field-ops",
    "office",
    "pipeline",
    "clients",
    "estimates",
  ];
  for (const tag of allTags) {
    if (!coveredTags.has(tag)) {
      inferred.push(ts(tag, "medium"));
    }
  }

  return inferred;
}

// ---------------------------------------------------------------------------
// getQualificationFlags
// ---------------------------------------------------------------------------

/**
 * Returns boolean flags derived from specific answers for downstream use.
 */
export function getQualificationFlags(
  answers: Record<string, string | number>
): Record<string, boolean> {
  const flags: Record<string, boolean> = {};

  // email_priority — inquiries likert 4-5
  if (answers.inquiries !== undefined && Number(answers.inquiries) >= 4) {
    flags.email_priority = true;
  }

  // inventory_priority — inventory = "yes"
  if (answers.inventory === "yes") {
    flags.inventory_priority = true;
  }

  // bills_hourly — schedule_detail = "by-the-hour"
  if (answers.schedule_detail === "by-the-hour") {
    flags.bills_hourly = true;
  }

  // subcontractor — crew = "office-and-field" or "multiple-crews"
  if (answers.crew === "office-and-field" || answers.crew === "multiple-crews") {
    flags.subcontractor = true;
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Merge helper — resolves duplicate tags by keeping the highest priority
// ---------------------------------------------------------------------------

function mergeTagScores(
  directScores: TagScore[],
  inferredScores: TagScore[]
): Map<WidgetTag, TagPriority> {
  const merged = new Map<WidgetTag, TagPriority>();

  // Direct answers take precedence
  for (const s of directScores) {
    const existing = merged.get(s.tag);
    if (!existing || PRIORITY_WEIGHT[s.priority] > PRIORITY_WEIGHT[existing]) {
      merged.set(s.tag, s.priority);
    }
  }

  // Inferences fill gaps only (do not override direct answers)
  const directTags = new Set(directScores.map((s) => s.tag));
  for (const s of inferredScores) {
    if (directTags.has(s.tag)) continue; // direct answer already covers this tag
    const existing = merged.get(s.tag);
    if (!existing || PRIORITY_WEIGHT[s.priority] > PRIORITY_WEIGHT[existing]) {
      merged.set(s.tag, s.priority);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// getDefaultWidgetInstancesFromSetup
// ---------------------------------------------------------------------------

/**
 * Given starfield answers, returns an ordered array of default WidgetInstance[]
 * with high-priority tag widgets first, then medium, then low.
 */
export function getDefaultWidgetInstancesFromSetup(
  answers: Record<string, string | number>,
  _companySize?: string
): WidgetInstance[] {
  // 1. Essential tag is always active
  const activeTags = new Map<WidgetTag, TagPriority>();
  activeTags.set("essential", "high");

  // 2. Direct answer scores
  const directScores = getActiveTagsFromAnswers(answers);

  // 3. Inference scores
  const inferredScores = inferUnansweredTags(answers);

  // 4. Merge — direct answers override inferences
  const merged = mergeTagScores(directScores, inferredScores);
  for (const [tag, priority] of merged) {
    activeTags.set(tag, priority);
  }

  // 5. If crew="just-me", remove field-ops even if inferred
  if (answers.crew === "just-me") {
    activeTags.delete("field-ops");
  }

  // 6. Build scored widget list
  interface ScoredWidget {
    typeId: WidgetTypeId;
    bestPriority: TagPriority;
  }

  const scoredWidgets: ScoredWidget[] = [];

  for (const typeId of ALL_WIDGET_TYPE_IDS) {
    const entry = WIDGET_TYPE_REGISTRY[typeId];
    let bestPriority: TagPriority | null = null;

    for (const tag of entry.tags) {
      const priority = activeTags.get(tag);
      if (priority !== undefined) {
        if (
          bestPriority === null ||
          PRIORITY_WEIGHT[priority] > PRIORITY_WEIGHT[bestPriority]
        ) {
          bestPriority = priority;
        }
      }
    }

    if (bestPriority !== null) {
      scoredWidgets.push({ typeId, bestPriority });
    }
  }

  // 7. Sort: high-priority first, then medium, then low
  scoredWidgets.sort(
    (a, b) => PRIORITY_WEIGHT[b.bestPriority] - PRIORITY_WEIGHT[a.bestPriority]
  );

  // 8. Create instances
  return scoredWidgets.map((sw) => createWidgetInstance(sw.typeId));
}
