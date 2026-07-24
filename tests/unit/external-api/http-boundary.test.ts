import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  EXTERNAL_API_VERSION,
  MAX_ANSWER_COUNT,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  MAX_JSON_BODY_BYTES,
  MAX_UPLOAD_BATCH_BYTES,
} from "@/lib/external-api/contracts";
import { readBoundedJson } from "@/lib/external-api/http/request-body";
import {
  ANALYTICS_LONG_CACHE_CONTROL,
  ANALYTICS_SHORT_CACHE_CONTROL,
  createErrorResponse,
  createIntakeConfigResponse,
  createLeadFeedResponse,
  errorEnvelopeSchema,
  metricsCacheControlForQuery,
} from "@/lib/external-api/http/responses";
import {
  createExternalRequestId,
  resolveExternalRequestId,
} from "@/lib/external-api/http/request-id";

function requestFromChunks(
  chunks: Uint8Array[],
  contentType = "application/json"
) {
  let index = 0;
  return new Request("https://ops.example/v1/intake/submissions", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("external API bounded JSON reader", () => {
  it("consumes and validates a streamed JSON body", async () => {
    const encoder = new TextEncoder();
    const request = requestFromChunks([
      encoder.encode('{"sourceId":"'),
      encoder.encode('src_0123456789abcdefghijklm"}'),
    ]);
    const schema = z
      .object({
        sourceId: z.string(),
      })
      .strict();

    await expect(readBoundedJson(request, schema)).resolves.toEqual({
      sourceId: "src_0123456789abcdefghijklm",
    });
  });

  it("stops at 256 KiB before parsing an oversized body", async () => {
    const encoder = new TextEncoder();
    const request = requestFromChunks([
      encoder.encode('{"value":"'),
      new Uint8Array(MAX_JSON_BODY_BYTES),
      encoder.encode('"}'),
    ]);

    await expect(
      readBoundedJson(request, z.object({ value: z.string() }).strict())
    ).rejects.toMatchObject({
      name: "RequestBodyError",
      code: "invalid_request",
      status: 400,
      reason: "body_too_large",
    });
  });

  it("counts UTF-8 bytes rather than JavaScript characters", async () => {
    const multibyte = `"${"é".repeat(MAX_JSON_BODY_BYTES / 2)}"`;
    const request = requestFromChunks([new TextEncoder().encode(multibyte)]);
    await expect(readBoundedJson(request, z.string())).rejects.toMatchObject({
      reason: "body_too_large",
    });
  });

  it("rejects invalid content types, malformed JSON, and unknown fields safely", async () => {
    const encoder = new TextEncoder();
    await expect(
      readBoundedJson(
        requestFromChunks([encoder.encode("{}")], "text/plain"),
        z.object({}).strict()
      )
    ).rejects.toMatchObject({ reason: "unsupported_content_type" });
    await expect(
      readBoundedJson(
        requestFromChunks([encoder.encode("{")]),
        z.object({}).strict()
      )
    ).rejects.toMatchObject({ reason: "malformed_json" });
    await expect(
      readBoundedJson(
        requestFromChunks([encoder.encode('{"companyId":"internal"}')]),
        z.object({ sourceId: z.string().optional() }).strict()
      )
    ).rejects.toMatchObject({ reason: "validation_failed" });
  });
});

describe("external API response boundary", () => {
  const intakeConfig = {
    contractVersion: EXTERNAL_API_VERSION,
    sources: [],
    acceptedFilePolicy: {
      contentTypes: ["image/jpeg"],
      maxFiles: MAX_FILES_PER_BATCH,
      maxFileBytes: MAX_FILE_BYTES,
      maxBatchBytes: MAX_UPLOAD_BATCH_BYTES,
    },
    requestLimits: {
      maxJsonBodyBytes: MAX_JSON_BODY_BYTES,
      maxAnswers: MAX_ANSWER_COUNT,
    },
  } as const;

  it("emits the stable success envelope and intake no-store policy", async () => {
    const response = createIntakeConfigResponse(intakeConfig, {
      requestId: "req_0123456789abcdefghijklm",
      serverTimestamp: "2026-07-24T17:30:00.000Z",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(
      "req_0123456789abcdefghijklm"
    );
    await expect(response.json()).resolves.toEqual({
      requestId: "req_0123456789abcdefghijklm",
      apiVersion: EXTERNAL_API_VERSION,
      serverTimestamp: "2026-07-24T17:30:00.000Z",
      result: intakeConfig,
    });
    expect(() =>
      createIntakeConfigResponse(
        { ...intakeConfig, company_id: "internal-company" },
        { requestId: "req_0123456789abcdefghijklm" }
      )
    ).toThrow();
  });

  it("keeps analytics caches private with the approved 60/300 second windows", () => {
    expect(ANALYTICS_SHORT_CACHE_CONTROL).toBe(
      "private, max-age=60, must-revalidate"
    );
    expect(ANALYTICS_LONG_CACHE_CONTROL).toBe(
      "private, max-age=300, must-revalidate"
    );
    expect(
      metricsCacheControlForQuery({
        preset: "30d",
        metricIds: ["leads_received"],
      })
    ).toBe(ANALYTICS_SHORT_CACHE_CONTROL);
    expect(
      metricsCacheControlForQuery({
        preset: "90d",
        metricIds: ["leads_received"],
      })
    ).toBe(ANALYTICS_LONG_CACHE_CONTROL);
    expect(
      metricsCacheControlForQuery({
        preset: "custom",
        from: "2026-01-01",
        to: "2026-04-01",
        metricIds: ["leads_received"],
      })
    ).toBe(ANALYTICS_LONG_CACHE_CONTROL);
    const leadFeedResponse = createLeadFeedResponse(
      {
        mode: "full",
        dataThrough: "2026-07-24T17:30:00.000Z",
        items: [],
        nextCursor: null,
        nextSyncCheckpoint: null,
      },
      { requestId: "req_0123456789abcdefghijklm" }
    );
    expect(leadFeedResponse.headers.get("cache-control")).toBe(
      ANALYTICS_SHORT_CACHE_CONTROL
    );
  });

  it("does not let a caller assign analytics caching to an intake result", () => {
    expect(() =>
      createIntakeConfigResponse(intakeConfig, {
        requestId: "req_0123456789abcdefghijklm",
        cacheControl: ANALYTICS_LONG_CACHE_CONTROL,
      } as never)
    ).toThrow();
  });

  it("emits mapped safe errors and rejects secret-bearing detail objects", async () => {
    const response = createErrorResponse("upload_batch_expired", {
      requestId: "req_0123456789abcdefghijklm",
      serverTimestamp: "2026-07-24T17:30:00.000Z",
      details: [
        {
          field: "files",
          fileId: "front-photo",
          reason: "batch_expired",
        },
      ],
    });
    expect(response.status).toBe(410);
    expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe(
      "upload_batch_expired"
    );

    expect(() =>
      createErrorResponse("invalid_request", {
        requestId: "req_0123456789abcdefghijklm",
        details: [
          {
            field: "authorization",
            reason: "invalid",
            authorization: "Bearer secret",
          },
        ],
      } as never)
    ).toThrow();
    expect(() =>
      createErrorResponse("invalid_request", {
        requestId: "req_0123456789abcdefghijklm",
        details: [
          {
            field: "sourceId",
            reason: "invalid",
            message: "Bearer ops_live_this_must_never_leave_the_server",
          },
        ],
      } as never)
    ).toThrow();
  });
});

describe("external API request IDs", () => {
  it("creates opaque IDs and accepts only a safe inbound request ID", () => {
    expect(createExternalRequestId()).toMatch(/^req_[A-Za-z0-9_-]{22,64}$/);
    expect(
      resolveExternalRequestId(
        new Headers({ "x-request-id": "req_0123456789abcdefghijklm" })
      )
    ).toBe("req_0123456789abcdefghijklm");
    expect(
      resolveExternalRequestId(
        new Headers({ "x-request-id": "provider secret value" })
      )
    ).toMatch(/^req_[A-Za-z0-9_-]{22,64}$/);
  });
});
