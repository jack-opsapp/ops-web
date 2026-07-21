import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";

export interface CalibrationConnectionRow {
  id: string;
  type: string;
  user_id: string | null;
  status: string;
  auto_send_settings?: unknown;
  sync_filters?: unknown;
}

export interface CalibrationMilestoneProjection {
  draft_available_shown: boolean;
  auto_draft_suggested: boolean;
  auto_send_suggested: boolean;
  comms_wizard_ready_shown: boolean;
}

const EMPTY_CALIBRATION_MILESTONES: CalibrationMilestoneProjection = {
  draft_available_shown: false,
  auto_draft_suggested: false,
  auto_send_suggested: false,
  comms_wizard_ready_shown: false,
};

const PRIMARY_CATEGORIES = new Set<string>(EMAIL_THREAD_CATEGORIES);

export interface CalibrationCategoryReadinessProjection {
  connectionId: string;
  category: EmailThreadCategory;
  ready: boolean;
  sampleSize: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function selectActorCalibrationConnections<
  T extends CalibrationConnectionRow,
>(
  rows: T[],
  userId: string,
  visibleCompanyConnectionIds: "all" | ReadonlySet<string>
): T[] {
  return rows.filter(
    (connection) =>
      connection.status === "active" &&
      ((connection.type === "company" &&
        (visibleCompanyConnectionIds === "all" ||
          visibleCompanyConnectionIds.has(connection.id))) ||
        (connection.type === "individual" &&
          connection.user_id?.trim() === userId.trim()))
  );
}

export function aggregateCalibrationConnectionConfig(
  rows: CalibrationConnectionRow[]
): {
  categoryLevels: string[];
  categoryAutonomy: Record<string, string>;
  rulesCount: number;
} {
  const categoryLevels: string[] = [];
  const categoryAutonomy: Record<string, string> = {};
  let rulesCount = 0;

  for (const connection of rows) {
    const settings = record(connection.auto_send_settings);
    const configured = record(settings.category_autonomy);
    for (const [storageKey, level] of Object.entries(configured)) {
      if (typeof level !== "string") continue;
      if (!storageKey.startsWith("primary:")) continue;
      const category = storageKey.slice("primary:".length);
      if (!PRIMARY_CATEGORIES.has(category)) continue;
      categoryLevels.push(level);
      categoryAutonomy[category] = level;
    }

    const syncFilters = record(connection.sync_filters);
    if (Array.isArray(syncFilters.rules)) {
      rulesCount += syncFilters.rules.length;
    }
  }

  return { categoryLevels, categoryAutonomy, rulesCount };
}

export function deriveCalibrationAutoSendLadder(input: {
  connections: CalibrationConnectionRow[];
  readiness: CalibrationCategoryReadinessProjection[];
  featureEnabled: boolean;
}): {
  readinessStatus: "complete" | "in_training" | "gated";
  activeStatus: "complete" | "gated";
} {
  const readyScopes = new Set(
    input.readiness
      .filter((status) => status.ready)
      .map((status) => `${status.connectionId}:${status.category}`)
  );
  const hasReadyCategory = readyScopes.size > 0;
  const hasTrainingCategory = input.readiness.some(
    (status) => status.sampleSize > 0
  );

  const hasActiveExactCategory = input.connections.some((connection) => {
    const settings = record(connection.auto_send_settings);
    const configured = record(settings.category_autonomy);
    return Object.entries(configured).some(([storageKey, level]) => {
      if (level !== "auto_send" && level !== "auto_follow_up") {
        return false;
      }
      if (!storageKey.startsWith("primary:")) return false;
      const category = storageKey.slice("primary:".length);
      if (!PRIMARY_CATEGORIES.has(category)) return false;
      return readyScopes.has(`${connection.id}:${category}`);
    });
  });

  return {
    readinessStatus: hasReadyCategory
      ? "complete"
      : hasTrainingCategory
        ? "in_training"
        : "gated",
    activeStatus:
      input.featureEnabled && hasActiveExactCategory ? "complete" : "gated",
  };
}

export function mergeCalibrationMilestones(
  states: CalibrationMilestoneProjection[]
): CalibrationMilestoneProjection {
  return states.reduce<CalibrationMilestoneProjection>(
    (merged, state) => ({
      draft_available_shown:
        merged.draft_available_shown || state.draft_available_shown,
      auto_draft_suggested:
        merged.auto_draft_suggested || state.auto_draft_suggested,
      auto_send_suggested:
        merged.auto_send_suggested || state.auto_send_suggested,
      comms_wizard_ready_shown:
        merged.comms_wizard_ready_shown || state.comms_wizard_ready_shown,
    }),
    { ...EMPTY_CALIBRATION_MILESTONES }
  );
}
