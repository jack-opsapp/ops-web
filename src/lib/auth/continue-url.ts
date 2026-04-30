const PROD_ALLOWLIST = new Set<string>([
  "opsapp.co",
  "www.opsapp.co",
  "app.opsapp.co",
  "try.opsapp.co",
  "ops.opsapp.co",
]);
const DEV_HOST_SUFFIXES = [".vercel.app"];

export interface ValidationResult {
  ok: boolean;
  url?: string;
  reason?: "missing" | "malformed" | "non_https" | "host_not_allowed";
}

export function validateContinueUrl(
  raw: string | null | undefined,
  opts: { allowDev?: boolean } = {}
): ValidationResult {
  if (!raw) return { ok: false, reason: "missing" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(opts.allowDev && isLocalhost)) {
    return { ok: false, reason: "non_https" };
  }
  if (PROD_ALLOWLIST.has(parsed.hostname))
    return { ok: true, url: parsed.toString() };
  if (opts.allowDev) {
    if (isLocalhost) return { ok: true, url: parsed.toString() };
    if (DEV_HOST_SUFFIXES.some((s) => parsed.hostname.endsWith(s))) {
      return { ok: true, url: parsed.toString() };
    }
  }
  return { ok: false, reason: "host_not_allowed" };
}

export function isAllowDev(): boolean {
  return process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";
}
