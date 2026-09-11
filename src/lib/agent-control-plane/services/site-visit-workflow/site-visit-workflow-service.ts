import "server-only";
import { z } from "zod-v4";
import type { ActorAuthorityRepository } from "../../actor/authority-repository";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "../../actor/authority-repository";
import { authorizeCapability } from "../../actor/authorize-capability";
import { ActorAccessError, authorizationInternal } from "../../actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "../../actor/resolve-actor-context";
import { reauthorizeResolvedMcpActor } from "../../mcp/actor-reauthorization";
import { resolveSiteVisitWorkflowCapabilityAuthorization } from "../../registry/capability-manifest";
import {
  SITE_VISIT_TOOL_OPERATIONS,
  SITE_VISIT_WORKFLOW_MANIFEST,
  SITE_VISIT_WORKFLOW_REVISION,
  SiteVisitWorkflowRequestSchema,
  SiteVisitWorkflowReadRequestSchema,
  SiteVisitWorkflowResultSchema,
  SiteVisitWorkflowReadResultSchema,
  SiteVisitWorkflowProposalSchema,
  siteVisitToolInputSchema,
  type SiteVisitWorkflowTool,
  type SiteVisitWorkflowRequest,
  type SiteVisitWorkflowProposal,
  type SiteVisitWorkflowResult,
  type SiteVisitWorkflowReadResult,
} from "../../contracts/site-visit-workflow";
import type { ScheduleChangeRpcClient } from "../schedule-change/schedule-change-repository";
import { verifySiteVisitTimezoneProof } from "./civil-time";
import { assertSiteVisitReceiptBinding } from "../../contracts/site-visit-workflow-binding";

