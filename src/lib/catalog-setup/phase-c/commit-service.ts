import { createHash } from "crypto";
import type { CatalogSetupPayload } from "@/lib/catalog-setup/commit/payload-builder.types";
import { buildCatalogSetupPayload } from "@/lib/catalog-setup/commit/payload-builder";
import { CatalogBlueprintSchema } from "./schemas";
import {
  buildResolvedProductInput,
  compileCatalogExecutionBlueprint,
} from "./execution-plan";
import type { CatalogAction, CatalogBlueprint } from "./types";
import {
  CATALOG_CAPABILITY_MANIFEST_REVISION,
  guidedCapabilityForAction,
} from "./catalog-capability-manifest";
import {
  unresolvedCatalogActionReferences,
  validateCatalogActionPayload,
} from "./action-payload-contracts";

export class GuidedCapabilityManifestConflictError extends Error {
  constructor() {
    super(
      "Phase C capability manifest changed or contains unavailable actions",
    );
    this.name = "GuidedCapabilityManifestConflictError";
  }
}

export interface CatalogCommitStart {
  operationId: string;
  replayed: boolean;
  status: string;
  readback?: Record<string, unknown>;
}

export interface CatalogSaveResult {
  ok: boolean;
  idMap: Record<string, string>;
  blockers?: Array<Record<string, unknown>>;
}

export interface CatalogArchiveResult {
  ok: boolean;
  references?: Record<string, number>;
}

export interface CatalogGuidedCommitAdapter {
  begin(sessionId: string, approvalHash: string): Promise<CatalogCommitStart>;
  loadBlueprint(sessionId: string): Promise<CatalogBlueprint>;
  markActions(
    sessionId: string,
    actionKeys: string[],
    status: "running" | "committed" | "verified" | "failed",
    detail?: Record<string, unknown>,
  ): Promise<void>;
  resolveTaskType(action: CatalogAction): Promise<string>;
  upsertTaxRate(action: CatalogAction): Promise<string>;
  saveCatalog(
    idempotencyKey: string,
    payload: CatalogSetupPayload,
  ): Promise<CatalogSaveResult>;
  upsertSupplierCost(action: CatalogAction, idMap: Record<string, string>): Promise<string>;
  upsertMaterialRule(action: CatalogAction, idMap: Record<string, string>): Promise<string>;
  upsertCapability(action: CatalogAction, idMap: Record<string, string>): Promise<string>;
  upsertVerification(action: CatalogAction): Promise<string>;
  archiveVariant(
    sessionId: string,
    action: CatalogAction,
  ): Promise<CatalogArchiveResult>;
  archiveOption(action: CatalogAction): Promise<boolean>;
  readback(): Promise<Record<string, unknown>>;
  finish(
    sessionId: string,
    operationId: string,
    success: boolean,
    readback: Record<string, unknown>,
    journal: Array<Record<string, unknown>>,
  ): Promise<unknown>;
}

export interface ExecuteGuidedCatalogCommitParams {
  sessionId: string;
  approvalHash: string;
  adapter: CatalogGuidedCommitAdapter;
}

export interface GuidedCatalogCommitResult {
  ok: boolean;
  status: "complete" | "attention";
  replayed: boolean;
  operationId: string;
  readback: Record<string, unknown>;
  blockers: Array<Record<string, unknown>>;
}

function payloadKey(
  sessionId: string,
  operationId: string,
  slot: string,
  payload: CatalogSetupPayload,
): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16);
  return `${sessionId}:${operationId}:${slot}:${hash}`;
}

function initialIdMap(blueprint: CatalogBlueprint): Record<string, string> {
  return Object.fromEntries(
    blueprint.actions.flatMap((action) =>
      action.clientId && action.existingId
        ? [[action.clientId, action.existingId]]
        : [],
    ),
  );
}

function familyActionKeys(
  blueprint: CatalogBlueprint,
  familyRef: string,
): string[] {
  const optionRefs = new Set(
    blueprint.actions.flatMap((action) =>
      action.actionType === "upsert_catalog_option" &&
      action.payload.familyRef === familyRef &&
      action.clientId
        ? [action.clientId]
        : [],
    ),
  );
  const variantRefs = new Set(
    blueprint.actions.flatMap((action) =>
      (action.actionType === "upsert_catalog_variant" ||
        action.actionType === "move_catalog_variant") &&
      (action.payload.familyRef === familyRef ||
        action.payload.destinationFamilyRef === familyRef) &&
      action.clientId
        ? [action.clientId]
        : [],
    ),
  );

  return blueprint.actions.flatMap((action) => {
    const belongs =
      (action.actionType === "upsert_catalog_family" &&
        action.clientId === familyRef) ||
      (action.actionType === "upsert_catalog_option" &&
        action.payload.familyRef === familyRef) ||
      (action.actionType === "upsert_catalog_option_value" &&
        optionRefs.has(String(action.payload.optionRef ?? ""))) ||
      ((action.actionType === "upsert_catalog_variant" ||
        action.actionType === "move_catalog_variant") &&
        (action.payload.familyRef === familyRef ||
          action.payload.destinationFamilyRef === familyRef)) ||
      (action.actionType === "replace_variant_option_values" &&
        variantRefs.has(String(action.payload.variantRef ?? "")));
    return belongs ? [action.actionKey] : [];
  });
}

