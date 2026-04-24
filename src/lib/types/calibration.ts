/**
 * CALIBRATION — Shared Types
 *
 * Types for the /calibration destination: deck state, drill-in sections,
 * recent events, milestone ladder.
 */

export type CalibrationSection =
  | "inputs"
  | "corpus"
  | "config"
  | "activity"
  | "milestones";

export type InputSource = "interview" | "scan" | "mining";

export type InputStatus =
  | "not_run"
  | "running"
  | "complete"
  | "failed"
  | "skipped";

export interface InputState {
  source: InputSource;
  status: InputStatus;
  /** 0-100. Only meaningful when status === "running" or "complete". */
  percent: number;
  /** ISO timestamp of last run. */
  lastRunAt: string | null;
  currentJobId: string | null;
  progress?: {
    processed: number;
    total: number;
    factsExtracted: number;
  };
}

export interface DeckState {
  inputs: {
    interview: InputState;
    scan: InputState;
    mining: InputState;
    lastAnyRunAt: string | null;
  };
  corpus: {
    factCount: number;
    entityCount: number;
    todayFactCount: number;
    /** Writing profile confidence, 0.0 to 1.0. */
    writingConfidence: number;
    /** Sparkline — 7 numbers, oldest to newest. */
    last7DaysFactCounts: number[];
  };
  config: {
    emailTypeCounts: {
      off: number;
      draft: number;
      auto_draft: number;
      auto_send: number;
    };
    rulesCount: number;
    categoriesCount: number;
  };
  activity: {
    status: "idle" | "running" | "error";
    currentJob: null | {
      type: string;
      elapsedMs: number;
      progress?: { processed: number; total: number };
    };
    queuedCount: number;
    completedTodayCount: number;
  };
  milestones: {
    domains: {
      email: DomainStatus;
      projects: DomainStatus;
      invoice: DomainStatus;
      schedule: DomainStatus;
      comms: DomainStatus;
    };
    ladder: LadderPosition[];
    reachedCount: number;
    nextLadderName: string | null;
  };
}

export type DomainHealthStatus =
  | "nominal"
  | "learning"
  | "gated"
  | "unavailable";

export interface DomainStatus {
  status: DomainHealthStatus;
  confidence: number | null;
  /** Human-readable metric, e.g., "0.82" or "94%". */
  metric: string | null;
}

export interface LadderPosition {
  position: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  status: "complete" | "in_training" | "gated";
  /** Whether this position fires a persistent notification on transition. */
  persistent: boolean;
}

export type RecentEventType =
  | "scan"
  | "scan_complete"
  | "extraction"
  | "learning"
  | "draft"
  | "suggestion"
  | "milestone"
  | "confidence";

export interface RecentEvent {
  id: string;
  type: RecentEventType;
  /** Already-formatted uppercase label, e.g., "SCAN COMPLETE". */
  title: string;
  detail: string | null;
  /** ISO timestamp. */
  createdAt: string;
  sourceTable:
    | "agent_memories"
    | "gmail_scan_jobs"
    | "agent_actions"
    | "email_thread_category_corrections";
  sourceId: string;
}

export interface ActivityFilters {
  types: RecentEventType[] | "all";
  timeRange: "hour" | "day" | "week" | "month" | "all";
}

export interface FirstRunState {
  /** users.preferences.calibrationFirstRunDismissed. */
  dismissed: boolean;
  /** EXISTS agent_memories WHERE source='intake_interview'. */
  interviewDone: boolean;
  /** EXISTS gmail_scan_jobs WHERE status='complete'. */
  scanDone: boolean;
  /** EXISTS agent_memories WHERE source='database'. */
  miningDone: boolean;
  /** Derived: !dismissed && !(interviewDone && scanDone && miningDone). */
  shouldShowWizard: boolean;
}
