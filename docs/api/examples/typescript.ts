type OpsEnvelope<T> = {
  requestId: string;
  apiVersion: "v1";
  serverTimestamp: string;
  result: T;
};

type OpsErrorEnvelope = {
  error: { status: number; code: string; message: string };
};

const baseUrl = process.env.OPS_API_BASE_URL ?? "https://app.opsapp.co";

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const intakeCredential = requiredEnvironmentVariable(
  "OPS_INTAKE_CREDENTIAL"
);

async function request<T>(
  path: string,
  credential: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${credential}`,
      accept: "application/json",
      ...init.headers,
    },
  });
  const body = (await response.json()) as OpsEnvelope<T> | OpsErrorEnvelope;
  if (!response.ok || !("result" in body)) {
    throw new Error(
      "error" in body ? body.error.code : `http_${response.status}`
    );
  }
  return body.result;
}

export async function submitQuote(input: {
  sourceId: string;
  formId: string;
  retryKey: string;
  contact: { name: string; email?: string; phone?: string };
  workSummary?: string;
  uploadIds?: string[];
  externalSubmissionId: string;
}) {
  return request<{
    publicSubmissionId: string;
    publicLeadId: string;
    replayed: boolean;
  }>("/v1/intake/submissions", intakeCredential, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": input.retryKey,
    },
    body: JSON.stringify({
      sourceId: input.sourceId,
      formId: input.formId,
      contact: input.contact,
      workSummary: input.workSummary,
      answers: [],
      uploadIds: input.uploadIds ?? [],
      externalSubmissionId: input.externalSubmissionId,
    }),
  });
}

// This module runs on the website server. Never import it into a browser bundle.
