interface PhaseCLifecycleSupabaseLike {
  from(table: string): any;
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{
    data?: unknown;
    error?: { message?: string | null } | null;
  }>;
}

interface StageEvidenceRow {
  id: string;
  provider_message_id: string;
  occurred_at: string;
}

export interface PhaseCStageDecisionEvidence {
  sourceEventId: string;
  evidenceEventIds: string[];
  evidenceMessageIds: string[];
}

function normalizedUnique(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter((value) => value)),
  ];
}

/**
 * Load only durable, projected evidence for the exact opportunity, mailbox,
 * and provider threads that produced the stage evaluation. The newest event
 * is the correction-boundary source; the full returned set is audit evidence.
 */
export async function loadPhaseCStageDecisionEvidence(input: {
  supabase: PhaseCLifecycleSupabaseLike;
  companyId: string;
  opportunityId: string;
  connectionId: string;
  providerThreadIds: string[];
}): Promise<PhaseCStageDecisionEvidence> {
  const providerThreadIds = normalizedUnique(input.providerThreadIds);
  if (providerThreadIds.length === 0) {
    throw new Error("Phase C stage decision has no provider thread evidence");
  }

  let query = input.supabase
    .from("opportunity_correspondence_events")
    .select("id, provider_message_id, occurred_at")
    .eq("company_id", input.companyId)
    .eq("opportunity_id", input.opportunityId)
    .eq("connection_id", input.connectionId)
    .eq("is_meaningful", true)
    .eq("opportunity_projection_applied", true);
  query =
    providerThreadIds.length === 1
      ? query.eq("provider_thread_id", providerThreadIds[0])
      : query.in("provider_thread_id", providerThreadIds);
  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(
      `Phase C stage evidence lookup failed: ${error.message ?? "unknown error"}`
    );
  }

  const rows = ((data ?? []) as StageEvidenceRow[]).filter(
    (row) =>
      typeof row.id === "string" &&
      row.id.trim() !== "" &&
      typeof row.provider_message_id === "string" &&
      row.provider_message_id.trim() !== "" &&
      typeof row.occurred_at === "string" &&
      Number.isFinite(Date.parse(row.occurred_at))
  );
  if (rows.length === 0) {
    throw new Error(
      "Phase C stage decision has no exact meaningful projected event"
    );
  }

  return {
    sourceEventId: rows[0].id,
    evidenceEventIds: normalizedUnique(rows.map((row) => row.id)),
    evidenceMessageIds: normalizedUnique(
      rows.map((row) => row.provider_message_id)
    ),
  };
}

export interface AppliedPhaseCStageDecision {
  changed: boolean;
  stage: string;
  stageManuallySet: boolean;
  guardReason: string | null;
  decisionId: string;
}

/**
 * This intentionally uses two transactions. The immutable proposal receipt
 * commits first, so a crash or provider/runtime interruption before the guarded
 * apply leaves an independently observable decision that can be replayed.
 */
export async function recordAndApplyPhaseCStageDecision(input: {
  supabase: PhaseCLifecycleSupabaseLike;
  companyId: string;
  opportunityId: string;
  sourceEventId: string;
  evidenceEventIds: string[];
  evidenceMessageIds: string[];
  proposedStage: string;
  expectedStage: string;
  expectedAssignmentVersion: number;
  confidence: number;
  reason: string;
}): Promise<AppliedPhaseCStageDecision> {
  const evidenceEventIds = normalizedUnique(input.evidenceEventIds);
  const evidenceMessageIds = normalizedUnique(input.evidenceMessageIds);
  if (!evidenceEventIds.includes(input.sourceEventId)) {
    throw new Error(
      "Phase C stage decision source event must be included in evidence"
    );
  }
  if (evidenceMessageIds.length === 0) {
    throw new Error("Phase C stage decision has no message evidence");
  }
  if (
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    throw new Error("Phase C stage decision confidence is invalid");
  }
  if (
    !Number.isSafeInteger(input.expectedAssignmentVersion) ||
    input.expectedAssignmentVersion < 0
  ) {
    throw new Error("Phase C stage decision has no assignment snapshot");
  }
  if (!input.reason.trim()) {
    throw new Error("Phase C stage decision has no reason");
  }

  const receiptResponse = await input.supabase.rpc(
    "record_opportunity_lifecycle_decision",
    {
      p_company_id: input.companyId,
      p_opportunity_id: input.opportunityId,
      p_source_event_id: input.sourceEventId,
      p_decision_kind: "stage",
      p_decision_key: "active_stage",
      p_proposed_stage: input.proposedStage,
      p_proposed_outcome: null,
      p_confidence: input.confidence,
      p_evidence_event_ids: evidenceEventIds,
      p_evidence_message_ids: evidenceMessageIds,
      p_reason: input.reason.trim(),
      p_status: "proposed",
      p_review_reason: null,
    }
  );
  if (receiptResponse.error) {
    throw new Error(
      `Phase C lifecycle decision persistence failed: ${receiptResponse.error.message ?? "unknown error"}`
    );
  }
  const receipt = (
    Array.isArray(receiptResponse.data)
      ? receiptResponse.data[0]
      : receiptResponse.data
  ) as { id?: unknown } | null | undefined;
  if (!receipt || typeof receipt.id !== "string" || !receipt.id.trim()) {
    throw new Error(
      "Phase C lifecycle decision persistence returned no receipt"
    );
  }

  const applyResponse = await input.supabase.rpc(
    "apply_phase_c_opportunity_stage_decision",
    {
      p_company_id: input.companyId,
      p_opportunity_id: input.opportunityId,
      p_decision_id: receipt.id,
      p_expected_stage: input.expectedStage,
      p_expected_assignment_version: input.expectedAssignmentVersion,
    }
  );
  if (applyResponse.error) {
    throw new Error(
      `Phase C lifecycle decision apply failed: ${applyResponse.error.message ?? "unknown error"}`
    );
  }
  const applied = (
    Array.isArray(applyResponse.data)
      ? applyResponse.data[0]
      : applyResponse.data
  ) as
    | {
        changed?: unknown;
        stage?: unknown;
        stage_manually_set?: unknown;
        guard_reason?: unknown;
      }
    | null
    | undefined;
  if (
    !applied ||
    typeof applied.changed !== "boolean" ||
    typeof applied.stage !== "string" ||
    typeof applied.stage_manually_set !== "boolean" ||
    !(
      applied.guard_reason === null ||
      typeof applied.guard_reason === "string"
    )
  ) {
    throw new Error("Phase C lifecycle decision apply returned no result");
  }

  return {
    changed: applied.changed,
    stage: applied.stage,
    stageManuallySet: applied.stage_manually_set,
    guardReason: applied.guard_reason,
    decisionId: receipt.id,
  };
}
