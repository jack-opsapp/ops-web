import { afterEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";

import {
  createMonitoredOpenAIFetch,
  isOpenAIInsufficientQuotaError,
  isOpenAIRetryableRateLimitError,
  resetOpenAIRecoveryProbeStateForTests,
  type OpenAIQuotaAlertMonitor,
} from "@/lib/api/services/openai-monitoring";

const QUOTA_RESPONSE = {
  error: {
    message: "You exceeded your current quota.",
    type: "insufficient_quota",
    code: "insufficient_quota",
  },
};

// 2026-07-22 outage shape: the org/billing quota 429 carried the signal in
// `type` while `code` came back null. The old code-only detector never fired.
const QUOTA_RESPONSE_TYPE_ONLY_NULL_CODE = {
  error: {
    message: "You exceeded your current quota.",
    type: "insufficient_quota",
    code: null,
  },
};

// Same class of error with the `code` key omitted entirely.
const QUOTA_RESPONSE_TYPE_ONLY_NO_CODE = {
  error: {
    message: "You exceeded your current quota.",
    type: "insufficient_quota",
  },
};

// A genuine throttle carries no insufficient_quota signal on either field.
const RATE_LIMIT_RESPONSE = {
  error: { type: "requests", code: "rate_limit_exceeded" },
};

function requestHeaders(retryCount = 0): Headers {
  return new Headers({ "X-Stainless-Retry-Count": String(retryCount) });
}

function createMonitor() {
  const monitor: OpenAIQuotaAlertMonitor = {
    captureOpenAIQuotaIncident: vi.fn().mockResolvedValue(null),
    reportOpenAIQuotaExhausted: vi.fn().mockResolvedValue(undefined),
    resolveCapturedOpenAIQuotaIncident: vi.fn().mockResolvedValue(undefined),
  };
  return monitor;
}

afterEach(() => {
  resetOpenAIRecoveryProbeStateForTests();
  vi.restoreAllMocks();
});

describe("createMonitoredOpenAIFetch", () => {
  it("opens an incident only for the insufficient_quota provider code or type", async () => {
    const monitor = createMonitor();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(QUOTA_RESPONSE, {
          status: 429,
          headers: { "x-request-id": "req_quota" },
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: { type: "rate_limit_error", code: "rate_limit_exceeded" } },
          { status: 429 }
        )
      );
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY_SYNC",
      workload: "email_sync",
      monitor,
    });

    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(),
    });
    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(1),
    });

    expect(monitor.reportOpenAIQuotaExhausted).toHaveBeenCalledTimes(1);
    expect(monitor.reportOpenAIQuotaExhausted).toHaveBeenCalledWith({
      keySource: "OPENAI_API_KEY_SYNC",
      workload: "email_sync",
      errorMetadata: {
        code: "insufficient_quota",
        endpoint: "/v1/chat/completions",
        requestId: "req_quota",
        status: 429,
        type: "insufficient_quota",
      },
    });
  });

  it("opens an incident when only error.type carries insufficient_quota (2026-07-22 outage shape)", async () => {
    const monitor = createMonitor();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(QUOTA_RESPONSE_TYPE_ONLY_NULL_CODE, { status: 429 })
      );
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY_SYNC",
      workload: "email_sync",
      monitor,
    });

    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(),
    });

    expect(monitor.reportOpenAIQuotaExhausted).toHaveBeenCalledTimes(1);
    expect(monitor.reportOpenAIQuotaExhausted).toHaveBeenCalledWith(
      expect.objectContaining({
        keySource: "OPENAI_API_KEY_SYNC",
        workload: "email_sync",
        errorMetadata: expect.objectContaining({
          code: "insufficient_quota",
          type: "insufficient_quota",
          status: 429,
        }),
      })
    );
  });

  it("opens an incident when the insufficient_quota code key is absent entirely", async () => {
    const monitor = createMonitor();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(QUOTA_RESPONSE_TYPE_ONLY_NO_CODE, { status: 429 })
      );
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY",
      workload: "email_drafting",
      monitor,
    });

    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(),
    });

    expect(monitor.reportOpenAIQuotaExhausted).toHaveBeenCalledTimes(1);
    expect(monitor.reportOpenAIQuotaExhausted).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMetadata: expect.objectContaining({
          code: "insufficient_quota",
          type: "insufficient_quota",
          status: 429,
        }),
      })
    );
  });

  it("never opens an incident for a genuine rate limit carrying no quota signal", async () => {
    const monitor = createMonitor();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(RATE_LIMIT_RESPONSE, { status: 429 }));
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY_SYNC",
      workload: "email_sync",
      monitor,
    });

    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(),
    });

    expect(monitor.reportOpenAIQuotaExhausted).not.toHaveBeenCalled();
  });

  it("uses the provider code or type rather than assuming a fixed HTTP status", async () => {
    const monitor = createMonitor();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(QUOTA_RESPONSE, { status: 403 }));
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY",
      workload: "admin_ads_briefing",
      monitor,
    });

    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(),
    });

    expect(monitor.reportOpenAIQuotaExhausted).toHaveBeenCalledTimes(1);
    expect(monitor.reportOpenAIQuotaExhausted).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMetadata: expect.objectContaining({ status: 403 }),
      })
    );
  });

  it("captures before an initial request and resolves only that exact capture after success", async () => {
    const monitor = createMonitor();
    const capture = {
      notificationId: "11111111-1111-4111-8111-111111111111",
      recipientUserId: "22222222-2222-4222-8222-222222222222",
      dedupeKey: "platform-provider:openai:insufficient-quota:OPENAI_API_KEY",
      incidentVersion: 4,
    };
    vi.mocked(monitor.captureOpenAIQuotaIncident).mockResolvedValue(capture);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }, { status: 200 }));
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY",
      workload: "catalog_setup",
      monitor,
    });

    await monitoredFetch("https://api.openai.com/v1/responses", {
      headers: requestHeaders(),
    });

    expect(monitor.captureOpenAIQuotaIncident).toHaveBeenCalledWith(
      "OPENAI_API_KEY"
    );
    expect(monitor.resolveCapturedOpenAIQuotaIncident).toHaveBeenCalledWith(
      capture
    );
    expect(
      vi.mocked(monitor.captureOpenAIQuotaIncident).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(fetchImpl).mock.invocationCallOrder[0]);
  });

  it("never resolves an incident created during the same logical SDK request", async () => {
    const monitor = createMonitor();
    const newlyOpened = {
      notificationId: "33333333-3333-4333-8333-333333333333",
      recipientUserId: "22222222-2222-4222-8222-222222222222",
      dedupeKey:
        "platform-provider:openai:insufficient-quota:OPENAI_API_KEY_DRAFTING",
      incidentVersion: 1,
    };
    vi.mocked(monitor.captureOpenAIQuotaIncident)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(newlyOpened);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(QUOTA_RESPONSE, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 }));
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY_DRAFTING",
      workload: "email_drafting",
      monitor,
    });

    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(0),
    });
    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(1),
    });

    expect(monitor.captureOpenAIQuotaIncident).toHaveBeenCalledTimes(1);
    expect(monitor.resolveCapturedOpenAIQuotaIncident).not.toHaveBeenCalled();
  });

  it("throttles successful recovery probes for five minutes but a quota failure forces the next logical request eligible", async () => {
    const monitor = createMonitor();
    let now = 10_000;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 }))
      .mockResolvedValueOnce(Response.json(QUOTA_RESPONSE, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 }));
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY_IMPORT",
      workload: "email_import",
      monitor,
      now: () => now,
    });

    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(),
    });
    now += 60_000;
    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(),
    });
    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(1),
    });
    await monitoredFetch("https://api.openai.com/v1/chat/completions", {
      headers: requestHeaders(),
    });

    expect(monitor.captureOpenAIQuotaIncident).toHaveBeenCalledTimes(2);
  });

  it("keeps alert-service failures from changing the provider response", async () => {
    const monitor = createMonitor();
    vi.mocked(monitor.captureOpenAIQuotaIncident).mockRejectedValue(
      new Error("notification database unavailable")
    );
    vi.mocked(monitor.reportOpenAIQuotaExhausted).mockRejectedValue(
      new Error("notification database unavailable")
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(QUOTA_RESPONSE, { status: 429 }));
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY_SYNC",
      workload: "email_sync",
      monitor,
    });

    const response = await monitoredFetch(
      "https://api.openai.com/v1/chat/completions",
      { headers: requestHeaders() }
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual(QUOTA_RESPONSE);
  });

  it("leaves the next logical request eligible after preflight or resolution failure", async () => {
    const monitor = createMonitor();
    const capture = {
      notificationId: "44444444-4444-4444-8444-444444444444",
      recipientUserId: "22222222-2222-4222-8222-222222222222",
      dedupeKey: "platform-provider:openai:insufficient-quota:OPENAI_API_KEY",
      incidentVersion: 9,
    };
    vi.mocked(monitor.captureOpenAIQuotaIncident)
      .mockRejectedValueOnce(new Error("preflight failed"))
      .mockResolvedValueOnce(capture)
      .mockResolvedValueOnce(capture);
    vi.mocked(monitor.resolveCapturedOpenAIQuotaIncident)
      .mockRejectedValueOnce(new Error("resolution failed"))
      .mockResolvedValueOnce(undefined);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }, { status: 200 }));
    const monitoredFetch = createMonitoredOpenAIFetch({
      fetchImpl,
      keySource: "OPENAI_API_KEY",
      workload: "catalog_setup",
      monitor,
    });

    await monitoredFetch("https://api.openai.com/v1/responses", {
      headers: requestHeaders(),
    });
    await monitoredFetch("https://api.openai.com/v1/responses", {
      headers: requestHeaders(),
    });
    await monitoredFetch("https://api.openai.com/v1/responses", {
      headers: requestHeaders(),
    });

    expect(monitor.captureOpenAIQuotaIncident).toHaveBeenCalledTimes(3);
    expect(monitor.resolveCapturedOpenAIQuotaIncident).toHaveBeenCalledTimes(2);
  });
});

