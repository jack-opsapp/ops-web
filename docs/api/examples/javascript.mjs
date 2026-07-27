const BASE_URL = process.env.OPS_API_BASE_URL ?? "https://app.opsapp.co";
const INTAKE_CREDENTIAL = process.env.OPS_INTAKE_CREDENTIAL;
const ANALYTICS_CREDENTIAL = process.env.OPS_ANALYTICS_CREDENTIAL;

if (!INTAKE_CREDENTIAL || !ANALYTICS_CREDENTIAL) {
  throw new Error("OPS server credentials are required");
}

async function opsRequest(path, credential, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${credential}`,
      accept: "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `OPS request failed: ${body.error?.code ?? response.status}`
    );
  }
  return body.result;
}

export async function getIntakeConfig() {
  return opsRequest("/v1/intake/config", INTAKE_CREDENTIAL);
}

export async function reserveUploads({ sourceId, formId, files, retryKey }) {
  return opsRequest("/v1/intake/uploads", INTAKE_CREDENTIAL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": retryKey,
    },
    body: JSON.stringify({ sourceId, formId, files }),
  });
}

// Return only this capability to the browser. Never return INTAKE_CREDENTIAL.
export async function uploadFromBrowser(file, issuedUpload) {
  const { capability } = issuedUpload;
  const headers = {
    "content-type": capability.requiredHeaders.contentType,
    "content-length": String(capability.requiredHeaders.contentLength),
    "if-none-match": capability.requiredHeaders.ifNoneMatch,
  };
  if (capability.requiredHeaders.checksumSha256) {
    headers["x-amz-checksum-sha256"] =
      capability.requiredHeaders.checksumSha256;
  }
  const response = await fetch(capability.url, {
    method: capability.method,
    headers,
    body: file,
  });
  if (!response.ok) throw new Error("Direct upload failed");
}

export async function createSubmission({
  sourceId,
  formId,
  contact,
  workSummary,
  attribution,
  uploadIds,
  externalSubmissionId,
  retryKey,
}) {
  return opsRequest("/v1/intake/submissions", INTAKE_CREDENTIAL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": retryKey,
    },
    body: JSON.stringify({
      sourceId,
      formId,
      contact,
      workSummary,
      attribution,
      uploadIds,
      externalSubmissionId,
      answers: [],
    }),
  });
}

export async function waitForFiles(publicSubmissionId) {
  for (;;) {
    const result = await opsRequest(
      `/v1/intake/submissions/${encodeURIComponent(publicSubmissionId)}`,
      INTAKE_CREDENTIAL
    );
    if (result.attachmentProcessingTerminal) return result;
    await new Promise((resolve) =>
      setTimeout(resolve, result.pollAfterSeconds * 1_000)
    );
  }
}

export async function fullLeadSync(applyPage) {
  let cursor;
  let terminalCheckpoint;
  do {
    const query = new URLSearchParams({ mode: "full", page_size: "250" });
    if (cursor) query.set("cursor", cursor);
    const page = await opsRequest(
      `/v1/analytics/leads?${query}`,
      ANALYTICS_CREDENTIAL
    );
    await applyPage(page.items);
    cursor = page.nextCursor ?? undefined;
    terminalCheckpoint = page.nextSyncCheckpoint ?? terminalCheckpoint;
  } while (cursor);
  // Persist only after every page above commits successfully.
  return terminalCheckpoint;
}

export async function incrementalLeadSync(checkpoint, applyPage) {
  let cursor;
  let nextCheckpoint = checkpoint;
  do {
    const query = new URLSearchParams({
      mode: "incremental",
      page_size: "250",
      sync_checkpoint: checkpoint,
    });
    if (cursor) query.set("cursor", cursor);
    const page = await opsRequest(
      `/v1/analytics/leads?${query}`,
      ANALYTICS_CREDENTIAL
    );
    await applyPage(page.items);
    cursor = page.nextCursor ?? undefined;
    nextCheckpoint = page.nextSyncCheckpoint ?? nextCheckpoint;
  } while (cursor);
  return nextCheckpoint;
}

export async function getDashboardMetrics() {
  const query = new URLSearchParams({
    preset: "30d",
    definition_version: "1",
  });
  query.append("metric", "leads_received");
  query.append("metric", "cohort_decided_win_rate");
  query.append("group_by", "source");
  return opsRequest(`/v1/analytics/metrics?${query}`, ANALYTICS_CREDENTIAL);
}
