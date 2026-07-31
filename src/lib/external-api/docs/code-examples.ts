import "server-only";

import {
  EXTERNAL_API_REFERENCE_OPERATION_IDS,
  externalApiReference,
  type ExternalApiReference,
  type ExternalApiReferenceOperation,
  type ExternalApiReferenceOperationId,
} from "./reference";

export const EXTERNAL_API_EXAMPLE_LANGUAGES = [
  "curl",
  "javascript",
  "typescript",
  "php",
] as const;

export type ExternalApiExampleLanguage =
  (typeof EXTERNAL_API_EXAMPLE_LANGUAGES)[number];

export interface ExternalApiCodeExample {
  language: ExternalApiExampleLanguage;
  label: string;
  code: string;
}

export type ExternalApiCodeExamples = Record<
  ExternalApiReferenceOperationId,
  ExternalApiCodeExample[]
>;

function exampleUrl(
  operation: ExternalApiReferenceOperation,
  baseUrl: string,
  language: ExternalApiExampleLanguage
): string {
  if (!operation.path.includes("{publicSubmissionId}")) {
    return `${baseUrl}${operation.path}`;
  }
  if (language === "curl") {
    return `${baseUrl}${operation.path.replace(
      "{publicSubmissionId}",
      "${PUBLIC_SUBMISSION_ID}"
    )}`;
  }
  if (language === "php") {
    return `${baseUrl}${operation.path.replace(
      "{publicSubmissionId}",
      "{$publicSubmissionId}"
    )}`;
  }
  return `${baseUrl}${operation.path.replace(
    "{publicSubmissionId}",
    "${encodeURIComponent(publicSubmissionId)}"
  )}`;
}

function jsonBody(operation: ExternalApiReferenceOperation): string | null {
  return operation.request
    ? JSON.stringify(operation.request.example, null, 2)
    : null;
}

function requiresIdempotencyKey(
  operation: ExternalApiReferenceOperation
): boolean {
  return operation.parameters.some(
    (parameter) =>
      parameter.location === "header" &&
      parameter.name.toLowerCase() === "idempotency-key"
  );
}

function curlExample(
  operation: ExternalApiReferenceOperation,
  baseUrl: string
): string {
  const lines = [
    `curl --request ${operation.method.toUpperCase()} \\`,
    `  --url '${exampleUrl(operation, baseUrl, "curl")}' \\`,
    '  --header "Authorization: Bearer $OPS_API_TOKEN" \\',
    "  --header 'Accept: application/json'",
  ];
  if (requiresIdempotencyKey(operation)) {
    lines[lines.length - 1] += " \\";
    lines.push(
      '  --header "Idempotency-Key: $IDEMPOTENCY_KEY" \\',
      "  --header 'Content-Type: application/json'"
    );
  }
  const body = jsonBody(operation);
  if (body) {
    lines[lines.length - 1] += " \\";
    lines.push(`  --data-binary '${body}'`);
  }
  return lines.join("\n");
}

function javascriptExample(
  operation: ExternalApiReferenceOperation,
  baseUrl: string,
  typed: boolean
): string {
  const functionSignature = operation.path.includes("{publicSubmissionId}")
    ? typed
      ? "async function request(publicSubmissionId: string) {"
      : "async function request(publicSubmissionId) {"
    : "async function request() {";
  const headers = [
    '    "Accept": "application/json",',
    '    "Authorization": `Bearer ${token}`,',
  ];
  if (requiresIdempotencyKey(operation)) {
    headers.push(
      '    "Content-Type": "application/json",',
      '    "Idempotency-Key": crypto.randomUUID(),'
    );
  }
  const body = jsonBody(operation);
  const bodyLines = body
    ? [
        `  const payload${typed ? ": Record<string, unknown>" : ""} = ${body};`,
        "",
      ]
    : [];
  return [
    'const token = process.env.OPS_API_TOKEN;',
    'if (!token) throw new Error("OPS_API_TOKEN is required");',
    "",
    functionSignature,
    ...bodyLines,
    `  const response = await fetch(\`${exampleUrl(
      operation,
      baseUrl,
      typed ? "typescript" : "javascript"
    )}\`, {`,
    `    method: "${operation.method.toUpperCase()}",`,
    "    headers: {",
    ...headers,
    "    },",
    ...(body ? ["    body: JSON.stringify(payload),"] : []),
    "  });",
    "",
    "  if (!response.ok) {",
    "    throw new Error(`OPS request failed: ${response.status}`);",
    "  }",
    `  return (await response.json())${typed ? " as unknown" : ""};`,
    "}",
  ].join("\n");
}

