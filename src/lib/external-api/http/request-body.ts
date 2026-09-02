import { z } from "zod";

import { MAX_JSON_BODY_BYTES } from "../contracts/common";

export type RequestBodyFailureReason =
  | "unsupported_content_type"
  | "body_missing"
  | "body_too_large"
  | "invalid_utf8"
  | "malformed_json"
  | "validation_failed";

export class RequestBodyError extends Error {
  readonly code = "invalid_request" as const;
  readonly status = 400;

  constructor(
    readonly reason: RequestBodyFailureReason,
    message: string
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

function requireJsonContentType(request: Request): void {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestBodyError(
      "unsupported_content_type",
      "Content-Type must be application/json."
    );
  }
}

async function readBoundedBytes(
  request: Request,
  maxBytes: number
): Promise<Uint8Array> {
  if (request.body === null) {
    throw new RequestBodyError(
      "body_missing",
      "A JSON request body is required."
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("body limit exceeded");
        throw new RequestBodyError(
          "body_too_large",
          `The JSON request body exceeds ${maxBytes} bytes.`
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (byteLength === 0) {
    throw new RequestBodyError(
      "body_missing",
      "A JSON request body is required."
    );
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedJson<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  maxBytes = MAX_JSON_BODY_BYTES
): Promise<z.output<TSchema>> {
  requireJsonContentType(request);
  const bytes = await readBoundedBytes(request, maxBytes);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError(
      "invalid_utf8",
      "The JSON request body must be valid UTF-8."
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new RequestBodyError(
      "malformed_json",
      "The JSON request body is malformed."
    );
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new RequestBodyError(
      "validation_failed",
      "The JSON request body does not match the endpoint contract."
    );
  }
  return parsed.data as z.output<TSchema>;
}
