import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type LookupAddress = { address: string; family: number };
type PinnedFetcher = (
  url: URL,
  init: RequestInit,
  pinnedAddress: LookupAddress
) => Promise<Response>;

export interface PublicMediaDependencies {
  lookup: (hostname: string) => Promise<LookupAddress[]>;
  fetcher: PinnedFetcher;
}

function responseHeaders(headers: import("node:http").IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

function fetchPinnedAddress(
  url: URL,
  init: RequestInit,
  pinnedAddress: LookupAddress
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        lookup(_hostname, _options, callback) {
          callback(null, pinnedAddress.address, pinnedAddress.family);
        },
      },
      (incoming) => {
        const status = incoming.statusCode ?? 500;
        const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status, headers: responseHeaders(incoming.headers) }));
      }
    );

    const abort = () => request.destroy(init.signal?.reason as Error | undefined);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    request.once("error", reject);
    request.once("close", () => init.signal?.removeEventListener("abort", abort));
    request.end();
  });
}

const defaultDependencies: PublicMediaDependencies = {
  lookup: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
  fetcher: fetchPinnedAddress,
};

export class PublicMediaError extends Error {
  constructor(
    public readonly code:
      | "INVALID_URL"
      | "PRIVATE_ADDRESS"
      | "DNS_FAILED"
      | "TOO_MANY_REDIRECTS"
      | "FETCH_TIMEOUT"
      | "FETCH_FAILED"
      | "INVALID_CONTENT_TYPE"
      | "IMAGE_TOO_LARGE"
      | "INVALID_IMAGE",
    message: string
  ) {
    super(message);
    this.name = "PublicMediaError";
  }
}

function parseIpv4(address: string): number | null {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  return octets.reduce((value, octet) => value * 256 + octet, 0);
}

function isPrivateIpv4(address: string): boolean {
  if (parseIpv4(address) === null) return true;
  const octets = address.split(".").map(Number);
  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function parseIpv6(address: string): number[] | null {
  let normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const ipv4 = parseIpv4(normalized.slice(separator + 1));
    if (separator < 0 || ipv4 === null) return null;
    normalized = `${normalized.slice(0, separator)}:${(ipv4 >>> 16).toString(16)}:${(
      ipv4 & 0xffff
    ).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function isPrivateIpv6(address: string): boolean {
  const parts = parseIpv6(address);
  if (parts === null) return true;
  const allZero = parts.every((part) => part === 0);
  const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
  if (allZero || loopback) return true;

  const upper96IsZero = parts.slice(0, 6).every((part) => part === 0);
  const mappedIpv4 = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (mappedIpv4) {
    const ipv4 = parts[6] * 65536 + parts[7];
    return isPrivateIpv4(
      [24, 16, 8, 0].map((shift) => String((ipv4 >>> shift) & 0xff)).join(".")
    );
  }
  // IPv4-compatible IPv6, multicast, link-local, ULA, and all other
  // non-global ranges are not valid public media destinations.
  if (upper96IsZero) return true;
  if (parts[0] < 0x2000 || parts[0] > 0x3fff) return true; // global unicast is 2000::/3
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return true; // documentation range
  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

function validatePublicMediaUrlSyntax(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublicMediaError("INVALID_URL", "Media URL is invalid");
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw new PublicMediaError(
      "INVALID_URL",
      "Media URL must be a public HTTPS address without credentials or custom ports"
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new PublicMediaError("PRIVATE_ADDRESS", "Media URL cannot target a private address");
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new PublicMediaError("PRIVATE_ADDRESS", "Media URL cannot target a private address");
    }
    return url;
  }

  return url;
}

export async function validatePublicMediaUrl(
  rawUrl: string,
  dependencies: Pick<PublicMediaDependencies, "lookup"> = defaultDependencies
): Promise<URL> {
  const url = validatePublicMediaUrlSyntax(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(hostname)) return url;

  let addresses: LookupAddress[];
  try {
    addresses = await dependencies.lookup(hostname);
  } catch {
    throw new PublicMediaError("DNS_FAILED", "Media host could not be resolved");
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new PublicMediaError("PRIVATE_ADDRESS", "Media host resolves to a private address");
  }

  return url;
}

async function resolvePublicMediaUrl(
  rawUrl: string,
  dependencies: Pick<PublicMediaDependencies, "lookup">
): Promise<{ url: URL; pinnedAddress: LookupAddress }> {
  const url = validatePublicMediaUrlSyntax(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(hostname)) {
    return { url, pinnedAddress: { address: hostname, family: isIP(hostname) } };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await dependencies.lookup(hostname);
  } catch {
    throw new PublicMediaError("DNS_FAILED", "Media host could not be resolved");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new PublicMediaError("PRIVATE_ADDRESS", "Media host resolves to a private address");
  }
  return { url, pinnedAddress: addresses[0] };
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SOURCE_BYTES) {
        await reader.cancel("source image exceeds limit");
        throw new PublicMediaError("IMAGE_TOO_LARGE", "Source image exceeds the 12 MB limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function downloadPublicImage(
  rawUrl: string,
  dependencyOverrides: Partial<PublicMediaDependencies> = {}
): Promise<{ buffer: Buffer; contentType: "image/jpeg"; width: number; height: number }> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const { url: safeUrl, pinnedAddress } = await resolvePublicMediaUrl(currentUrl, dependencies);
    let response: Response;

    try {
      response = await dependencies.fetcher(safeUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" },
      }, pinnedAddress);
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new PublicMediaError("FETCH_TIMEOUT", "Source image download timed out");
      }
      throw new PublicMediaError("FETCH_FAILED", "Source image could not be downloaded");
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new PublicMediaError("FETCH_FAILED", "Source image redirect was incomplete");
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new PublicMediaError("TOO_MANY_REDIRECTS", "Source image redirected too many times");
      }
      currentUrl = new URL(location, safeUrl).toString();
      await response.body?.cancel();
      continue;
    }

    if (!response.ok) {
      throw new PublicMediaError("FETCH_FAILED", `Source image returned HTTP ${response.status}`);
    }

    const sourceContentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!sourceContentType.startsWith("image/")) {
      throw new PublicMediaError("INVALID_CONTENT_TYPE", "Source URL did not return an image");
    }

    const declaredBytes = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_BYTES) {
      throw new PublicMediaError("IMAGE_TOO_LARGE", "Source image exceeds the 12 MB limit");
    }

    const sourceBuffer = await readBoundedBody(response);

    try {
      const sourceMetadata = await sharp(sourceBuffer, {
        failOn: "warning",
        limitInputPixels: MAX_INPUT_PIXELS,
      }).metadata();
      const width = sourceMetadata.width ?? 0;
      const height = sourceMetadata.height ?? 0;
      if (width < 1 || height < 1 || width * height > MAX_INPUT_PIXELS) {
        throw new PublicMediaError("INVALID_IMAGE", "Source image dimensions are not supported");
      }

      const normalized = await sharp(sourceBuffer, {
        failOn: "warning",
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      return {
        buffer: normalized.data,
        contentType: "image/jpeg",
        width: normalized.info.width,
        height: normalized.info.height,
      };
    } catch (error) {
      if (error instanceof PublicMediaError) throw error;
      throw new PublicMediaError("INVALID_IMAGE", "Source image could not be decoded safely");
    }
  }

  throw new PublicMediaError("TOO_MANY_REDIRECTS", "Source image redirected too many times");
}
