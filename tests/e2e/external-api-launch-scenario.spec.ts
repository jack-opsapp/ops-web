import { createHash, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const stagingEnabled = process.env.EXTERNAL_API_STAGING_ACCEPTANCE === "1";
const apiBaseUrl = process.env.OPS_API_BASE_URL;
const driverBaseUrl = process.env.EXTERNAL_API_ACCEPTANCE_DRIVER_URL;
const driverToken = process.env.EXTERNAL_API_ACCEPTANCE_DRIVER_TOKEN;

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial", timeout: 15 * 60_000 });
test.skip(
  !stagingEnabled,
  "Requires the separately approved staging storage, scan, queue, CDN, and acceptance driver."
);

type JsonRecord = Record<string, unknown>;

function assertStagingUrl(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} is required`);
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    /(^|\.)opsapp\.co$/i.test(parsed.hostname) ||
    /(^|\.)ops\.app$/i.test(parsed.hostname)
  ) {
    throw new Error(`${label} must be a non-production HTTPS origin`);
  }
  return parsed.origin;
}

async function jsonRequest(
  request: APIRequestContext,
  url: string,
  options: {
    method?: "GET" | "POST";
    credential?: string;
    idempotencyKey?: string;
    body?: unknown;
    expected?: number[];
    driver?: boolean;
  } = {}
) {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (options.driver) {
    if (!driverToken) {
      throw new Error("EXTERNAL_API_ACCEPTANCE_DRIVER_TOKEN is required");
    }
    headers.authorization = `Bearer ${driverToken}`;
  } else if (options.credential) {
    headers.authorization = `Bearer ${options.credential}`;
  }
  if (options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  const response = await request.fetch(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    data: options.body,
    failOnStatusCode: false,
  });
  const body = (await response.json()) as JsonRecord;
  const expected = options.expected ?? [200];
  expect(
    expected,
    `${new URL(url).pathname} returned ${response.status()}`
  ).toContain(response.status());
  return { response, body };
}

function resultOf(body: JsonRecord) {
  expect(body).toHaveProperty("result");
  return body.result as JsonRecord;
}

function sha256Hex(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

const cleanPhoto = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
const unsafePhoto = Buffer.concat([
  cleanPhoto,
  Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$OPS-STAGING-UNSAFE-FIXTURE!$H+H*"),
]);
const cleanPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
);

async function uploadCapability(
  request: APIRequestContext,
  capability: JsonRecord,
  bytes: Buffer
) {
  const requiredHeaders = capability.requiredHeaders as JsonRecord;
  const headers: Record<string, string> = {
    "content-type": String(requiredHeaders.contentType),
    "content-length": String(requiredHeaders.contentLength),
    "if-none-match": String(requiredHeaders.ifNoneMatch),
  };
  if (requiredHeaders.checksumSha256) {
    headers["x-amz-checksum-sha256"] = String(requiredHeaders.checksumSha256);
  }
  const response = await request.put(String(capability.url), {
    headers,
    data: bytes,
    failOnStatusCode: false,
  });
  expect(response.ok()).toBe(true);
}

test("approved external lead launch scenario", async ({ request }) => {
  const apiOrigin = assertStagingUrl(apiBaseUrl, "OPS_API_BASE_URL");
  const driverOrigin = assertStagingUrl(
    driverBaseUrl,
    "EXTERNAL_API_ACCEPTANCE_DRIVER_URL"
  );
  const runId = `acceptance-${randomUUID()}`;

  const setup = resultOf(
    (
      await jsonRequest(request, `${driverOrigin}/scenario/reset`, {
        driver: true,
        body: { runId },
      })
    ).body
  );
  const sourceId = String(setup.sourceId);
  const formId = String(setup.formId);
  const intakeCredential = String(setup.intakeCredential);
  const analyticsCredential = String(setup.analyticsCredential);

  await test.step("1. configure source, form, and separate credentials", async () => {
    expect(sourceId).toMatch(/^src_/);
    expect(formId).toMatch(/^frm_/);
    expect(intakeCredential).not.toBe(analyticsCredential);
    const config = resultOf(
      (
        await jsonRequest(request, `${apiOrigin}/v1/intake/config`, {
          credential: intakeCredential,
        })
      ).body
    );
    expect(config.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId,
          forms: expect.arrayContaining([expect.objectContaining({ formId })]),
        }),
      ])
    );
  });

  const files = [
    {
      callerFileId: "clean-photo",
      filename: "clean.png",
      sizeBytes: cleanPhoto.length,
      contentType: "image/png",
      sha256: sha256Hex(cleanPhoto),
      bytes: cleanPhoto,
    },
    {
      callerFileId: "unsafe-photo",
      filename: "unsafe.png",
      sizeBytes: unsafePhoto.length,
      contentType: "image/png",
      sha256: sha256Hex(unsafePhoto),
      bytes: unsafePhoto,
    },
    {
      callerFileId: "clean-document",
      filename: "scope.pdf",
      sizeBytes: cleanPdf.length,
      contentType: "application/pdf",
      sha256: sha256Hex(cleanPdf),
      bytes: cleanPdf,
    },
  ];
  const uploadReservation = resultOf(
    (
      await jsonRequest(request, `${apiOrigin}/v1/intake/uploads`, {
        credential: intakeCredential,
        idempotencyKey: `${runId}-uploads`,
        body: {
          sourceId,
          formId,
          files: files.map(({ bytes: _bytes, ...file }) => file),
        },
        expected: [200, 201],
      })
    ).body
  );
  const issuedUploads = uploadReservation.uploads as JsonRecord[];
  expect(issuedUploads).toHaveLength(3);

  await Promise.all(
    issuedUploads.map((upload, index) =>
      uploadCapability(
        request,
        upload.capability as JsonRecord,
        files[index].bytes
      )
    )
  );

  const submissionPayload = {
    sourceId,
    formId,
    contact: {
      name: "OPS Acceptance Fixture",
      email: `external-api-acceptance+${runId}@ops.test`,
      phone: "+16045550199",
      organizationName: "OPS Acceptance Fixture",
      phoneRegion: "CA",
    },
    serviceAddress: {
      line1: "100 Test Range",
      city: "Vancouver",
      region: "BC",
      postalCode: "V6B 1A1",
      countryCode: "CA",
    },
    workSummary: "Staging-only intake, file, lifecycle, and analytics proof.",
    answers: [
      {
        fieldKey: "service",
        label: "Service",
        type: "single_choice",
        value: "Roofing",
      },
    ],
    attribution: {
      utmSource: "ops-acceptance",
      utmMedium: "staging",
      utmCampaign: runId,
      landingPageUrl: "https://acceptance.invalid/request",
    },
    uploadIds: issuedUploads.map((upload) => upload.uploadId),
    externalSubmissionId: runId,
  };
  let submissionResult: JsonRecord;

  await test.step("2. submit contact, work, attribution, two photos, and one PDF", async () => {
    submissionResult = resultOf(
      (
        await jsonRequest(request, `${apiOrigin}/v1/intake/submissions`, {
          credential: intakeCredential,
          idempotencyKey: `${runId}-submission`,
          body: submissionPayload,
          expected: [200, 201],
        })
      ).body
    );
    expect(submissionResult.publicLeadId).toMatch(/^lead_/);
    expect(submissionResult.publicSubmissionId).toMatch(/^sub_/);
  });

  await test.step("3. accept clean files and reject the unsafe photo without losing the lead", async () => {
    await jsonRequest(request, `${driverOrigin}/scenario/settle-files`, {
      driver: true,
      body: {
        runId,
        publicSubmissionId: submissionResult.publicSubmissionId,
        expected: {
          "clean-photo": "accepted",
          "clean-document": "accepted",
          "unsafe-photo": "rejected",
        },
      },
    });
    const status = resultOf(
      (
        await jsonRequest(
          request,
          `${apiOrigin}/v1/intake/submissions/${encodeURIComponent(String(submissionResult.publicSubmissionId))}`,
          { credential: intakeCredential }
        )
      ).body
    );
    expect(status.attachmentProcessingTerminal).toBe(true);
    expect(status.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callerFileId: "clean-photo",
          state: "accepted",
        }),
        expect.objectContaining({
          callerFileId: "clean-document",
          state: "accepted",
        }),
        expect.objectContaining({
          callerFileId: "unsafe-photo",
          state: "rejected",
        }),
      ])
    );
  });

  await test.step("4–6. match the customer, create one visible lead, assign it, and reconcile files", async () => {
    const readback = resultOf(
      (
        await jsonRequest(request, `${driverOrigin}/scenario/readback`, {
          driver: true,
          body: { runId },
        })
      ).body
    );
    expect(readback.customerRecords).toBe(1);
    expect(readback.leadRecords).toBe(1);
    expect(readback.assignmentVisible).toBe(true);
    expect(readback.fileStates).toEqual({
      accepted: 2,
      rejected: 1,
      pending: 0,
    });
  });

  await test.step("7. associate a later real email through authenticated correlation", async () => {
    const association = resultOf(
      (
        await jsonRequest(request, `${driverOrigin}/scenario/associate-email`, {
          driver: true,
          body: { runId },
        })
      ).body
    );
    expect(association.associatedLeadCount).toBe(1);
    expect(association.markerAuthenticated).toBe(true);
    expect(association.markerEncrypted).toBe(true);
  });

  await test.step("8. replay without duplicate records or events", async () => {
    const replay = resultOf(
      (
        await jsonRequest(request, `${apiOrigin}/v1/intake/submissions`, {
          credential: intakeCredential,
          idempotencyKey: `${runId}-submission`,
          body: submissionPayload,
        })
      ).body
    );
    expect(replay.publicLeadId).toBe(submissionResult.publicLeadId);
    expect(replay.publicSubmissionId).toBe(submissionResult.publicSubmissionId);
    const readback = resultOf(
      (
        await jsonRequest(request, `${driverOrigin}/scenario/readback`, {
          driver: true,
          body: { runId },
        })
      ).body
    );
    expect(readback.customerRecords).toBe(1);
    expect(readback.leadRecords).toBe(1);
    expect(readback.submissionEvents).toBe(1);
  });

  await test.step("9. full sync every company lead without personal content", async () => {
    const page = resultOf(
      (
        await jsonRequest(
          request,
          `${apiOrigin}/v1/analytics/leads?mode=full&page_size=250`,
          { credential: analyticsCredential }
        )
      ).body
    );
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain("OPS Acceptance Fixture");
    expect(serialized).not.toContain("@ops.test");
    expect(serialized).not.toContain("100 Test Range");
    expect(serialized).not.toContain("clean.png");
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          publicLeadId: submissionResult.publicLeadId,
          source: expect.objectContaining({ sourceId, formId }),
        }),
      ])
    );
  });

  await test.step("10. return versioned and suppressed metrics", async () => {
    const metrics = resultOf(
      (
        await jsonRequest(
          request,
          `${apiOrigin}/v1/analytics/metrics?preset=30d&definition_version=1&metric=leads_received&metric=cohort_decided_win_rate&group_by=source`,
          { credential: analyticsCredential }
        )
      ).body
    );
    expect(metrics.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ definitionVersion: "1" }),
      ])
    );
    for (const cell of metrics.cells as JsonRecord[]) {
      if (cell.suppressed) expect(cell.value).toBeNull();
    }
  });

  let financialCredential: string;
  await test.step("11. add financial scope and return only approved financial values", async () => {
    const financial = resultOf(
      (
        await jsonRequest(
          request,
          `${driverOrigin}/scenario/issue-financial-credential`,
          { driver: true, body: { runId } }
        )
      ).body
    );
    financialCredential = String(financial.credential);
    const metrics = resultOf(
      (
        await jsonRequest(
          request,
          `${apiOrigin}/v1/analytics/metrics?preset=30d&definition_version=1&metric=cohort_won_value&metric=invoiced_event_total&metric=paid_event_total`,
          { credential: financialCredential }
        )
      ).body
    );
    expect(JSON.stringify(metrics)).not.toMatch(
      /contact|email|phone|address|filename/i
    );
    expect(metrics.cells).toHaveLength(3);
  });

  await test.step("conversion before and after inspection preserves private, idempotent file lineage", async () => {
    const branches = resultOf(
      (
        await jsonRequest(
          request,
          `${driverOrigin}/scenario/conversion-branches`,
          {
            driver: true,
            body: { runId },
          }
        )
      ).body
    );
    expect(branches.beforeInspection).toMatchObject({
      privateProjection: true,
      sourcePreserved: true,
      idempotent: true,
    });
    expect(branches.afterInspection).toMatchObject({
      privateProjection: true,
      sourcePreserved: true,
      idempotent: true,
    });
  });

  await test.step("erasure removes all protected content and emits one tombstone", async () => {
    const erased = resultOf(
      (
        await jsonRequest(request, `${driverOrigin}/scenario/erase`, {
          driver: true,
          body: { runId },
        })
      ).body
    );
    expect(erased).toMatchObject({
      originalsAbsent: true,
      derivativesAbsent: true,
      relationshipsAbsent: true,
      deliveryDenied: true,
      protectedContentAbsent: true,
      tombstoneCount: 1,
    });
  });

  await test.step("12. revoke and deny the next request and cache access", async () => {
    await jsonRequest(request, `${driverOrigin}/scenario/revoke`, {
      driver: true,
      body: { runId, credentialClass: "analytics" },
    });
    const denied = await jsonRequest(
      request,
      `${apiOrigin}/v1/analytics/leads?mode=full&page_size=1`,
      {
        credential: analyticsCredential,
        expected: [401],
      }
    );
    expect(denied.response.headers()["cache-control"]).toBe("no-store");
  });
});