function productActionKeys(
  blueprint: CatalogBlueprint,
): string[] {
  return blueprint.actions.flatMap((action) =>
    [
      "upsert_product",
      "upsert_product_option",
      "upsert_product_option_value",
      "map_product_catalog_option",
      "upsert_product_material",
    ].includes(action.actionType)
      ? [action.actionKey]
      : [],
  );
}

function record(
  journal: Array<Record<string, unknown>>,
  stage: string,
  detail: Record<string, unknown> = {},
) {
  journal.push({
    stage,
    at: new Date().toISOString(),
    ...detail,
  });
}

async function finishAttention(
  params: ExecuteGuidedCatalogCommitParams,
  operationId: string,
  journal: Array<Record<string, unknown>>,
  blockers: Array<Record<string, unknown>>,
): Promise<GuidedCatalogCommitResult> {
  let live: Record<string, unknown> = {};
  try {
    live = await params.adapter.readback();
  } catch (error) {
    live = {
      readbackError:
        error instanceof Error ? error.message : "Readback failed",
    };
  }
  const readback = { ...live, blockers };
  await params.adapter.finish(
    params.sessionId,
    operationId,
    false,
    readback,
    journal,
  );
  return {
    ok: false,
    status: "attention",
    replayed: false,
    operationId,
    readback,
    blockers,
  };
}

/**
 * Executes a plan loaded from the durable server session. Browser input is
 * limited to the session id and exact reviewed-plan hash.
 */
