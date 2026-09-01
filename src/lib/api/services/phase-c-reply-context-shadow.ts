import "server-only";

import {
  createInternalPhaseCAdapterRuntime,
  type InternalPhaseCRuntimeRpcClient,
} from "@/lib/agent-control-plane/adapters/internal-runtime";
import {
  observeReplyContextShadow,
  type ReplyContextShadowObservation,
} from "@/lib/agent-control-plane/memory/reply-context-shadow";
import { createOperationalReadCursorCodec } from "@/lib/agent-control-plane/services/operational-read-cursor";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import {
  isResolvedPhaseCEmailActorContext,
  type PhaseCEmailActorContext,
} from "@/lib/email/phase-c-email-actor";

const PHASE_C_REPLY_CONTEXT_SHADOW_FLAG = "agent_memory_reply_shadow" as const;
const OPERATIONAL_READ_CURSOR_KEY_ENV =
  "OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY" as const;
const SHADOW_READ_TIMEOUT_MILLISECONDS = 10_000;
const SHADOW_DEADLINE = Symbol("phase-c-reply-context-shadow.deadline");
const CURSOR_KEY_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RunPhaseCReplyContextShadowInput {
  readonly routedActor: PhaseCEmailActorContext;
  readonly sourceActivityId: string;
  readonly controlContext: string;
  readonly rpcClient: InternalPhaseCRuntimeRpcClient;
}

interface PhaseCReplyContextShadowInputSnapshot {
  readonly routedActor: PhaseCEmailActorContext;
  readonly sourceActivityId: string;
  readonly controlContext: string;
  readonly rpcClient: InternalPhaseCRuntimeRpcClient;
}

const INPUT_KEYS = [
  "routedActor",
  "sourceActivityId",
  "controlContext",
  "rpcClient",
] as const;
const ALLOWED_INPUT_KEYS = new Set<PropertyKey>(INPUT_KEYS);

interface AbortableRpcRequest extends PromiseLike<{
  readonly data: unknown;
  readonly error: unknown;
}> {
  abortSignal?(
    signal: AbortSignal
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

function snapshotInput(
  input: unknown
): PhaseCReplyContextShadowInputSnapshot | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        (key) => typeof key !== "string" || !ALLOWED_INPUT_KEYS.has(key)
      ) ||
      INPUT_KEYS.some((key) => !Object.hasOwn(descriptors, key))
    ) {
      return null;
    }
    const values = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (
        typeof key !== "string" ||
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }
      values[key] = descriptor.value;
    }
    if (
      !isResolvedPhaseCEmailActorContext(values.routedActor) ||
      typeof values.sourceActivityId !== "string" ||
      !UUID_PATTERN.test(values.sourceActivityId) ||
      typeof values.controlContext !== "string" ||
      (typeof values.rpcClient !== "object" &&
        typeof values.rpcClient !== "function") ||
      values.rpcClient === null
    ) {
      return null;
    }
    return Object.freeze({
      routedActor: values.routedActor,
      sourceActivityId: values.sourceActivityId.toLowerCase(),
      controlContext: values.controlContext,
      rpcClient: values.rpcClient as InternalPhaseCRuntimeRpcClient,
    });
  } catch {
    return null;
  }
}

function operationalReadCursorConfiguration() {
  const rawKey = process.env[OPERATIONAL_READ_CURSOR_KEY_ENV]?.trim() ?? "";
  if (!CURSOR_KEY_PATTERN.test(rawKey)) {
    throw new TypeError("Phase C shadow cursor configuration is unavailable");
  }
  const key = Uint8Array.from(Buffer.from(rawKey, "hex"));
  return Object.freeze({
    cursorCodec: createOperationalReadCursorCodec({
      key,
      keyId: "phase-c-shadow",
      version: 1,
    }),
    p2CursorKey: Object.freeze({
      keyId: "phase-c-p2",
      key: Uint8Array.from(key),
    }),
  });
}

function boundedRpcClient(
  client: InternalPhaseCRuntimeRpcClient,
  signal: AbortSignal
): InternalPhaseCRuntimeRpcClient {
  return Object.freeze({
    rpc(
      functionName: string,
      args: Readonly<Record<string, unknown>>
    ): PromiseLike<{ readonly data: unknown; readonly error: unknown }> {
      const request = client.rpc.call(client, functionName, args) as
        | AbortableRpcRequest
        | undefined;
      if (!request || typeof request.then !== "function") {
        return Promise.reject(new TypeError("Phase C shadow RPC unavailable"));
      }
      if (typeof request.abortSignal === "function") {
        return request.abortSignal(signal);
      }
      return Promise.race([
        Promise.resolve(request),
        new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        }),
      ]);
    },
  });
}

/**
 * Opt-in production bridge for measuring the shared conversation-memory
 * projection beside the existing Phase C prompt. It cannot draft, persist,
 * send, or mutate mailbox state; the returned observation contains metrics
 * only and is never fed back into the customer-facing reply.
 */
export async function runPhaseCReplyContextShadow(
  input: RunPhaseCReplyContextShadowInput
): Promise<ReplyContextShadowObservation | null> {
  const snapshot = snapshotInput(input);
  if (!snapshot) return null;

  const abortController = new AbortController();
  let resolveDeadline!: (value: typeof SHADOW_DEADLINE) => void;
  const deadline = new Promise<typeof SHADOW_DEADLINE>((resolve) => {
    resolveDeadline = resolve;
  });
  const timeout = setTimeout(() => {
    resolveDeadline(SHADOW_DEADLINE);
    abortController.abort();
  }, SHADOW_READ_TIMEOUT_MILLISECONDS);
  try {
    const enabled = await Promise.race([
      AdminFeatureOverrideService.isFeatureEnabled(
        snapshot.routedActor.companyId,
        PHASE_C_REPLY_CONTEXT_SHADOW_FLAG,
        abortController.signal
      ),
      deadline,
    ]);
    if (enabled !== true) return null;

    const observation = await Promise.race([
      observeReplyContextShadow({
        controlContext: snapshot.controlContext,
        loadBoundedContext: async () => {
          const cursorConfiguration = operationalReadCursorConfiguration();
          const adapter = createInternalPhaseCAdapterRuntime({
            rpcClient: boundedRpcClient(
              snapshot.rpcClient,
              abortController.signal
            ),
            ...cursorConfiguration,
          });
          return adapter.getJobConversationContext({
            routedActor: snapshot.routedActor,
            sourceActivityId: snapshot.sourceActivityId,
          });
        },
      }),
      deadline,
    ]);
    return observation === SHADOW_DEADLINE ? null : observation;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
