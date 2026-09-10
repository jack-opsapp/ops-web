/**
 * Applying the account blueprint, and the one door that enables a campaign.
 *
 * Two rules govern everything here.
 *
 * `validateOnly` runs before every real mutate, and the real mutate is sent
 * only on a clean pass. `partialFailure` is OFF, so a rejected ad fails the
 * whole tree rather than leaving half an account behind.
 *
 * Nothing in this file can turn a campaign on except `enableCampaigns`, and
 * that refuses unless the campaign carries the `engine` label and has at least
 * two ads Google has actually approved. Jackson's approval is a human step in
 * front of it; this is the machine's half of the same gate.
 *
 * The apply runs in two passes because labels attach only to entities that
 * exist. Pass one creates the tree; the snapshot is refreshed; pass two labels
 * what pass one created. A third pass is never needed, and if the planner still
 * wants operations after two, that is reported rather than looped on.
 */
import type { Blueprint } from "./blueprint";
import {
  planBlueprint,
  toMutateOperations,
  describePlan,
  type MutateOperation,
  type PlannedOperation,
} from "./blueprint-planner";
import type { EntitySnapshot } from "./engine/types";

export interface MutateFailure {
  index: number | null;
  code: string;
  message: string;
  topics?: string[];
}

export interface MutateResult {
  results: Array<Record<string, unknown>>;
  failures: MutateFailure[];
  requestId?: string;
}

export interface BlueprintGateway {
  mutate(
    operations: MutateOperation[],
    options: { validateOnly: boolean; partialFailure: boolean }
  ): Promise<MutateResult>;
}

export interface BlueprintRepository {
  readSnapshot(): Promise<EntitySnapshot>;
  refreshSnapshot(): Promise<void>;
  record(id: string, payload: Record<string, unknown>): Promise<void>;
}

export const BLUEPRINT_APPLY_ROW = "blueprint-apply";
export const CAMPAIGN_ENABLE_ROW = "campaign-enable";
export const MAX_PASSES = 2;
/** Google requires at least two ads per ad group; we require them approved. */
export const MIN_APPROVED_ADS = 2;

export interface PassRecord {
  pass: number;
  operations: number;
  describe: string[];
  validation: { failures: MutateFailure[]; requestId: string | null };
  applied: boolean;
  result: { failures: MutateFailure[]; requestId: string | null } | null;
}

export interface BlueprintApplyOutcome {
  blueprintVersion: string;
  validateOnly: boolean;
  /** True when a final re-plan wanted nothing: the account matches the file. */
  converged: boolean;
  operations: number;
  passes: PassRecord[];
  failures: MutateFailure[];
  requestId: string | null;
  /** Every campaign the apply touched, with the status it is left in. */
  campaigns: Array<{ name: string; status: string; labels: string[] }>;
  finishedAt: string;
}

const slim = (result: MutateResult) => ({
  failures: result.failures,
  requestId: result.requestId ?? null,
});

/**
 * Plan, validate, apply — up to two passes, with the snapshot refreshed
 * between them. Returns everything the artifact needs and nothing it does not.
 */
export async function applyBlueprint({
  blueprint,
  gateway,
  repository,
  validateOnly,
  now = () => new Date(),
}: {
  blueprint: Blueprint;
  gateway: BlueprintGateway;
  repository: BlueprintRepository;
  validateOnly: boolean;
  now?: () => Date;
}): Promise<BlueprintApplyOutcome> {
  const passes: PassRecord[] = [];
  let snapshot = await refreshed(repository);
  let plan: PlannedOperation[] = planBlueprint(blueprint, snapshot);
  let failures: MutateFailure[] = [];
  let requestId: string | null = null;

  for (let pass = 1; pass <= MAX_PASSES && plan.length > 0; pass += 1) {
    const operations = toMutateOperations(plan);
    const validation = await gateway.mutate(operations, {
      validateOnly: true,
      partialFailure: false,
    });
    const record: PassRecord = {
      pass,
      operations: operations.length,
      describe: describePlan(plan),
      validation: slim(validation),
      applied: false,
      result: null,
    };
    passes.push(record);
    requestId = validation.requestId ?? requestId;

    if (validation.failures.length > 0) {
      failures = validation.failures;
      break;
    }
    if (validateOnly) break;

    const applied = await gateway.mutate(operations, {
      validateOnly: false,
      partialFailure: false,
    });
    record.applied = true;
    record.result = slim(applied);
    requestId = applied.requestId ?? requestId;
    if (applied.failures.length > 0) {
      failures = applied.failures;
      break;
    }

    snapshot = await refreshed(repository);
    plan = planBlueprint(blueprint, snapshot);
  }

  const outcome: BlueprintApplyOutcome = {
    blueprintVersion: blueprint.version,
    validateOnly,
    converged: failures.length === 0 && (validateOnly ? false : plan.length === 0),
    operations: passes.reduce((total, entry) => total + entry.operations, 0),
    passes,
    failures,
    requestId,
    campaigns: blueprint.campaigns.map((campaign) => {
      const live = snapshot.campaigns.find((c) => c.name === campaign.name);
      return {
        name: campaign.name,
        status: live?.status ?? "NOT CREATED",
        labels: live?.labels ?? [],
      };
    }),
    finishedAt: now().toISOString(),
  };
  await repository.record(BLUEPRINT_APPLY_ROW, outcome as unknown as Record<string, unknown>);
  return outcome;
}

