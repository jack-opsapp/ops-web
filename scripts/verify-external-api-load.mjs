#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

const profiles = {
  expected: {
    submissionCount: 50,
    submissionConcurrency: 10,
    replayConcurrency: 20,
    uploadConcurrency: 10,
  },
  high: {
    submissionCount: 250,
    submissionConcurrency: 40,
    replayConcurrency: 75,
    uploadConcurrency: 30,
  },
};

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return Number(sorted[index].toFixed(2));
}

function summarize(samples) {
  const durations = samples.map((sample) => sample.durationMs);
  const failures = samples.filter((sample) => !sample.ok);
  return {
    requests: samples.length,
    errors: failures.length,
    errorRatePercent: samples.length
      ? Number(((failures.length / samples.length) * 100).toFixed(3))
      : 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    statusCounts: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.status))]
        .sort((left, right) => left - right)
        .map((status) => [
          status,
          samples.filter((sample) => sample.status === status).length,
        ])
    ),
  };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(items.length, 1)) },
      runWorker
    )
  );
  return results;
}

const profileName =
  argumentValue("--profile") ?? process.env.EXTERNAL_API_LOAD_PROFILE ?? "";
const profile = profiles[profileName];
if (!profile) {
  throw new Error("Use --profile expected or --profile high");
}
if (
  !process.argv.includes("--confirm-staging") ||
  process.env.EXTERNAL_API_LOAD_CONFIRM !== "staging"
) {
  throw new Error(
    "Refusing to create synthetic leads without --confirm-staging and EXTERNAL_API_LOAD_CONFIRM=staging"
  );
}

const baseUrl = new URL(requiredEnvironment("OPS_API_BASE_URL"));
if (
  baseUrl.protocol !== "https:" ||
  /(^|\.)opsapp\.co$/i.test(baseUrl.hostname) ||
  /(^|\.)ops\.app$/i.test(baseUrl.hostname)
) {
  throw new Error(
    "Load verification requires a non-production HTTPS staging hostname"
  );
}

