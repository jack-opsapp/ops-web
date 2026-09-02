import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type LookupAddress = { address: string; family: number };

export interface PublicMediaDependencies {
  lookup: (hostname: string) => Promise<LookupAddress[]>;
  fetcher: typeof fetch;
}

const defaultDependencies: PublicMediaDependencies = {
  lookup: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
  fetcher: fetch,
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

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;
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
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;

  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

export async function validatePublicMediaUrl(
  rawUrl: string,
  dependencies: Pick<PublicMediaDependencies, "lookup"> = defaultDependencies
): Promise<URL> {
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

export async function downloadPublicImage(
  rawUrl: string,
  dependencyOverrides: Partial<PublicMediaDependencies> = {}
): Promise<{ buffer: Buffer; contentType: "image/jpeg"; width: number; height: number }> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const safeUrl = await validatePublicMediaUrl(currentUrl, dependencies);
    let response: Response;

    try {
      response = await dependencies.fetcher(safeUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
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

    const sourceBuffer = Buffer.from(await response.arrayBuffer());
    if (sourceBuffer.byteLength > MAX_SOURCE_BYTES) {
      throw new PublicMediaError("IMAGE_TOO_LARGE", "Source image exceeds the 12 MB limit");
    }

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