type Options = { signal?: AbortSignal };
type Method = (
  actor: ActorContext,
  input: unknown,
  options?: Options
) => Promise<SiteVisitWorkflowResult | SiteVisitWorkflowReadResult>;
export interface SiteVisitWorkflowService {
  listSiteVisitTemplates: Method;
  getSiteVisitTemplate: Method;
  getSiteVisitForm: Method;
  getSiteVisitSource: Method;
  prepareSiteVisitBooking: Method;
  prepareSiteVisitReschedule: Method;
  prepareSiteVisitBookingCancellation: Method;
  prepareSiteVisitTemplate: Method;
  prepareSiteVisitTemplateEdit: Method;
  prepareSiteVisitChecklistSelection: Method;
  prepareSiteVisitAnswers: Method;
}
const trusted = new WeakSet<object>();
export function siteVisitWorkflowActorBinding(actor: ActorContext) {
  if (
    !isActorContext(actor) ||
    actor.capabilityManifestRevision !== SITE_VISIT_WORKFLOW_MANIFEST
  )
    throw new TypeError("A current site visit actor is required");
  return {
    actor: actor.actorUserId,
    company: actor.companyId,
    channel: actor.auth.channel,
    manifest: SITE_VISIT_WORKFLOW_MANIFEST,
    permission_revision: actor.permissionSnapshotRevision,
    permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    grant: actor.auth.channel === "mcp" ? actor.auth.oauthGrantId : null,
    client: actor.auth.channel === "mcp" ? actor.auth.oauthClientId : null,
    grant_revision:
      actor.auth.channel === "mcp" ? actor.auth.grantRevision : null,
    scopes: actor.auth.channel === "mcp" ? [...actor.auth.scopeCeiling] : null,
  };
}
export function assertSiteVisitProposalBinding(
  proposal: SiteVisitWorkflowProposal,
  request: SiteVisitWorkflowRequest,
  company: string
) {
  if (
    proposal.operation !== request.operation ||
    proposal.rows.some(
      (row) => row.values.company_id !== company || row.values.id !== row.id
    ) ||
    ("site_visit_id" in request &&
      proposal.site_visit_id !== request.site_visit_id) ||
    (request.operation === "book" &&
      proposal.opportunity_id !== request.opportunity_id) ||
    ("template_id" in request && proposal.template_id !== request.template_id)
  )
    throw new Error("Site visit result binding could not be verified");
  if (request.operation === "answer_form") {
    if (
      proposal.rows.length !== request.changes.length ||
      proposal.rows.some((row) => {
        const patch = request.changes.find((p) => p.answer_id === row.id);
        const expected = patch?.intent === "set" ? patch.value : {};
        return (
          !patch ||
          row.base_revision !== patch.expected_revision ||
          row.values.site_visit_id !== request.site_visit_id ||
          !sameJson(row.values.answer_value, expected) ||
          row.values.answer_state !==
            (patch.intent === "set"
              ? "answered"
              : patch.intent === "clear"
                ? "cleared"
                : "unknown")
        );
      })
    )
      throw new Error("Site visit answer binding could not be verified");
  }
  if (
    proposal.appointment &&
    "local_start" in request &&
    request.local_start !== undefined &&
    proposal.appointment.local_start !== request.local_start
  )
    throw new Error("Site visit time binding could not be verified");
  if (proposal.appointment) {
    const a = proposal.appointment;
    if (
      Date.parse(a.ends_at) - Date.parse(a.starts_at) !==
      a.duration_minutes * 60_000
    )
      throw new Error("Site visit duration binding could not be verified");
    if (request.operation !== "cancel") {
      const proof = verifySiteVisitTimezoneProof(proposal.timezone_proof);
      if (
        proof.timezone !== a.timezone ||
        proof.probes.length !== 1 ||
        proof.probes[0].local !== a.local_start ||
        Date.parse(proof.probes[0].instant) !== Date.parse(a.starts_at)
      )
        throw new Error("Site visit timezone binding could not be verified");
      if (
        "duration_minutes" in request &&
        request.duration_minutes !== undefined &&
        request.duration_minutes !== a.duration_minutes
      )
        throw new Error("Site visit duration binding could not be verified");
      if (
        "assignee_ids" in request &&
        request.assignee_ids !== undefined &&
        !sameJson([...request.assignee_ids].sort(), a.assignee_ids)
      )
        throw new Error("Site visit crew binding could not be verified");
      if (
        "reminder_lead_minutes" in request &&
        request.reminder_lead_minutes !== undefined &&
        (request.operation === "book" ||
          request.reminder_lead_minutes !== null) &&
        (request.reminder_lead_minutes === -1
          ? null
          : request.reminder_lead_minutes) !== a.reminder_lead_minutes
      )
        throw new Error("Site visit reminder binding could not be verified");
      if (
        "utc_offset_minutes" in request &&
        request.utc_offset_minutes !== undefined &&
        request.utc_offset_minutes !== proof.probes[0].utc_offset_minutes
      )
        throw new Error("Site visit offset binding could not be verified");
    }
  }
  if (
    request.operation === "create_template" ||
    request.operation === "edit_template"
  ) {
    const target = proposal.rows.find((row) => row.id === proposal.template_id);
    if (
      !target ||
      !sameJson(target.values.fields, request.definition.fields) ||
      target.values.name !== request.definition.name ||
      target.values.slug !== request.definition.slug ||
      (request.operation === "edit_template" &&
        target.base_revision !== request.expected_revision) ||
      Object.entries(request.definition).some(
        ([key, value]) =>
          key !== "fields" && !sameJson(target.values[key], value)
      )
    )
      throw new Error("Site visit template binding could not be verified");
  }
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameJson(v, b[i]))
    );
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (k) => Object.hasOwn(right, k) && sameJson(left[k], right[k])
    )
  );
}
function databaseError(actor: ActorContext, raw: unknown): Error {
  const error = raw as { code?: string; message?: string };
  const retryable = [
    "55P03",
    "57014",
    "25P04",
    "40001",
    "40P01",
    "08006",
    "PGRST001",
    "PGRST002",
    "PGRST003",
  ].includes(error?.code ?? "");
  if (retryable)
    return new ActorAccessError({
      requestId: actor.requestId,
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Site visit records are busy. Retry the same request shortly.",
      retryable: true,
      auditReason: "site_visit_database_busy_or_deadline",
    });
  if (error?.code === "42501")
    return new ActorAccessError({
      requestId: actor.requestId,
      code: "FORBIDDEN",
      message: "Your current permissions do not allow this site visit request.",
      retryable: false,
      auditReason: "site_visit_authority_denied",
    });
  if (/ACTIVATION|POLICY/.test(error?.message ?? ""))
    return new Error(
      "Site visit saving is not activated for this company and connection."
    );
  if (/STALE|CONFLICT|CLOSED|SUPERSESSION/.test(error?.message ?? ""))
    return new Error(
      "The site visit or approval changed. Read the current records and prepare a new review."
    );
  if (/NO_CHANGE/.test(error?.message ?? ""))
    return new Error("These values are already saved. No approval is needed.");
  return new ActorAccessError({
    requestId: actor.requestId,
    code: "INVALID_ARGUMENT",
    message: "Resolve the site visit input before continuing.",
    retryable: false,
    auditReason: "site_visit_input_unresolved",
    fieldIssues: [
      {
        path: ["input"],
        code: /^SITE_VISIT_[A-Z_]+$/.test(error?.message ?? "")
          ? error.message!
          : "SITE_VISIT_INPUT_INVALID",
        message:
          "Use current record versions, supported field values and exact source evidence.",
      },
    ],
  });
}
export function createSiteVisitWorkflowService(input: {
  rpc: ScheduleChangeRpcClient["rpc"];
  authorityRepository: ActorAuthorityRepository;
}): SiteVisitWorkflowService {
  if (typeof input.rpc !== "function" || !input.authorityRepository)
    throw new TypeError("Site visit RPC and authority repository are required");
  async function call(
    name: SiteVisitWorkflowTool,
    actor: ActorContext,
    raw: unknown,
    options?: Options
  ) {
    if (!isActorContext(actor))
      throw authorizationInternal(
        "unknown-request",
        "site_visit_actor_untrusted"
      );
    const read = !name.startsWith("prepare_");
    let toolInput: Record<string, unknown>;
    let request:
      | ReturnType<typeof SiteVisitWorkflowRequestSchema.parse>
      | ReturnType<typeof SiteVisitWorkflowReadRequestSchema.parse>;
    try {
      toolInput = siteVisitToolInputSchema(name).parse(raw);
      request = (
        read
          ? SiteVisitWorkflowReadRequestSchema
          : SiteVisitWorkflowRequestSchema
      ).parse({ ...toolInput, operation: SITE_VISIT_TOOL_OPERATIONS[name] });
    } catch {
      throw databaseError(actor, { message: "SITE_VISIT_INPUT_INVALID" });
    }
    const current =
      actor.auth.channel === "mcp"
        ? await reauthorizeResolvedMcpActor({
            actorContext: actor,
            authorityRepository: input.authorityRepository,
            capabilityManifestRevision: SITE_VISIT_WORKFLOW_MANIFEST,
            signal: options?.signal,
          })
        : actor;
    const resolved = resolveSiteVisitWorkflowCapabilityAuthorization(
      name,
      toolInput
    );
    for (const variant of resolved.variants)
      authorizeCapability({ actorContext: current, policy: variant.policy });
    const context = siteVisitWorkflowActorBinding(current);
    const appointment = ["book", "reschedule"].includes(request.operation);
    async function invoke(rpcName: string) {
      if (options?.signal?.aborted)
        throw options.signal.reason ?? new Error("Request cancelled");
      const pending = input.rpc(rpcName, {
        p_context: context,
        p_request: request,
        p_request_id: current.requestId,
      });
      const response = await (options?.signal && pending.abortSignal
        ? pending.abortSignal(options.signal)
        : pending);
      if (response.error) throw databaseError(current, response.error);
      if (
        Buffer.byteLength(JSON.stringify(response.data) ?? "", "utf8") > 262144
      )
        throw new Error("Site visit result exceeds its verified bound");
      return response.data;
    }
    if (appointment) {
      // Verify the database's actual civil-time interpretation before creating a
      // durable approval. Prepare rechecks the source graph in its own transaction.
      const inspected = z
        .object({
          request_id: z.literal(current.requestId),
          schema_revision: z.literal(SITE_VISIT_WORKFLOW_REVISION),
          proposal: SiteVisitWorkflowProposalSchema,
          content_kind: z.literal("untrusted_business_data"),
        })
        .strict()
        .parse(await invoke("inspect_site_visit_workflow_as_system"));
      assertSiteVisitProposalBinding(
        inspected.proposal,
        request as SiteVisitWorkflowRequest,
        current.companyId
      );
    }
    const data = await invoke(
      read
        ? "read_site_visit_workflow_as_system"
        : "prepare_site_visit_workflow_as_system"
    );
    if (read) {
      const result = SiteVisitWorkflowReadResultSchema.parse(data);
      if (
        result.request_id !== current.requestId ||
        (request.operation === "get_template" &&
          result.template?.id !== request.template_id) ||
        (request.operation === "get_form" &&
          result.site_visit?.id !== request.site_visit_id) ||
        (request.operation === "get_source" &&
          result.source?.artifact_id !== request.artifact_id)
      )
        throw new Error("Site visit read binding could not be verified");
      return Object.freeze(result);
    }
    const result = SiteVisitWorkflowResultSchema.parse(data);
    if (result.request_id !== current.requestId)
      throw new Error("Site visit request binding could not be verified");
    assertSiteVisitProposalBinding(
      result.proposal,
      request as SiteVisitWorkflowRequest,
      current.companyId
    );
    if (result.receipt) {
      assertSiteVisitReceiptBinding(result.receipt, result.proposal, {
        actorUserId: current.actorUserId,
        companyId: current.companyId,
        actionId: result.action_id!,
        changeSetId: result.change_set_id!,
        previewSha256: result.preview_sha256!,
      });
    }
    return Object.freeze(result);
  }
  const service: SiteVisitWorkflowService = {
    listSiteVisitTemplates: (a, r, o) =>
      call("list_site_visit_templates", a, r, o),
    getSiteVisitTemplate: (a, r, o) => call("get_site_visit_template", a, r, o),
    getSiteVisitForm: (a, r, o) => call("get_site_visit_form", a, r, o),
    getSiteVisitSource: (a, r, o) => call("get_site_visit_source", a, r, o),
    prepareSiteVisitBooking: (a, r, o) =>
      call("prepare_site_visit_booking", a, r, o),
    prepareSiteVisitReschedule: (a, r, o) =>
      call("prepare_site_visit_reschedule", a, r, o),
    prepareSiteVisitBookingCancellation: (a, r, o) =>
      call("prepare_site_visit_booking_cancellation", a, r, o),
    prepareSiteVisitTemplate: (a, r, o) =>
      call("prepare_site_visit_template", a, r, o),
    prepareSiteVisitTemplateEdit: (a, r, o) =>
      call("prepare_site_visit_template_edit", a, r, o),
    prepareSiteVisitChecklistSelection: (a, r, o) =>
      call("prepare_site_visit_checklist_selection", a, r, o),
    prepareSiteVisitAnswers: (a, r, o) =>
      call("prepare_site_visit_answers", a, r, o),
  };
  trusted.add(service);
  return Object.freeze(service);
}
export function isTrustedSiteVisitWorkflowService(
  value: unknown
): value is SiteVisitWorkflowService {
  return typeof value === "object" && value !== null && trusted.has(value);
}