export async function executeGuidedCatalogCommit(
  params: ExecuteGuidedCatalogCommitParams,
): Promise<GuidedCatalogCommitResult> {
  let blueprint: CatalogBlueprint;
  try {
    blueprint = CatalogBlueprintSchema.parse(
      await params.adapter.loadBlueprint(params.sessionId),
    );
  } catch (error) {
    if (error instanceof GuidedCapabilityManifestConflictError) throw error;
    throw new GuidedCapabilityManifestConflictError();
  }
  if (
    blueprint.capabilityRevision !==
      CATALOG_CAPABILITY_MANIFEST_REVISION ||
    blueprint.actions.some(
      (action) =>
        guidedCapabilityForAction(action.actionType)?.available !== true ||
        !validateCatalogActionPayload(
          action.actionType,
          action.payload,
        ).success,
    ) ||
    unresolvedCatalogActionReferences(blueprint.actions).length > 0
  ) {
    throw new GuidedCapabilityManifestConflictError();
  }

  const start = await params.adapter.begin(
    params.sessionId,
    params.approvalHash,
  );
  if (start.status === "complete") {
    return {
      ok: true,
      status: "complete",
      replayed: true,
      operationId: start.operationId,
      readback: start.readback ?? {},
      blockers: [],
    };
  }

  const journal: Array<Record<string, unknown>> = [];
  const execution = compileCatalogExecutionBlueprint(blueprint);
  const idMap = initialIdMap(blueprint);

  try {
    for (const action of execution.taskTypes) {
      await params.adapter.markActions(
        params.sessionId,
        [action.actionKey],
        "running",
      );
      const id = await params.adapter.resolveTaskType(action);
      if (action.clientId) idMap[action.clientId] = id;
      await params.adapter.markActions(
        params.sessionId,
        [action.actionKey],
        "verified",
        { id },
      );
    }
    record(journal, "task_types", { count: execution.taskTypes.length });

    for (const action of execution.taxRates) {
      await params.adapter.markActions(
        params.sessionId,
        [action.actionKey],
        "running",
      );
      const id = await params.adapter.upsertTaxRate(action);
      if (action.clientId) idMap[action.clientId] = id;
      await params.adapter.markActions(
        params.sessionId,
        [action.actionKey],
        "verified",
        { id },
      );
    }
    record(journal, "tax_rates", { count: execution.taxRates.length });

    for (const entry of execution.families) {
      const familyRef = entry.family.clientId ?? entry.family.name;
      const actionKeys = familyActionKeys(blueprint, familyRef);
      await params.adapter.markActions(
        params.sessionId,
        actionKeys,
        "running",
      );
      const payload = buildCatalogSetupPayload({
        mode: "edit",
        family: entry.family,
      });
      const result = await params.adapter.saveCatalog(
        payloadKey(
          params.sessionId,
          start.operationId,
          `family:${familyRef}`,
          payload,
        ),
        payload,
      );
      if (!result.ok || result.blockers?.length) {
        await params.adapter.markActions(
          params.sessionId,
          actionKeys,
          "failed",
          { blockers: result.blockers ?? [] },
        );
        return finishAttention(
          params,
          start.operationId,
          journal,
          result.blockers ?? [
            { code: "family_commit_failed", familyRef },
          ],
        );
      }
      Object.assign(idMap, result.idMap);
      await params.adapter.markActions(
        params.sessionId,
        actionKeys,
        "verified",
        { idMap: result.idMap },
      );
    }
    record(journal, "catalog_families", {
      count: execution.families.length,
    });

    const products = execution.products.map((product) =>
      buildResolvedProductInput(product, idMap),
    );
    if (products.length > 0) {
      const actionKeys = productActionKeys(blueprint);
      await params.adapter.markActions(
        params.sessionId,
        actionKeys,
        "running",
      );
      const payload = buildCatalogSetupPayload({
        mode: "edit",
        products,
      });
      const result = await params.adapter.saveCatalog(
        payloadKey(
          params.sessionId,
          start.operationId,
          "products",
          payload,
        ),
        payload,
      );
      if (!result.ok || result.blockers?.length) {
        await params.adapter.markActions(
          params.sessionId,
          actionKeys,
          "failed",
          { blockers: result.blockers ?? [] },
        );
        return finishAttention(
          params,
          start.operationId,
          journal,
          result.blockers ?? [{ code: "product_commit_failed" }],
        );
      }
      Object.assign(idMap, result.idMap);
      await params.adapter.markActions(
        params.sessionId,
        actionKeys,
        "verified",
        { idMap: result.idMap },
      );
    }
    record(journal, "products", { count: products.length });

    for (const action of execution.supplierCostProfiles) {
      const id = await params.adapter.upsertSupplierCost(action, idMap);
      if (action.clientId) idMap[action.clientId] = id;
      await params.adapter.markActions(
        params.sessionId,
        [action.actionKey],
        "verified",
        { id },
      );
    }
    for (const action of execution.materialRules) {
      const id = await params.adapter.upsertMaterialRule(action, idMap);
      if (action.clientId) idMap[action.clientId] = id;
      await params.adapter.markActions(
        params.sessionId,
        [action.actionKey],
        "verified",
        { id },
      );
    }
    for (const action of execution.capabilityBindings) {
      const id = await params.adapter.upsertCapability(action, idMap);
      if (action.clientId) idMap[action.clientId] = id;
      await params.adapter.markActions(
        params.sessionId,
        [action.actionKey],
        "verified",
        { id },
      );
    }
    for (const action of execution.verificationItems) {
      const id = await params.adapter.upsertVerification(action);
      if (action.clientId) idMap[action.clientId] = id;
      await params.adapter.markActions(
        params.sessionId,
        [action.actionKey],
        "committed",
        { id },
      );
    }
    record(journal, "rules_and_capabilities", {
      supplierCosts: execution.supplierCostProfiles.length,
      materialRules: execution.materialRules.length,
      capabilities: execution.capabilityBindings.length,
    });

    const archiveBlockers: Array<Record<string, unknown>> = [];
    for (const action of execution.archives) {
      if (action.actionType === "archive_catalog_variant") {
        const result = await params.adapter.archiveVariant(
          params.sessionId,
          action,
        );
        if (!result.ok) {
          archiveBlockers.push({
            code: "variant_has_references",
            actionKey: action.actionKey,
            references: result.references ?? {},
          });
        }
      } else {
        const archived = await params.adapter.archiveOption(action);
        await params.adapter.markActions(
          params.sessionId,
          [action.actionKey],
          archived ? "verified" : "failed",
        );
        if (!archived) {
          archiveBlockers.push({
            code: "option_archive_failed",
            actionKey: action.actionKey,
          });
        }
      }
    }
    if (archiveBlockers.length > 0) {
      record(journal, "cleanup_attention", {
        blockers: archiveBlockers.length,
      });
      return finishAttention(
        params,
        start.operationId,
        journal,
        archiveBlockers,
      );
    }

    const readback = await params.adapter.readback();
    if (readback.status !== "verified") {
      const verificationIssues = Array.isArray(
        readback.verificationIssues,
      )
        ? readback.verificationIssues.filter(
            (issue): issue is Record<string, unknown> =>
              !!issue &&
              typeof issue === "object" &&
              !Array.isArray(issue),
          )
        : [{ code: "catalog_readback_failed" }];
      record(journal, "readback_attention", {
        blockers: verificationIssues.length,
      });
      await params.adapter.finish(
        params.sessionId,
        start.operationId,
        false,
        readback,
        journal,
      );
      return {
        ok: false,
        status: "attention",
        replayed: false,
        operationId: start.operationId,
        readback,
        blockers: verificationIssues,
      };
    }
    record(journal, "verified", { readback });
    await params.adapter.finish(
      params.sessionId,
      start.operationId,
      true,
      readback,
      journal,
    );
    return {
      ok: true,
      status: "complete",
      replayed: false,
      operationId: start.operationId,
      readback,
      blockers: [],
    };
  } catch (error) {
    const blocker = {
      code: "commit_stage_failed",
      message: error instanceof Error ? error.message : "Commit failed",
    };
    record(journal, "attention", blocker);
    return finishAttention(
      params,
      start.operationId,
      journal,
      [blocker],
    );
  }
}
