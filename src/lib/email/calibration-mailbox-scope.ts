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
        (connection.type === "individual" && connection.user_id === userId))
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
    for (const [category, level] of Object.entries(configured)) {
      if (typeof level !== "string") continue;
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
