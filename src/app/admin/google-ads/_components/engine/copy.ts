/**
 * Google Ads engine console — every user-facing string in one place.
 * Product register: terse, sentence case for content, uppercase for authority,
 * no exclamation points, numbers formatted, `—` for empty.
 */
import type { ChangeVerdict, ProposalKind, ProposalState, TestState } from "@/lib/ads/engine/types";

export const LABELS = {
  proposals: "// PROPOSALS",
  tests: "// TESTS",
  funnel: "// FUNNEL BY KEYWORD",
  ledger: "// CHANGE LEDGER",
  engine: "// ENGINE",
  modes: "// MODES",
  caps: "// CAPS",
} as const;

export const EMPTY = {
  proposals: "No proposals waiting.",
  tests: "No test running.",
  funnel: "No paid traffic yet.",
  ledger: "Nothing applied yet.",
  runs: "The engine has not run yet.",
} as const;

export const ERROR = {
  load: "Could not load. Try again in a moment.",
  review: "The decision did not land. Try again.",
  settings: "The change did not save.",
} as const;

export const BUTTONS = {
  approve: "APPROVE",
  noted: "NOTED",
  reject: "REJECT",
  approveAll: (n: number) => `APPROVE ${n}`,
  save: "SAVE",
  cancel: "CANCEL",
  retry: "RETRY",
} as const;

export const REJECT_DIALOG = {
  title: "REJECT PROPOSAL",
  description: "Tell the engine why. It reads your reason on its next run.",
  placeholder: "Reason",
  cancel: "CANCEL",
  confirm: "REJECT",
} as const;

export const KIND_TAGS: Record<ProposalKind, string> = {
  add_negatives: "NEGATIVES",
  pause_keyword: "PAUSE KEYWORD",
  add_keywords: "KEYWORDS",
  create_rsa_challenger: "CHALLENGER AD",
  promote_challenger: "PROMOTE",
  pause_ad: "PAUSE AD",
  adjust_budget: "BUDGET",
  adjust_cpc_cap: "CPC CAP",
  set_bidding_strategy: "BIDDING",
  add_ad_group: "AD GROUP",
  observation: "NOTE",
};

export const KIND_NAMES: Record<ProposalKind, string> = {
  add_negatives: "Negative keywords",
  pause_keyword: "Pause keyword",
  add_keywords: "New keywords",
  create_rsa_challenger: "Challenger ad",
  promote_challenger: "Promote challenger",
  pause_ad: "Pause ad",
  adjust_budget: "Budget",
  adjust_cpc_cap: "CPC cap",
  set_bidding_strategy: "Bidding",
  add_ad_group: "New ad group",
  observation: "Observation",
};

export const STATE_TAGS: Record<ProposalState, string> = {
  proposed: "WAITING",
  approved: "APPROVED",
  rejected: "REJECTED",
  applied: "APPLIED",
  failed: "FAILED",
  expired: "EXPIRED",
};

export const OUTCOME_TAGS = {
  applied: "APPLIED",
  failed: "FAILED",
  validated: "VALIDATED · REHEARSAL",
  pending_google_unavailable: "QUEUED · GOOGLE UNREACHABLE",
  pending_apply_timeout: "QUEUED FOR THE WORKER",
  rejected: "REJECTED",
} as const;

export const TEST_STATE_TAGS: Record<TestState, string> = {
  running: "RUNNING",
  control_won: "CONTROL HELD",
  challenger_won: "CHALLENGER WON",
  no_verdict: "NO VERDICT",
  cancelled: "CANCELLED",
};

export const VERDICT_TAGS: Record<ChangeVerdict, string> = {
  pending: "MEASURING",
  better: "BETTER",
  worse: "WORSE",
  flat: "FLAT",
  no_verdict: "NO VERDICT",
};

export const HEALTH = {
  lastRun: "Last run",
  nextRun: "Next run",
  checkIn: "Last check-in",
  state: "State",
  google: "Google",
  snapshot: "Snapshot",
  stalled: "STALLED",
  checkedIn: "CHECKED IN",
  dark: "DARK",
  rehearsal: "REHEARSAL",
  googleAvailable: "reachable",
  googleUnavailable: "unreachable",
  humanOnly: "[stays with you in this version]",
  modeOptions: { propose: "PROPOSE", auto: "AUTO", off: "OFF" },
  caps: {
    monthly_cap: "Monthly cap",
    daily_cap: "Daily cap",
    max_budget_change_pct: "Max change %",
    budget_cooldown_days: "Cooldown days",
    max_structural_per_run: "Structural per run",
    target_cost_per_trial: "Target cost per trial",
  },
} as const;

export const FUNNEL_COLUMNS = {
  keyword: "Keyword",
  clicks: "Clicks",
  trials: "Trials",
  activated: "Activated",
  paid: "Paid",
  spend: "Spend",
  costPerTrial: "Per trial",
  costPerPaid: "Per paying",
} as const;

export const TESTS = {
  control: "CONTROL",
  challenger: "CHALLENGER",
  day: (day: number, min: number) => `day ${day} of ${min}`,
  impressions: "impr.",
  clicks: "clicks",
  ctr: "CTR",
  trials: "trials",
} as const;

export const LEDGER = {
  applied: "Applied",
  change: "Change",
  outcome: "Outcome",
  daysLeft: (n: number) => (n === 1 ? "1 day left" : `${n} days left`),
  ctrDelta: (pct: number) => `${pct > 0 ? "+" : ""}${pct.toFixed(1)}% CTR`,
} as const;

export const CARD = {
  engine: "// ENGINE",
  evidence: "// EVIDENCE",
  hypothesis: "Hypothesis",
  expires: (days: number) => (days <= 0 ? "[expires today]" : days === 1 ? "[expires tomorrow]" : `[expires in ${days} days]`),
  auto: "AUTO",
  worker: "FROM A TEST VERDICT",
  terms: (n: number) => (n === 1 ? "1 term" : `${n} terms`),
  keywords: (n: number) => (n === 1 ? "1 keyword" : `${n} keywords`),
  ads: (n: number) => (n === 1 ? "1 ad" : `${n} ads`),
  reviewedBy: (who: string) => `Reviewed by ${who}`,
} as const;
