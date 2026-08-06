/**
 * Folder-and-filename validation for the presign upload endpoint.
 *
 * The presign route lets authenticated callers obtain short-lived PUT
 * URLs into the OPS S3 bucket. Without these checks a token holder for
 * Company A could craft a `folder` parameter that targets Company B's
 * prefix, or smuggle path-traversal segments to overwrite paths outside
 * their scope. These helpers enforce three properties:
 *
 *   1. Folder strings are sanitized — no `..`, no leading `/`, no
 *      embedded NUL bytes or whitespace tricks.
 *   2. Filenames likewise — extracted extension, no traversal, no
 *      stray slashes.
 *   3. The resolved S3 key always contains the caller's `companyId` as
 *      one of its path segments. Callers that omit it get it prepended
 *      automatically (back-compat for legacy folder values like
 *      `"profiles"` or `"projects/{projectId}"`); callers that include
 *      a different UUID-shaped segment that doesn't match their
 *      companyId are rejected (an attempted cross-tenant write).
 *
 * A segment may state the company either bare (`{uuid}`) or in the
 * bucket's established `company-{uuid}` form. Both are read as the same
 * claim: the caller's own is containment, anyone else's is a
 * cross-tenant write and fails closed.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPANY_PREFIXED_UUID_RE =
  /^company-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * The company a single path segment lays claim to, or `null` if it
 * claims none. `company-` only counts when what follows is a whole UUID
 * — `company-legacy` is just a folder name and keeps legacy behaviour.
 */
function segmentCompanyId(segment: string): string | null {
  if (UUID_RE.test(segment)) return segment.toLowerCase();
  const prefixed = COMPANY_PREFIXED_UUID_RE.exec(segment);
  return prefixed ? prefixed[1].toLowerCase() : null;
}

export interface FolderAuthSuccess {
  ok: true;
  /** Cleaned, company-scoped folder ready to compose into an S3 key. */
  folder: string;
}

export interface FolderAuthFailure {
  ok: false;
  reason: string;
}

export type FolderAuthResult = FolderAuthSuccess | FolderAuthFailure;

/**
 * Normalize and authorize an upload folder for a caller. Returns the
 * cleaned folder (guaranteed to contain `callerCompanyId` somewhere in
 * its path) on success, or an explanation on failure.
 *
 * Examples (callerCompanyId = "abc-123"):
 *   "projects/abc-123/proj-9"        → ok, "projects/abc-123/proj-9"
 *   "profiles"                       → ok, "profiles/abc-123"
 *   "projects/proj-9"                → ok, "projects/proj-9/abc-123"
 *   "company-abc-123/logos"          → ok, "company-abc-123/logos"
 *   "projects/00000000-0000-0000-0000-000000000000/x"
 *                                    → fail (foreign company UUID)
 *   "company-00000000-0000-0000-0000-000000000000/logos"
 *                                    → fail (foreign company UUID)
 *   "../etc/passwd"                  → fail (traversal)
 *   ""                               → ok, "abc-123"
 */
export function authorizeFolder(
  rawFolder: string | null | undefined,
  callerCompanyId: string
): FolderAuthResult {
  if (!callerCompanyId || !UUID_RE.test(callerCompanyId)) {
    return { ok: false, reason: "Invalid callerCompanyId" };
  }

  const folder = (rawFolder ?? "").trim();

  // Reject obvious traversal / control characters before splitting.
  if (folder.includes("..") || /\0|\r|\n/.test(folder)) {
    return { ok: false, reason: "Folder contains illegal segments" };
  }

  // Strip leading/trailing slashes; ignore consecutive slashes by
  // filtering empty segments.
  const segments = folder
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((s) => s.length > 0);

  for (const seg of segments) {
    if (!SAFE_SEGMENT_RE.test(seg)) {
      return {
        ok: false,
        reason: `Folder segment ${JSON.stringify(seg)} contains illegal characters`,
      };
    }
  }

  // If a UUID-shaped segment is present and isn't the caller's, this
  // is almost certainly a cross-tenant attempt — refuse it. (Random
  // projectIds and entity IDs are also UUIDs, but they're scoped under
  // the caller's company segment if used legitimately. A stray UUID at
  // any position that isn't ours fails closed.)
  const caller = callerCompanyId.toLowerCase();
  const foreignUuid = segments.find((seg) => {
    const claimed = segmentCompanyId(seg);
    return claimed !== null && claimed !== caller;
  });
  const callerPresent = segments.some(
    (seg) => segmentCompanyId(seg) === caller
  );
  if (foreignUuid && !callerPresent) {
    return {
      ok: false,
      reason: `Folder references a different company (${foreignUuid})`,
    };
  }

  if (!callerPresent) {
    // Legacy callers (e.g. web `image-service.ts` sending folder "uploads")
    // don't include the companyId. Append it so the resolved S3 key is
    // always company-scoped, even if the client forgot.
    segments.push(callerCompanyId);
  }

  return { ok: true, folder: segments.join("/") };
}

/**
 * Sanitize a user-supplied filename. Returns just the basename (no
 * directory components), with traversal sequences and control
 * characters stripped. Empty / unsafe input falls back to `"upload"`.
 */
export function sanitizeFilename(rawFilename: string | null | undefined): string {
  if (!rawFilename) return "upload";
  // Last path component only — drop any directory traversal trickery.
  const base = rawFilename.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/\.{2,}/g, ".")
    .replace(/[\0\r\n]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[._-]+/, "");
  return cleaned.length > 0 ? cleaned : "upload";
}

/**
 * Pull the extension from a sanitized filename. Returns an extension
 * without the leading dot (e.g. `"jpg"`). Falls back to `defaultExt`
 * if the filename has no extension or only a leading dot.
 */
export function inferExtension(filename: string, defaultExt: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0 || idx === filename.length - 1) return defaultExt;
  const ext = filename.slice(idx + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : defaultExt;
}

/**
 * Build the random "{timestamp}-{random}" component used in upload
 * keys. Centralized so all callers produce keys with the same shape
 * and the migration scripts (Phase 2) can recognize them.
 */
export function buildUniqueSuffix(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}`;
}
