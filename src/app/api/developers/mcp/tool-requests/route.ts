import { createHmac } from "node:crypto";

import { after } from "next/server";
import { z } from "zod";

import {
  createMcpToolRequestIntake,
  createSupabaseMcpToolRequestStore,
  normalizeMcpToolRequestEmail,
} from "@/lib/agent-control-plane/mcp/tool-request/intake";
import { resolveActiveMcpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import { sendMcpToolRequest } from "@/lib/email/sendgrid";
import { readBoundedJson } from "@/lib/external-api/http/request-body";
import {
  NetworkFingerprintUnavailableError,
  createExternalApiNetworkFingerprint,
  readExternalApiNetworkHmacKeyRing,
} from "@/lib/external-api/security/network-fingerprint";
import {
  createConfiguredStrictRateLimiter,
  type ExternalApiRateLimitDecision,
} from "@/lib/external-api/security/strict-rate-limit";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 4,000 Unicode code points can occupy 16 KiB before the bounded JSON
// envelope (submission id, email, field names, and punctuation) is included.
const MAX_BODY_BYTES = 20_480;
const RATE_LIMIT_PREFIX = "missing";
const ACTIVE_EXPOSURE_REVISION = resolveActiveMcpExposure().revision;
const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});

function response(
  body: Record<string, unknown>,
  status: number,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function denied(decision: ExternalApiRateLimitDecision): Response | null {
  if (decision.allowed) return null;
  return response({ error: "rate_limited" }, 429, {
    "Retry-After": String(decision.retryAfterSeconds),
  });
}

function emailSubmissionIdentity(
  email: string,
  keyRing: ReturnType<typeof readExternalApiNetworkHmacKeyRing>
): string {
  const key = keyRing.keys.get(keyRing.activeKid);
  if (!key) throw new NetworkFingerprintUnavailableError();
  return createHmac("sha256", key)
    .update("mcp-tool-request-email\0", "utf8")
    .update(email, "utf8")
    .digest("base64url");
}

function safeIntakeFailure(error: unknown): Response {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      code?: unknown;
      status?: unknown;
      retryAfterSeconds?: unknown;
    };
    if (candidate.code === "invalid_request" && candidate.status === 400) {
      return response({ error: "invalid_request" }, 400);
    }
    if (candidate.code === "submission_conflict" && candidate.status === 409) {
      return response({ error: "submission_conflict" }, 409);
    }
    if (candidate.code === "rate_limited" && candidate.status === 429) {
      const retryAfter =
        typeof candidate.retryAfterSeconds === "number" &&
        Number.isSafeInteger(candidate.retryAfterSeconds) &&
        candidate.retryAfterSeconds > 0
          ? candidate.retryAfterSeconds
          : 86_400;
      return response({ error: "rate_limited" }, 429, {
        "Retry-After": String(retryAfter),
      });
    }
  }
  return response({ error: "request_failed" }, 500);
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return response({ error: "forbidden" }, 403);
  }

  let keyRing: ReturnType<typeof readExternalApiNetworkHmacKeyRing>;
  let networkIdentity: string;
  let limiter: ReturnType<typeof createConfiguredStrictRateLimiter>;
  let client: ReturnType<typeof getServiceRoleClient>;
  try {
    keyRing = readExternalApiNetworkHmacKeyRing();
    client = getServiceRoleClient();
    limiter = createConfiguredStrictRateLimiter(client);
    const network = createExternalApiNetworkFingerprint({
      request,
      keyRing,
      presentedPrefix: RATE_LIMIT_PREFIX,
      ipv6PrefixLength: 64,
    });
    networkIdentity = network.rateLimitIdentity;
    const networkDecision = await limiter.checkPreAuth({
      networkFingerprint: network.rateLimitIdentity,
      presentedPrefix: RATE_LIMIT_PREFIX,
    });
    const rejection = denied(networkDecision);
    if (rejection) return rejection;
  } catch {
    return response({ error: "temporarily_unavailable" }, 503);
  }

  let input: unknown;
  let emailIdentity: string;
  try {
    input = await readBoundedJson(request, z.unknown(), MAX_BODY_BYTES);
    const email = normalizeMcpToolRequestEmail(input);
    emailIdentity = emailSubmissionIdentity(email, keyRing);
  } catch (error) {
    return safeIntakeFailure(error);
  }

  const intake = createMcpToolRequestIntake({
    store: createSupabaseMcpToolRequestStore(client),
    activeExposureRevision: ACTIVE_EXPOSURE_REVISION,
    scheduleNotification: (notification) => {
      after(async () => {
        try {
          await sendMcpToolRequest({
            requesterEmail: notification.requesterEmail,
            details: notification.details,
            submissionId: notification.submissionId,
            adminUrl: new URL(
              "/admin/feedback",
              process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co"
            ).toString(),
          });
        } catch {
          console.error("mcp_tool_request_notification_failed");
        }
      });
    },
  });

  try {
    const result = await intake.submit(input, {
      networkIdentity,
      emailIdentity,
    });
    return response(
      {
        ok: true,
        submissionId: result.submissionId,
        replayed: result.replayed,
      },
      result.replayed ? 200 : 201
    );
  } catch (error) {
    return safeIntakeFailure(error);
  }
}
