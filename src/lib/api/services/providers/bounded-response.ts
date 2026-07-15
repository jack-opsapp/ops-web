import { ProviderAttachmentTooLargeError } from "../email-provider";

function requirePositiveByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError(
      "Attachment response limit must be a positive safe integer"
    );
  }
}

function contentLength(response: Response): number | null {
  const raw = response.headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Read a provider response without ever retaining more than `maxBytes` of raw
 * response data. The caller must validate HTTP status before invoking this.
 */
export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  context: string
): Promise<Buffer> {
  requirePositiveByteLimit(maxBytes);

  const declaredLength = contentLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderAttachmentTooLargeError(
      `${context} exceeds the ${maxBytes} byte limit`,
      declaredLength
    );
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new ProviderAttachmentTooLargeError(
        `${context} exceeds the ${maxBytes} byte limit`,
        bytes.byteLength
      );
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderAttachmentTooLargeError(
          `${context} exceeds the ${maxBytes} byte limit`,
          total
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(
    chunks.map((chunk) =>
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    ),
    total
  );
}