async function refreshed(repository: BlueprintRepository): Promise<EntitySnapshot> {
  await repository.refreshSnapshot();
  return repository.readSnapshot();
}

// ─── The enable gate ─────────────────────────────────────────────────────────

export type EnableConfirm = "ENABLE" | "PAUSE";

export interface EnableRefusal {
  campaign: string;
  reason: string;
}

export interface EnableOutcome {
  confirm: EnableConfirm;
  requested: string[];
  /** Campaigns that passed every check and were sent to Google. */
  changed: Array<{ name: string; resourceName: string; from: string; to: string }>;
  refused: EnableRefusal[];
  validation: { failures: MutateFailure[]; requestId: string | null } | null;
  result: { failures: MutateFailure[]; requestId: string | null } | null;
  finishedAt: string;
}

/**
 * The only path that changes a campaign's status.
 *
 * A campaign may be enabled only when it carries the `engine` label — proof
 * the blueprint built it and not a hand edit — and only when Google has
 * approved at least two of its ads. Pausing has no such gate: stopping spend
 * is always allowed.
 */
export async function enableCampaigns({
  names,
  confirm,
  gateway,
  repository,
  now = () => new Date(),
}: {
  names: string[];
  confirm: EnableConfirm;
  gateway: BlueprintGateway;
  repository: BlueprintRepository;
  now?: () => Date;
}): Promise<EnableOutcome> {
  const snapshot = await repository.readSnapshot();
  const target = confirm === "ENABLE" ? "ENABLED" : "PAUSED";
  const changed: EnableOutcome["changed"] = [];
  const refused: EnableRefusal[] = [];
  const operations: MutateOperation[] = [];

  for (const name of names) {
    const campaign = snapshot.campaigns.find((c) => c.name === name);
    if (!campaign) {
      refused.push({ campaign: name, reason: "No campaign by that name in the account." });
      continue;
    }
    if (campaign.status === target) {
      refused.push({ campaign: name, reason: `Already ${target}.` });
      continue;
    }
    if (confirm === "ENABLE") {
      if (!campaign.labels.includes("engine")) {
        refused.push({
          campaign: name,
          reason:
            "Missing the engine label. Only campaigns the blueprint built can be enabled.",
        });
        continue;
      }
      const approved = approvedAdCount(snapshot, campaign.resourceName);
      if (approved < MIN_APPROVED_ADS) {
        refused.push({
          campaign: name,
          reason: `${approved} approved ads; Google must approve at least ${MIN_APPROVED_ADS} before this campaign can spend.`,
        });
        continue;
      }
    }
    changed.push({
      name,
      resourceName: campaign.resourceName,
      from: campaign.status,
      to: target,
    });
    operations.push({
      campaignOperation: {
        update: { resourceName: campaign.resourceName, status: target },
        updateMask: "status",
      },
    });
  }

  let validation: EnableOutcome["validation"] = null;
  let result: EnableOutcome["result"] = null;

  if (operations.length > 0) {
    const checked = await gateway.mutate(operations, {
      validateOnly: true,
      partialFailure: false,
    });
    validation = slim(checked);
    if (checked.failures.length === 0) {
      const applied = await gateway.mutate(operations, {
        validateOnly: false,
        partialFailure: false,
      });
      result = slim(applied);
      if (applied.failures.length === 0) await repository.refreshSnapshot();
    }
  }

  const outcome: EnableOutcome = {
    confirm,
    requested: names,
    changed: result?.failures.length ? [] : changed,
    refused,
    validation,
    result,
    finishedAt: now().toISOString(),
  };
  await repository.record(CAMPAIGN_ENABLE_ROW, outcome as unknown as Record<string, unknown>);
  return outcome;
}

/** Ads Google has approved, on enabled ad groups, under one campaign. */
export function approvedAdCount(
  snapshot: EntitySnapshot,
  campaignResourceName: string
): number {
  const groups = new Set(
    snapshot.adGroups
      .filter((group) => group.campaignResourceName === campaignResourceName)
      .map((group) => group.resourceName)
  );
  return snapshot.ads.filter(
    (ad) =>
      groups.has(ad.adGroupResourceName) &&
      ad.status === "ENABLED" &&
      ad.approvalStatus === "APPROVED"
  ).length;
}
