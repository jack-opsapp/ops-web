import "server-only";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CheckCustomerReplyInputSchema,
  PROMISE_RECOVERY_DEFINITION_REVISION,
  PROMISE_RECOVERY_MAX_CHRONOLOGY_ITEMS,
  PROMISE_RECOVERY_PROMPT_SAFETY_DIRECTIVE,
  PROMISE_RECOVERY_SCHEMA_REVISION,
  PromiseRecoveryResultSchema,
  promiseRecoveryTopicTerms,
  type CheckCustomerReplyInput,
  type PromiseRecoveryResult,
} from "@/lib/agent-control-plane/contracts/promise-recovery";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION,
  resolvePromiseRecoveryCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  isTrustedPromiseRecoveryRepository,
  type PromiseRecoveryRepository,
  type PromiseRecoverySnapshot,
  type PromiseRecoverySource,
} from "./promise-recovery-repository";

const CAPABILITY_ID = "check_customer_reply" as const;
const TRUSTED_SERVICES = new WeakSet<object>();

const PROMISE_PATTERN =
  /\b(?:i|we)(?:\s+will|['’]ll)\b[^.!?\n]{0,160}\b(?:get\s+back|follow\s+up|send|confirm|check|call|email|reply|update|let\s+you\s+know|provide|share)\b/iu;
const REQUEST_PATTERN =
  /\?|\b(?:can|could|would|will)\s+you\b|\bany\s+update\b|\blet\s+me\s+know\b|\bplease\s+(?:send|confirm|check|call|email|reply|update|provide|share)\b/iu;
const RESOLUTION_PATTERN =
  /\b(?:confirmed|sent|attached|scheduled|completed|fixed|ordered|approved|provided|resolved)\b/iu;
const NEGATED_RESOLUTION_PATTERN =
  /\b(?:not|never|haven['’]?t|hasn['’]?t|hadn['’]?t|wasn['’]?t|weren['’]?t|isn['’]?t|aren['’]?t|can['’]?t|cannot)\b[^.!?\n]{0,80}\b(?:confirmed|sent|attached|scheduled|completed|fixed|ordered|approved|provided|resolved)\b/iu;

type MissingReason =
  PromiseRecoveryResult["coverage"]["missing_reasons"][number];
type ClassifiedRole = PromiseRecoveryResult["chronology"][number]["role"];

function bodyTokens(body: string): ReadonlySet<string> {
  return new Set(
    body
      .normalize("NFKC")
      .toLocaleLowerCase("en-CA")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function matchesTopic(body: string, terms: readonly string[]): boolean {
  const tokens = bodyTokens(body);
  return terms.every((term) => tokens.has(term));
}

function sourceRef(source: PromiseRecoverySource): string {
  return `provider_delivery_source:${source.id}`;
}

function boundedExcerpt(body: string): string {
  const compact = body.replace(/\s+/gu, " ").trim();
  return compact.length <= 600 ? compact : `${compact.slice(0, 599)}…`;
}

function provesResolution(body: string): boolean {
  return (
    RESOLUTION_PATTERN.test(body) && !NEGATED_RESOLUTION_PATTERN.test(body)
  );
}

function turnEvidence(source: PromiseRecoverySource) {
  if (!source.turnId) return null;
  const evidenceId = `job_conversation_turn:${source.turnId}`;
  return {
    evidence_id: evidenceId,
    locator: `ops://evidence/${encodeURIComponent(evidenceId)}`,
  };
}

interface ClassifiedSource {
  readonly source: PromiseRecoverySource;
  readonly promise: boolean;
  readonly request: boolean;
}

function coverageReasons(snapshot: PromiseRecoverySnapshot): MissingReason[] {
  const reasons: MissingReason[] = [];
  if (
    snapshot.customerResolution.state === "exact" &&
    !snapshot.customerResolution.identityAvailable
  ) {
    reasons.push("customer_identity_unavailable");
  }
  if (
    snapshot.customerResolution.state === "exact" &&
    snapshot.customerResolution.identityAmbiguous
  ) {
    reasons.push("customer_identity_ambiguous");
  }
  if (snapshot.sources.some((source) => source.bodyState === "unreadable")) {
    reasons.push("unreadable_correspondence");
  }
  if (
    snapshot.sources.some((source) => source.participantAttribution !== "exact")
  ) {
    reasons.push("unattributed_correspondence");
  }
  if (
    snapshot.sources.some(
      (source) =>
        source.direction === "outbound" &&
        source.operatorAttribution !== "exact"
    )
  ) {
    reasons.push("operator_attribution_unresolved");
  }
  if (snapshot.sources.some((source) => source.bodyState === "oversized")) {
    reasons.push("oversized_correspondence");
  }
  if (snapshot.sources.some((source) => source.bodyState === "payload_bound")) {
    reasons.push("source_payload_bound_reached");
  }
  if (
    snapshot.sources.some((source) => !source.attachmentEnumerationComplete)
  ) {
    reasons.push("attachment_enumeration_incomplete");
  }
  if (snapshot.sourceBoundReached) reasons.push("source_bound_reached");
  return reasons;
}

function noCustomerResult(input: {
  snapshot: PromiseRecoverySnapshot;
  asOf: string;
}): PromiseRecoveryResult {
  const resolution = input.snapshot.customerResolution;
  if (resolution.state === "exact") {
    throw new TypeError("Expected unresolved customer");
  }
  const reason =
    resolution.state === "not_found"
      ? ("customer_not_found" as const)
      : ("customer_ambiguous" as const);
  return PromiseRecoveryResultSchema.parse({
    schema_revision: PROMISE_RECOVERY_SCHEMA_REVISION,
    definition_revision: PROMISE_RECOVERY_DEFINITION_REVISION,
    as_of: input.asOf,
    customer_resolution: {
      state: resolution.state,
      candidate_count: resolution.candidateCount,
    },
    answer: {
      state: "insufficient_evidence",
      basis: reason,
      reply: "not_evaluated",
      promise: "not_evaluated",
      resolution: "not_evaluated",
      trigger_source_ref: null,
      reply_source_ref: null,
    },
    coverage: {
      state: "incomplete",
      population_count: 0,
      inspected_count: 0,
      readable_count: 0,
      unreadable_count: 0,
      unattributed_count: 0,
      operator_unattributed_count: 0,
      oversized_count: 0,
      payload_bound_count: 0,
      attachment_incomplete_count: 0,
      source_bound_reached: false,
      missing_reasons: [reason],
      first_delivered_at: null,
      last_delivered_at: null,
      normalization_revisions: [],
    },
    chronology: [],
    chronology_omitted_count: 0,
    prompt_safety: {
      content_kind: "untrusted_business_data",
      directive: PROMISE_RECOVERY_PROMPT_SAFETY_DIRECTIVE,
    },
  });
}

export function analyzePromiseRecoverySnapshot(input: {
  snapshot: PromiseRecoverySnapshot;
  topic: string;
  asOf: string;
}): PromiseRecoveryResult {
  if (input.snapshot.customerResolution.state !== "exact") {
    return noCustomerResult({ snapshot: input.snapshot, asOf: input.asOf });
  }

  const terms = promiseRecoveryTopicTerms(input.topic);
  if (terms.length === 0)
    throw new TypeError("Promise-recovery topic is empty");
  const missingReasons = coverageReasons(input.snapshot);
  const classified: ClassifiedSource[] = input.snapshot.sources.flatMap(
    (source) => {
      if (
        source.participantAttribution !== "exact" ||
        (source.direction === "outbound" &&
          source.operatorAttribution !== "exact") ||
        source.bodyState !== "readable" ||
        source.safeBody === null ||
        !matchesTopic(source.safeBody, terms)
      ) {
        return [];
      }
      return [
        {
          source,
          promise:
            source.direction === "outbound" &&
            PROMISE_PATTERN.test(source.safeBody),
          request:
            source.direction === "inbound" &&
            REQUEST_PATTERN.test(source.safeBody),
        },
      ];
    }
  );
  const triggers = classified.filter((item) => item.request || item.promise);
  const trigger = triggers.at(-1) ?? null;
  const triggerIndex = trigger
    ? input.snapshot.sources.findIndex(
        (source) => source.id === trigger.source.id
      )
    : -1;
  const reply = trigger
    ? (classified.find((item) => {
        const index = input.snapshot.sources.findIndex(
          (source) => source.id === item.source.id
        );
        return (
          index > triggerIndex &&
          item.source.direction === "outbound" &&
          !item.promise
        );
      }) ?? null)
    : null;

  let answer: PromiseRecoveryResult["answer"];
  if (missingReasons.length > 0) {
    answer = {
      state: "insufficient_evidence",
      basis: "evidence_gap",
      reply: "not_evaluated",
      promise: "not_evaluated",
      resolution: "not_evaluated",
      trigger_source_ref: null,
      reply_source_ref: null,
    };
  } else if (!trigger) {
    answer = {
      state: "not_found",
      basis: "no_qualifying_correspondence",
      reply: "not_found",
      promise: "not_found",
      resolution: "not_proven",
      trigger_source_ref: null,
      reply_source_ref: null,
    };
  } else if (!reply) {
    answer = {
      state: "outstanding",
      basis: trigger.promise ? "unanswered_promise" : "unanswered_request",
      reply: "not_found",
      promise: trigger.promise ? "unanswered" : "not_found",
      resolution: "not_proven",
      trigger_source_ref: sourceRef(trigger.source),
      reply_source_ref: null,
    };
  } else {
    answer = {
      state: "replied",
      basis: "qualifying_reply_found",
      reply: "found",
      promise: trigger.promise ? "answered" : "not_found",
      resolution: provesResolution(reply.source.safeBody ?? "")
        ? "proven"
        : "not_proven",
      trigger_source_ref: sourceRef(trigger.source),
      reply_source_ref: sourceRef(reply.source),
    };
  }

  const chronologyItems = classified.map((item) => {
    let role: ClassifiedRole = "topic_mention";
    if (item.request) role = "customer_request";
    else if (item.promise) role = "promise";
    else if (reply?.source.id === item.source.id) {
      role = provesResolution(item.source.safeBody ?? "")
        ? "resolution"
        : "reply";
    }
    return {
      source_ref: sourceRef(item.source),
      turn_evidence: turnEvidence(item.source),
      delivered_at: item.source.deliveredAt,
      direction: item.source.direction,
      role,
      excerpt: boundedExcerpt(item.source.safeBody!),
      content_kind: "untrusted_business_data" as const,
      normalization_revision: item.source.normalizationRevision,
      source_sha256: item.source.sourceSha256,
      participant_attribution: "exact" as const,
      operator_attribution:
        item.source.direction === "inbound"
          ? ("not_applicable" as const)
          : ("exact" as const),
      attachment_enumeration_complete:
        item.source.attachmentEnumerationComplete,
      attachment_evidence_ids: [...item.source.attachmentEvidenceIds],
    };
  });
  const decisiveSourceRefs = new Set(
    [trigger, reply]
      .filter((item): item is ClassifiedSource => item !== null)
      .map((item) => sourceRef(item.source))
  );
  const supplementalCapacity = Math.max(
    0,
    PROMISE_RECOVERY_MAX_CHRONOLOGY_ITEMS - decisiveSourceRefs.size
  );
  const supplementalRefs = chronologyItems
    .filter((item) => !decisiveSourceRefs.has(item.source_ref))
    .slice(-supplementalCapacity)
    .map((item) => item.source_ref);
  const includedRefs = new Set([...decisiveSourceRefs, ...supplementalRefs]);
  const chronology = chronologyItems.filter((item) =>
    includedRefs.has(item.source_ref)
  );
  const omitted = chronologyItems.length - chronology.length;
  const sources = input.snapshot.sources;
  const readableCount = sources.filter(
    (source) => source.bodyState === "readable"
  ).length;

  return PromiseRecoveryResultSchema.parse({
    schema_revision: PROMISE_RECOVERY_SCHEMA_REVISION,
    definition_revision: PROMISE_RECOVERY_DEFINITION_REVISION,
    as_of: input.asOf,
    customer_resolution: {
      state: "exact",
      customer_ref: {
        kind: "client",
        id: input.snapshot.customerResolution.clientId,
      },
      display_name: input.snapshot.customerResolution.displayName,
      content_kind: "untrusted_business_data",
    },
    answer,
    coverage: {
      state: missingReasons.length === 0 ? "complete" : "incomplete",
      population_count: input.snapshot.populationCount,
      inspected_count: sources.length,
      readable_count: readableCount,
      unreadable_count: sources.filter(
        (source) => source.bodyState === "unreadable"
      ).length,
      unattributed_count: sources.filter(
        (source) => source.participantAttribution !== "exact"
      ).length,
      operator_unattributed_count: sources.filter(
        (source) =>
          source.direction === "outbound" &&
          source.operatorAttribution !== "exact"
      ).length,
      oversized_count: sources.filter(
        (source) => source.bodyState === "oversized"
      ).length,
      payload_bound_count: sources.filter(
        (source) => source.bodyState === "payload_bound"
      ).length,
      attachment_incomplete_count: sources.filter(
        (source) => !source.attachmentEnumerationComplete
      ).length,
      source_bound_reached: input.snapshot.sourceBoundReached,
      missing_reasons: missingReasons,
      first_delivered_at: input.snapshot.firstDeliveredAt,
      last_delivered_at: input.snapshot.lastDeliveredAt,
      normalization_revisions: [
        ...new Set(sources.map((source) => source.normalizationRevision)),
      ].sort(),
    },
    chronology,
    chronology_omitted_count: omitted,
    prompt_safety: {
      content_kind: "untrusted_business_data",
      directive: PROMISE_RECOVERY_PROMPT_SAFETY_DIRECTIVE,
    },
  });
}

export interface PromiseRecoveryService {
  checkCustomerReply(
    actorContext: ActorContext,
    input: CheckCustomerReplyInput,
    options?: { signal?: AbortSignal }
  ): Promise<PromiseRecoveryResult>;
}

export function createPromiseRecoveryService(input: {
  repository: PromiseRecoveryRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): PromiseRecoveryService {
  if (!isTrustedPromiseRecoveryRepository(input.repository)) {
    throw new TypeError("A trusted promise-recovery repository is required");
  }
  if (!input.authorityRepository) {
    throw new TypeError("A promise-recovery authority repository is required");
  }
  const now = input.now ?? (() => new Date());
  const service: PromiseRecoveryService = {
    async checkCustomerReply(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "promise_recovery_actor_context_untrusted"
        );
      }
      const parsedInput = CheckCustomerReplyInputSchema.parse(rawInput);
      const initial = resolvePromiseRecoveryCapabilityAuthorization(
        CAPABILITY_ID,
        parsedInput
      );
      if (initial.variants.length !== 1) {
        throw authorizationInternal(
          actorContext.requestId,
          "promise_recovery_policy_invalid"
        );
      }
      authorizeCapability({
        actorContext,
        policy: initial.variants[0]!.policy,
      });
      const currentActor = await reauthorizeResolvedMcpActor({
        actorContext,
        authorityRepository: input.authorityRepository,
        capabilityManifestRevision:
          PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION,
        signal: options?.signal,
      });
      const current = resolvePromiseRecoveryCapabilityAuthorization(
        CAPABILITY_ID,
        parsedInput
      );
      if (current.variants.length !== 1) {
        throw authorizationInternal(
          currentActor.requestId,
          "promise_recovery_policy_invalid"
        );
      }
      authorizeCapability({
        actorContext: currentActor,
        policy: current.variants[0]!.policy,
      });
      const asOf = parsedInput.as_of ?? now().toISOString();
      const snapshot = await input.repository.read({
        actorContext: currentActor,
        customerQuery: parsedInput.customer_query,
        asOf,
        signal: options?.signal,
      });
      return analyzePromiseRecoverySnapshot({
        snapshot,
        topic: parsedInput.topic,
        asOf,
      });
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedPromiseRecoveryService(
  value: unknown
): value is PromiseRecoveryService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