const intakeCredential = requiredEnvironment("OPS_INTAKE_CREDENTIAL");
const analyticsCredential = requiredEnvironment("OPS_ANALYTICS_CREDENTIAL");
const runId = `load-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const outputPath = resolve(
  argumentValue("--output") ?? `docs/artifacts/external-api-load-${runId}.json`
);
const samples = [];

async function request(path, credential, init = {}, expected = [200]) {
  const started = performance.now();
  let response;
  let body;
  try {
    response = await fetch(new URL(path, baseUrl), {
      ...init,
      redirect: "error",
      headers: {
        authorization: `Bearer ${credential}`,
        accept: "application/json",
        ...init.headers,
      },
    });
    body = await response.json().catch(() => null);
  } catch (error) {
    samples.push({
      route: path.split("?")[0],
      status: 0,
      ok: false,
      durationMs: Number((performance.now() - started).toFixed(2)),
      retryAfter: null,
      cacheControl: null,
      serverTiming: null,
    });
    throw error;
  }

  const sample = {
    route: path.split("?")[0],
    status: response.status,
    ok: expected.includes(response.status),
    durationMs: Number((performance.now() - started).toFixed(2)),
    retryAfter: response.headers.get("retry-after"),
    cacheControl: response.headers.get("cache-control"),
    serverTiming: response.headers.get("server-timing"),
  };
  samples.push(sample);

  if (!sample.ok) {
    const code =
      body && typeof body === "object" && body.error?.code
        ? String(body.error.code)
        : `http_${response.status}`;
    throw new Error(`${path.split("?")[0]} failed with ${code}`);
  }
  return { body, response };
}

function resultOf(body) {
  if (!body || typeof body !== "object" || !("result" in body)) {
    throw new Error("API response omitted result");
  }
  return body.result;
}

const configResponse = await request(
  "/v1/intake/config",
  intakeCredential,
  {},
  [200]
);
const config = resultOf(configResponse.body);
const source = config.sources?.[0];
const form = source?.forms?.find((candidate) => candidate.isDefault);
if (!source || !form) {
  throw new Error("The staging intake credential has no active default form");
}

const contact = {
  name: "OPS Load Verification",
  email: `external-api-load+${runId}@ops.test`,
};
const submissionBase = {
  sourceId: source.sourceId,
  formId: form.formId,
  contact,
  workSummary: "Synthetic staging-only load verification inquiry.",
  answers: [],
  attribution: {
    utmSource: "ops-load-verification",
    utmMedium: "staging",
    utmCampaign: profileName,
  },
  uploadIds: [],
};

const replayKey = `${runId}-same-key`;
const replayBody = JSON.stringify({
  ...submissionBase,
  externalSubmissionId: `${runId}-same-key`,
});
const replayResults = await runPool(
  Array.from({ length: profile.replayConcurrency }),
  profile.replayConcurrency,
  async () =>
    resultOf(
      (
        await request(
          "/v1/intake/submissions",
          intakeCredential,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": replayKey,
            },
            body: replayBody,
          },
          [200, 201]
        )
      ).body
    )
);
const replayLeadIds = new Set(
  replayResults.map((result) => result.publicLeadId)
);
const replaySubmissionIds = new Set(
  replayResults.map((result) => result.publicSubmissionId)
);
if (replayLeadIds.size !== 1 || replaySubmissionIds.size !== 1) {
  throw new Error("Same-key submission race created more than one result");
}

const distinctSubmissionIndexes = Array.from(
  { length: profile.submissionCount },
  (_, index) => index
);
const fullSyncDuringWrites = request(
  "/v1/analytics/leads?mode=full&page_size=250",
  analyticsCredential,
  {},
  [200]
);
await runPool(
  distinctSubmissionIndexes,
  profile.submissionConcurrency,
  async (index) => {
    const key = `${runId}-customer-race-${index}`;
    const body = JSON.stringify({
      ...submissionBase,
      externalSubmissionId: key,
    });
    return request(
      "/v1/intake/submissions",
      intakeCredential,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body,
      },
      [200, 201]
    );
  }
);
const firstLeadPage = resultOf((await fullSyncDuringWrites).body);
if (!Array.isArray(firstLeadPage.items) || firstLeadPage.items.length > 250) {
  throw new Error("Full lead sync page violated the 250-row contract");
}

let cursor = firstLeadPage.nextCursor;
let checkpoint = firstLeadPage.nextSyncCheckpoint ?? null;
let pageCount = 1;
while (cursor) {
  const page = resultOf(
    (
      await request(
        `/v1/analytics/leads?mode=full&page_size=250&cursor=${encodeURIComponent(cursor)}`,
        analyticsCredential,
        {},
        [200]
      )
    ).body
  );
  if (!Array.isArray(page.items) || page.items.length > 250) {
    throw new Error("Full lead sync continuation violated the page contract");
  }
  cursor = page.nextCursor;
  checkpoint = page.nextSyncCheckpoint ?? checkpoint;
  pageCount += 1;
}
if (!checkpoint) {
  throw new Error("Terminal full-sync page omitted its checkpoint");
}

const incremental = resultOf(
  (
    await request(
      `/v1/analytics/leads?mode=incremental&page_size=250&sync_checkpoint=${encodeURIComponent(checkpoint)}`,
      analyticsCredential,
      {},
      [200]
    )
  ).body
);
if (!Array.isArray(incremental.items) || incremental.items.length > 250) {
  throw new Error("Incremental lead sync violated the page contract");
}

const uploadBody = JSON.stringify({
  sourceId: source.sourceId,
  formId: form.formId,
  files: [
    {
      callerFileId: `${runId}-quota`,
      filename: "quota-check.txt",
      sizeBytes: 1,
      contentType: "text/plain",
    },
  ],
});
const uploadKey = `${runId}-upload-race`;
const uploadResults = await runPool(
  Array.from({ length: profile.uploadConcurrency }),
  profile.uploadConcurrency,
  async () =>
    resultOf(
      (
        await request(
          "/v1/intake/uploads",
          intakeCredential,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": uploadKey,
            },
            body: uploadBody,
          },
          [200, 201]
        )
      ).body
    )
);
const uploadIds = new Set(
  uploadResults.flatMap((result) =>
    result.uploads.map((upload) => upload.uploadId)
  )
);
if (uploadIds.size !== 1) {
  throw new Error("Upload reservation race created more than one intent");
}

const now = new Date();
const customFrom = new Date(now);
customFrom.setUTCDate(customFrom.getUTCDate() - 366);
const metricQueries = [
  "preset=7d&metric=leads_received&group_by=day&group_by=source",
  "preset=30d&metric=leads_received&metric=cohort_decided_win_rate&group_by=week&group_by=source",
  "preset=90d&metric=leads_received&group_by=month&group_by=source",
  `preset=custom&from=${customFrom.toISOString().slice(0, 10)}&to=${now.toISOString().slice(0, 10)}&metric=leads_received&group_by=month&group_by=source`,
  "preset=lifetime&metric=leads_received&group_by=source",
];
await Promise.all(
  metricQueries.map((query) =>
    request(
      `/v1/analytics/metrics?definition_version=1&${query}`,
      analyticsCredential
    )
  )
);

const invalidCredential = `invalid-${randomUUID()}`;
for (const path of [
  "/v1/intake/config",
  "/v1/analytics/leads?mode=full&page_size=1",
  "/v1/analytics/metrics?preset=7d&definition_version=1&metric=leads_received",
]) {
  const { response } = await request(path, invalidCredential, {}, [401, 403]);
  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error("Rejected protected route did not disable caching");
  }
}

const failureProbes = JSON.parse(
  process.env.EXTERNAL_API_FAILURE_PROBE_URLS_JSON ?? "[]"
);
if (!Array.isArray(failureProbes)) {
  throw new Error("EXTERNAL_API_FAILURE_PROBE_URLS_JSON must be an array");
}
for (const probe of failureProbes) {
  if (
    !probe ||
    typeof probe !== "object" ||
    typeof probe.path !== "string" ||
    !["intake", "analytics"].includes(probe.credential)
  ) {
    throw new Error("A failure probe is malformed");
  }
  const credential =
    probe.credential === "intake" ? intakeCredential : analyticsCredential;
  const { response } = await request(
    probe.path,
    credential,
    { method: probe.method ?? "GET" },
    [503]
  );
  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error(`${probe.path} failure injection did not fail closed`);
  }
}

const report = {
  schemaVersion: 1,
  runId,
  generatedAt: new Date().toISOString(),
  targetOrigin: baseUrl.origin,
  profile: profileName,
  parameters: profile,
  assertions: {
    sameKeyReplaySingleLead: true,
    sameKeyReplaySingleSubmission: true,
    uploadReservationSingleIntent: true,
    fullSyncPageLimit: true,
    fullSyncTerminalCheckpoint: true,
    incrementalPageLimit: true,
    metricsRangeMatrix: true,
    rejectedCredentialsFailClosed: true,
    injectedFailuresFailClosed: failureProbes.length > 0,
  },
  measurements: {
    overall: summarize(samples),
    byRoute: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.route))]
        .sort()
        .map((route) => [
          route,
          summarize(samples.filter((sample) => sample.route === route)),
        ])
    ),
    fullSyncPages: pageCount,
    serverTimingSamples: samples
      .map((sample) => sample.serverTiming)
      .filter(Boolean),
    cacheObservation:
      "Latency is recorded, but cache hit rate requires the private operational readback in the launch runbook.",
    queueLag:
      "Requires the SQS/worker operational readback in the launch runbook.",
    databaseQueryPlans:
      "Captured separately with the read-only EXPLAIN commands in the launch runbook.",
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx",
});
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      report: outputPath,
      profile: profileName,
      requests: samples.length,
      p95Ms: report.measurements.overall.p95Ms,
      errorRatePercent: report.measurements.overall.errorRatePercent,
    },
    null,
    2
  )}\n`
);