function phpExample(
  operation: ExternalApiReferenceOperation,
  baseUrl: string
): string {
  const body = jsonBody(operation);
  const setup = [
    "<?php",
    "$token = getenv('OPS_API_TOKEN');",
    "if (!$token) {",
    "    throw new RuntimeException('OPS_API_TOKEN is required');",
    "}",
  ];
  if (operation.path.includes("{publicSubmissionId}")) {
    setup.push(
      "$publicSubmissionId = rawurlencode(getenv('PUBLIC_SUBMISSION_ID') ?: '');"
    );
  }
  if (body) {
    setup.push(`$body = <<<'JSON'\n${body}\nJSON;`);
  }
  const headers = [
    "'Accept: application/json'",
    "'Authorization: Bearer ' . $token",
  ];
  if (requiresIdempotencyKey(operation)) {
    headers.push(
      "'Content-Type: application/json'",
      "'Idempotency-Key: ' . bin2hex(random_bytes(16))"
    );
  }
  return [
    ...setup,
    "",
    `$request = curl_init("${exampleUrl(operation, baseUrl, "php")}");`,
    "curl_setopt_array($request, [",
    "    CURLOPT_RETURNTRANSFER => true,",
    `    CURLOPT_CUSTOMREQUEST => '${operation.method.toUpperCase()}',`,
    `    CURLOPT_HTTPHEADER => [${headers.join(", ")}],`,
    ...(body ? ["    CURLOPT_POSTFIELDS => $body,"] : []),
    "]);",
    "$response = curl_exec($request);",
    "$status = curl_getinfo($request, CURLINFO_RESPONSE_CODE);",
    "curl_close($request);",
    "",
    "if ($response === false || $status >= 400) {",
    "    throw new RuntimeException(\"OPS request failed: {$status}\");",
    "}",
    "$result = json_decode($response, true, flags: JSON_THROW_ON_ERROR);",
  ].join("\n");
}

export function buildExternalApiCodeExamples(
  reference: ExternalApiReference
): ExternalApiCodeExamples {
  return Object.fromEntries(
    EXTERNAL_API_REFERENCE_OPERATION_IDS.map((operationId) => {
      const operation = reference.operations.find(
        (candidate) => candidate.operationId === operationId
      );
      if (!operation) {
        throw new Error(
          `Missing operation for code examples: ${operationId}`
        );
      }
      return [
        operationId,
        [
          {
            language: "curl",
            label: "HTTP / cURL",
            code: curlExample(operation, reference.baseUrl),
          },
          {
            language: "javascript",
            label: "JavaScript",
            code: javascriptExample(operation, reference.baseUrl, false),
          },
          {
            language: "typescript",
            label: "TypeScript",
            code: javascriptExample(operation, reference.baseUrl, true),
          },
          {
            language: "php",
            label: "PHP",
            code: phpExample(operation, reference.baseUrl),
          },
        ],
      ];
    })
  ) as ExternalApiCodeExamples;
}

export const externalApiCodeExamples =
  buildExternalApiCodeExamples(externalApiReference);

export const externalApiWorkflowExamples = Object.freeze({
  browserUpload: `// Browser code receives this capability from your server.
export async function uploadReservedFile(file, capability) {
  const headers = capability.requiredHeaders;
  const response = await fetch(capability.url, {
    method: capability.method,
    headers: {
      "Content-Type": headers.contentType,
      "Content-Length": String(headers.contentLength),
      "If-None-Match": headers.ifNoneMatch,
    },
    body: file,
  });
  if (!response.ok) throw new Error("Reserved upload failed");
}`,
  attachmentPolling: `for (;;) {
  const status = await readSubmissionStatus(publicSubmissionId);
  if (status.result.attachmentProcessingTerminal) {
    break;
  }
  const delaySeconds = status.result.pollAfterSeconds ?? 2;
  await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
}`,
  leadSynchronization: `const query = new URLSearchParams();
query.set("mode", "full");

let nextCursor = null;
let nextSyncCheckpoint = null;
do {
  if (nextCursor) query.set("cursor", nextCursor);
  const page = await readLeadPage(query);
  nextCursor = page.result.nextCursor;
  nextSyncCheckpoint = page.result.nextSyncCheckpoint;
} while (nextCursor);

if (!nextSyncCheckpoint) throw new Error("Full sync is not complete");
query.set("mode", "incremental");
query.set("sync_checkpoint", nextSyncCheckpoint);
query.delete("cursor");
const changes = await readLeadPage(query);`,
});