describe("isOpenAIInsufficientQuotaError", () => {
  it("recognizes the SDK error code without treating every 429 as exhaustion", () => {
    expect(
      isOpenAIInsufficientQuotaError({
        status: 429,
        code: "insufficient_quota",
      })
    ).toBe(true);
    expect(
      isOpenAIInsufficientQuotaError({
        status: 429,
        code: "rate_limit_exceeded",
      })
    ).toBe(false);
    expect(
      isOpenAIInsufficientQuotaError(new Error("429 too many requests"))
    ).toBe(false);
  });

  it("recognizes insufficient_quota carried by error.type when code is absent", () => {
    expect(
      isOpenAIInsufficientQuotaError({
        status: 429,
        type: "insufficient_quota",
      })
    ).toBe(true);
    expect(
      isOpenAIInsufficientQuotaError({ error: { type: "insufficient_quota" } })
    ).toBe(true);
    expect(
      isOpenAIInsufficientQuotaError({
        status: 429,
        code: "rate_limit_exceeded",
      })
    ).toBe(false);
    expect(isOpenAIInsufficientQuotaError(new Error("boom"))).toBe(false);
  });

  it("recognizes the exact code surfaced by the installed OpenAI SDK", () => {
    const sdkError = OpenAI.APIError.generate(
      429,
      QUOTA_RESPONSE,
      undefined,
      new Headers({ "x-request-id": "req_sdk" })
    );

    expect(sdkError.code).toBe("insufficient_quota");
    expect(isOpenAIInsufficientQuotaError(sdkError)).toBe(true);
  });

  it("keeps ordinary provider throttling retryable while quota exhaustion stops", () => {
    expect(
      isOpenAIRetryableRateLimitError({
        status: 429,
        code: "rate_limit_exceeded",
      })
    ).toBe(true);
    expect(
      isOpenAIRetryableRateLimitError(new Error("TPM rate limit reached"))
    ).toBe(true);
    expect(
      isOpenAIRetryableRateLimitError({
        status: 429,
        code: "insufficient_quota",
      })
    ).toBe(false);
  });
});
