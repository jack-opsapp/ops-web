/**
 * POST /api/uploads/delete
 *
 * Deletes a single object the caller owns from OPS storage. This replaces
 * the iOS app's legacy *direct* S3 delete (which shipped long-lived AWS
 * credentials inside the binary). The app now sends the stored object URL
 * here and the server performs the delete with its own credentials, so the
 * client holds no AWS keys.
 *
 * Request (mirrors the presign route's two iOS/web body shapes):
 *   - application/x-www-form-urlencoded: `url=<publicUrl>`  (iOS)
 *   - application/json:                  `{ "url": "<publicUrl>" }` (web)
 *   A bare object key may be sent instead of a URL via the same field.
 *
 * Security (mirrors `/api/uploads/presign`):
 *   - `Authorization: Bearer <token>` required (Supabase iOS or Firebase web).
 *   - The object key is resolved into one supported namespace. Authorization
 *     is resource-specific: expense ownership + expense permissions, profile
 *     row ownership/admin, canonical lead edit authorization, or project edit
 *     authorization. A company id appearing in the path is never sufficient.
 *     New deterministic receipt keys carry the canonical OPS user id and can
 *     therefore be cleaned up safely even before an expense row exists.
 *   - Only the OPS S3 bucket and the Supabase buckets used by these namespaces
 *     are accepted as URL sources. Every unknown namespace fails closed.
 *   - Per-uid sliding-window rate limit (30 deletes / minute).
 *
 * Backend is chosen by the URL itself (an S3 URL → S3 delete, a Supabase
 * Storage URL → Supabase delete) so that objects created under either
 * storage backend — including legacy pre-migration images — are cleaned up
 * correctly regardless of the current STORAGE_BACKEND setting.
 *
 * NOTE (IAM): the dedicated upload IAM user backing `getS3Client()` must be
 * granted `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*` for the S3 path to
 * succeed. Callers treat delete as best-effort, so a missing permission
 * degrades to "old object orphaned" rather than a user-facing failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  checkPermissionById,
  resolvePermissionScopeById,
} from "@/lib/supabase/check-permission";
import { getS3Client, S3_BUCKET, S3_REGION } from "@/lib/s3/client";
import { rateLimit } from "@/lib/utils/ratelimit";

const RATE_LIMIT_PER_MINUTE = 30;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DETERMINISTIC_RECEIPT_FILE_RE = new RegExp(
  `^${UUID_SOURCE}-(?:full|thumbnail)\\.jpg$`,
  "i"
);
const LEGACY_RECEIPT_ID_RE = new RegExp(
  `(?:^|_)receipt_(${UUID_SOURCE})(?:_|\\.)`,
  "i"
);
const SUPABASE_DELETE_BUCKETS = new Set([
  "images",
  "profile-images",
  "project-photos",
]);

interface AuthContext {
  uid: string;
  userId: string;
  companyId: string;
  isCompanyAdmin: boolean;
}

/**
 * Resolve the caller's auth token into a uid + their company_id. Identical
 * to the presign route's bridge (Supabase JWT for iOS, Firebase JWT for web).
 */
async function resolveAuth(
  req: NextRequest
): Promise<AuthContext | NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return NextResponse.json(
      { error: "Missing Authorization bearer token" },
      { status: 401 }
    );
  }

  let uid: string;
  try {
    const verified = await verifyAuthToken(idToken);
    uid = verified.uid;
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, company_id, is_active, deleted_at, is_company_admin")
    .or(`auth_id.eq.${uid},firebase_uid.eq.${uid}`)
    .maybeSingle();

  if (
    userErr ||
    !userRow ||
    !userRow.company_id ||
    userRow.deleted_at !== null ||
    userRow.is_active !== true
  ) {
    return NextResponse.json(
      { error: "User has no company association" },
      { status: 403 }
    );
  }

  return {
    uid,
    userId: userRow.id as string,
    companyId: userRow.company_id as string,
    isCompanyAdmin: userRow.is_company_admin === true,
  };
}

type DeleteTarget =
  | { kind: "s3"; key: string }
  | { kind: "supabase"; bucket: string; key: string };

interface AuthorizationIdentity {
  /** Original backend key that will actually be deleted. */
  deleteKey: string;
  /** Original Supabase bucket, or a migrated object's former bucket. */
  sourceBucket: string | null;
  /** Logical key with the migrated-Supabase wrapper removed. */
  key: string;
  segments: string[];
}

/**
 * Resolve the request value into a concrete delete target. Only the OPS S3
 * bucket (virtual-hosted or path style) and the known Supabase image buckets
 * are accepted; everything else returns null so an authenticated caller cannot
 * use this route to delete arbitrary objects. A bare key (no scheme) is
 * treated as an S3 key (the default/forward backend).
 */
function resolveTarget(input: string): DeleteTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (!/^https?:\/\//i.test(trimmed)) {
    return { kind: "s3", key: trimmed.replace(/^\/+/, "") };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");

  // S3 virtual-hosted-style: {bucket}.s3[.region].amazonaws.com/{key}
  if (
    host === `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com` ||
    host === `${S3_BUCKET}.s3.amazonaws.com`
  ) {
    return path ? { kind: "s3", key: path } : null;
  }

  // S3 path-style: s3[.region].amazonaws.com/{bucket}/{key}
  if (host === `s3.${S3_REGION}.amazonaws.com` || host === "s3.amazonaws.com") {
    const segs = path.split("/");
    if (segs.shift() === S3_BUCKET && segs.length > 0) {
      return { kind: "s3", key: segs.join("/") };
    }
    return null;
  }

  // Supabase Storage public/signed URL for a supported image bucket:
  //   https://<ref>.supabase.co/storage/v1/object/(public|sign)/{bucket}/{key}
  if (host.endsWith(".supabase.co")) {
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/
    );
    if (match && SUPABASE_DELETE_BUCKETS.has(match[1])) {
      return {
        kind: "supabase",
        bucket: match[1],
        key: decodeURIComponent(match[2]),
      };
    }
  }

  return null;
}

function authorizationIdentity(
  target: DeleteTarget
): AuthorizationIdentity | null {
  const deleteKey = target.key;
  const segments = target.key.split("/").filter(Boolean);
  if (
    target.kind === "s3" &&
    segments[0]?.toLowerCase() === "migrated" &&
    segments[1]?.toLowerCase() === "supabase-storage" &&
    segments.length >= 4
  ) {
    const sourceBucket = segments[2].toLowerCase();
    if (!SUPABASE_DELETE_BUCKETS.has(sourceBucket)) return null;
    return {
      deleteKey,
      sourceBucket,
      key: segments.slice(3).join("/"),
      segments: segments.slice(3),
    };
  }
  return {
    deleteKey,
    sourceBucket: target.kind === "supabase" ? target.bucket : null,
    key: target.key,
    segments,
  };
}

function isDeterministicExpenseShape(segments: string[]): boolean {
  return (
    segments[0]?.toLowerCase() === "expenses" &&
    UUID_RE.test(segments[1] ?? "") &&
    UUID_RE.test(segments[2] ?? "")
  );
}

function isOwnedDeterministicExpense(
  segments: string[],
  auth: AuthContext
): boolean {
  if (
    segments.length !== 5 ||
    !isDeterministicExpenseShape(segments) ||
    !UUID_RE.test(segments[3] ?? "") ||
    !DETERMINISTIC_RECEIPT_FILE_RE.test(segments[4] ?? "")
  ) {
    return false;
  }
  return (
    segments[1].toLowerCase() === auth.companyId.toLowerCase() &&
    segments[2].toLowerCase() === auth.userId.toLowerCase()
  );
}

function referenceCandidates(rawUrl: string, target: DeleteTarget): string[] {
  const candidates = new Set<string>([rawUrl.trim()]);
  if (target.kind === "s3") {
    candidates.add(
      `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${target.key}`
    );
    candidates.add(`https://${S3_BUCKET}.s3.amazonaws.com/${target.key}`);
  } else if (/^https?:\/\//i.test(rawUrl)) {
    try {
      const parsed = new URL(rawUrl);
      parsed.search = "";
      parsed.hash = "";
      candidates.add(parsed.toString());
      candidates.add(
        `${parsed.origin}/storage/v1/object/public/${target.bucket}/${target.key}`
      );
    } catch {
      // resolveTarget already validated the URL. Keep the exact value only.
    }
  }
  return [...candidates];
}

async function findOneByReference(
  table: string,
  select: string,
  companyColumn: string,
  companyId: string,
  columns: string[],
  references: string[]
): Promise<Record<string, unknown> | null> {
  const supabase = getServiceRoleClient();
  for (const column of columns) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq(companyColumn, companyId)
      .in(column, references)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(
        `Upload delete authorization lookup failed for ${table}.${column}: ${error.message}`
      );
    }
    if (data) return data as unknown as Record<string, unknown>;
  }
  return null;
}

function legacyExpenseId(segments: string[]): string | null {
  const filename = segments.at(-1) ?? "";
  return filename.match(LEGACY_RECEIPT_ID_RE)?.[1] ?? null;
}

async function authorizeExpense(
  identity: AuthorizationIdentity,
  rawUrl: string,
  target: DeleteTarget,
  auth: AuthContext
): Promise<boolean> {
  const lower = identity.segments.map((segment) => segment.toLowerCase());
  const isExpenseNamespace =
    lower[0] === "expenses" ||
    (lower[0]?.startsWith("company-") && lower[1] === "expenses");
  if (!isExpenseNamespace) return false;

  const company = await getCompanyAuthorizationRow(auth);
  const pathCompany =
    lower[0] === "expenses" ? identity.segments[1] : identity.segments[0];
  if (!company || !companyIdentifierMatches(pathCompany, auth, company)) {
    return false;
  }

  if (isDeterministicExpenseShape(identity.segments)) {
    // Never let malformed/future deterministic keys fall through to legacy
    // row checks. Their embedded user segment is the ownership contract.
    return isOwnedDeterministicExpense(identity.segments, auth);
  }

  const expenseId = legacyExpenseId(identity.segments);
  let expense: Record<string, unknown> | null = null;
  if (expenseId) {
    const { data, error } = await getServiceRoleClient()
      .from("expenses")
      .select("id, company_id, submitted_by")
      .eq("id", expenseId)
      .eq("company_id", auth.companyId)
      .limit(1)
      .maybeSingle();
    if (error)
      throw new Error(`Expense authorization lookup failed: ${error.message}`);
    expense = data as Record<string, unknown> | null;
  }

  if (!expense) {
    expense = await findOneByReference(
      "expenses",
      "id, company_id, submitted_by",
      "company_id",
      auth.companyId,
      ["receipt_image_url", "receipt_thumbnail_url"],
      referenceCandidates(rawUrl, target)
    );
  }
  if (!expense) return false;

  const [editScope, canApprove] = await Promise.all([
    resolvePermissionScopeById(auth.userId, "expenses.edit"),
    checkPermissionById(auth.userId, "expenses.approve", "all"),
  ]);
  return (
    editScope === "all" ||
    canApprove ||
    (editScope === "own" && expense.submitted_by === auth.userId)
  );
}

interface CompanyAuthorizationRow extends Record<string, unknown> {
  id: string;
  bubble_id: string | null;
  account_holder_id: string | null;
  admin_ids: string[] | null;
  logo_url: string | null;
}

async function getCompanyAuthorizationRow(
  auth: AuthContext
): Promise<CompanyAuthorizationRow | null> {
  const { data, error } = await getServiceRoleClient()
    .from("companies")
    .select("id, bubble_id, account_holder_id, admin_ids, logo_url")
    .eq("id", auth.companyId)
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`Company authorization lookup failed: ${error.message}`);
  return data as CompanyAuthorizationRow | null;
}

function isCompanyAdmin(
  auth: AuthContext,
  company: CompanyAuthorizationRow | null
): boolean {
  return (
    auth.isCompanyAdmin ||
    company?.account_holder_id === auth.userId ||
    company?.admin_ids?.includes(auth.userId) === true
  );
}

async function authorizeProfile(
  rawUrl: string,
  target: DeleteTarget,
  auth: AuthContext
): Promise<boolean> {
  const profile = await findOneByReference(
    "users",
    "id, company_id, profile_image_url",
    "company_id",
    auth.companyId,
    ["profile_image_url"],
    referenceCandidates(rawUrl, target)
  );
  if (!profile) return false;
  if (profile.id === auth.userId) return true;
  return isCompanyAdmin(auth, await getCompanyAuthorizationRow(auth));
}

function companyIdentifierMatches(
  identifier: string | undefined,
  auth: AuthContext,
  company: CompanyAuthorizationRow
): boolean {
  if (!identifier) return false;
  const normalized = identifier.replace(/^company-/i, "").toLowerCase();
  return (
    normalized === auth.companyId.toLowerCase() ||
    normalized === company.bubble_id?.toLowerCase()
  );
}

async function authorizeLogo(
  identity: AuthorizationIdentity,
  rawUrl: string,
  target: DeleteTarget,
  auth: AuthContext
): Promise<boolean> {
  const company = await getCompanyAuthorizationRow(auth);
  if (!company || !isCompanyAdmin(auth, company)) return false;

  const lower = identity.segments.map((segment) => segment.toLowerCase());
  const pathCompany =
    lower[0] === "logos"
      ? identity.segments[1]
      : lower[1] === "logos"
        ? identity.segments[0]
        : undefined;
  const references = referenceCandidates(rawUrl, target);
  return (
    (company.logo_url !== null && references.includes(company.logo_url)) ||
    companyIdentifierMatches(pathCompany, auth, company)
  );
}

function opportunityIdFromKey(
  identity: AuthorizationIdentity,
  auth: AuthContext
): string | null {
  const lower = identity.segments.map((segment) => segment.toLowerCase());
  if (
    lower[0] === "opportunities" &&
    lower[1] === auth.companyId.toLowerCase() &&
    UUID_RE.test(identity.segments[2] ?? "")
  ) {
    return identity.segments[2];
  }
  if (
    lower[0] === "email-imports" &&
    UUID_RE.test(identity.segments[1] ?? "")
  ) {
    return identity.segments[1];
  }
  return null;
}

async function authorizeOpportunity(
  identity: AuthorizationIdentity,
  auth: AuthContext
): Promise<boolean> {
  const opportunityId = opportunityIdFromKey(identity, auth);
  if (!opportunityId) return false;
  const { data, error } = await getServiceRoleClient().rpc(
    "authorize_opportunity_action_as_system",
    {
      p_actor_user_id: auth.userId,
      p_opportunity_id: opportunityId,
      p_action: "edit",
    }
  );
  if (error) {
    console.error(
      "[uploads/delete] Opportunity authorization failed:",
      error.message
    );
    return false;
  }
  return data === true;
}

function projectReferenceFromKey(
  identity: AuthorizationIdentity,
  auth: AuthContext
): string | null {
  const lower = identity.segments.map((segment) => segment.toLowerCase());
  const companyId = auth.companyId.toLowerCase();

  if (lower[0] === "projects") {
    if (lower[1] === companyId && identity.segments[2])
      return identity.segments[2];
    if (lower[2] === companyId && identity.segments[1])
      return identity.segments[1];
  }
  if (
    lower[0]?.startsWith("company-") &&
    lower[2] === "photos" &&
    identity.segments[1]
  ) {
    return identity.segments[1];
  }
  if (
    identity.sourceBucket === "project-photos" &&
    lower[0] === companyId &&
    identity.segments[1]
  ) {
    return identity.segments[1];
  }
  if (lower[0] === "measurements" && lower[1] === companyId) {
    return identity.segments[2] ?? null;
  }
  return null;
}

async function findProject(
  reference: string,
  auth: AuthContext
): Promise<Record<string, unknown> | null> {
  let query = getServiceRoleClient()
    .from("projects")
    .select("id, bubble_id, company_id, deleted_at")
    .eq("company_id", auth.companyId)
    .is("deleted_at", null);
  query = UUID_RE.test(reference)
    ? query.eq("id", reference)
    : query.eq("bubble_id", reference);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error)
    throw new Error(`Project authorization lookup failed: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function projectFromPhotoReference(
  rawUrl: string,
  target: DeleteTarget,
  auth: AuthContext
): Promise<Record<string, unknown> | null> {
  const photo = await findOneByReference(
    "project_photos",
    "project_id, company_id, url, thumbnail_url, rendered_url",
    "company_id",
    auth.companyId,
    ["url", "thumbnail_url", "rendered_url"],
    referenceCandidates(rawUrl, target)
  );
  const projectId =
    typeof photo?.project_id === "string" ? photo.project_id : null;
  return projectId ? findProject(projectId, auth) : null;
}

async function authorizeProject(
  identity: AuthorizationIdentity,
  rawUrl: string,
  target: DeleteTarget,
  auth: AuthContext
): Promise<boolean> {
  const lower = identity.segments.map((segment) => segment.toLowerCase());
  if (lower[0]?.startsWith("company-") && lower[2] === "photos") {
    const company = await getCompanyAuthorizationRow(auth);
    if (
      !company ||
      !companyIdentifierMatches(identity.segments[0], auth, company)
    ) {
      return false;
    }
  }

  const reference = projectReferenceFromKey(identity, auth);
  let project = reference ? await findProject(reference, auth) : null;
  if (!project) {
    // Several migrated `project-photos` paths use a non-project segment such
    // as `demo`; the soft-deleted project_photos row remains authoritative.
    project = await projectFromPhotoReference(rawUrl, target, auth);
  }
  if (!project || typeof project.id !== "string") return false;

  const scope = await resolvePermissionScopeById(auth.userId, "projects.edit");
  if (scope === "all") return true;
  if (scope !== "assigned") return false;

  const { data, error } = await getServiceRoleClient()
    .from("project_tasks")
    .select("id")
    .eq("project_id", project.id)
    .is("deleted_at", null)
    .contains("team_member_ids", [auth.userId])
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`Project assignment lookup failed: ${error.message}`);
  return data !== null;
}

function isProfileNamespace(identity: AuthorizationIdentity): boolean {
  const lower = identity.segments.map((segment) => segment.toLowerCase());
  return (
    identity.sourceBucket === "profile-images" ||
    lower[0] === "profiles" ||
    lower[1] === "profiles" ||
    lower[0] === "profile-images" ||
    // Historical Supabase images migrated into S3 under `uploads/`.
    (identity.sourceBucket === "images" && lower[0] === "uploads")
  );
}

function isLogoNamespace(identity: AuthorizationIdentity): boolean {
  const lower = identity.segments.map((segment) => segment.toLowerCase());
  return lower[0] === "logos" || lower[1] === "logos";
}

function isProjectNamespace(identity: AuthorizationIdentity): boolean {
  const lower = identity.segments.map((segment) => segment.toLowerCase());
  return (
    identity.sourceBucket === "project-photos" ||
    lower[0] === "projects" ||
    (lower[0]?.startsWith("company-") && lower[2] === "photos") ||
    ["project-photos", "measurements", "deck_designs"].includes(
      lower[0] ?? ""
    ) ||
    // Some gallery rows predate the typed namespace and live under uploads.
    lower[0] === "uploads"
  );
}

/**
 * Resolve authorization from the namespace's actual Supabase row/permission
 * contract. Unknown and ambiguous unreferenced legacy keys fail closed.
 */
async function isDeleteAuthorized(
  target: DeleteTarget,
  rawUrl: string,
  auth: AuthContext
): Promise<boolean> {
  const identity = authorizationIdentity(target);
  if (!identity) return false;

  if (
    identity.segments[0]?.toLowerCase() === "expenses" ||
    identity.segments[1]?.toLowerCase() === "expenses"
  ) {
    return authorizeExpense(identity, rawUrl, target, auth);
  }

  if (opportunityIdFromKey(identity, auth)) {
    return authorizeOpportunity(identity, auth);
  }

  if (isLogoNamespace(identity)) {
    return authorizeLogo(identity, rawUrl, target, auth);
  }

  if (isProfileNamespace(identity)) {
    const allowed = await authorizeProfile(rawUrl, target, auth);
    if (allowed) return true;
    // `uploads/` is shared with a small set of historical project gallery rows.
    if (identity.segments[0]?.toLowerCase() !== "uploads") return false;
  }

  if (isProjectNamespace(identity)) {
    return authorizeProject(identity, rawUrl, target, auth);
  }

  return false;
}

async function readUrl(req: NextRequest): Promise<string | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await req.json()) as Record<string, unknown>;
    if (typeof json.url === "string") return json.url;
    if (typeof json.key === "string") return json.key;
    return null;
  }
  const text = await req.text();
  const params = new URLSearchParams(text);
  return params.get("url") ?? params.get("key");
}

export async function POST(req: NextRequest) {
  try {
    const rawUrl = await readUrl(req);
    if (!rawUrl) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const auth = await resolveAuth(req);
    if (auth instanceof NextResponse) return auth;

    const limit = await rateLimit({
      key: `delete:${auth.uid}`,
      limit: RATE_LIMIT_PER_MINUTE,
      windowSec: 60,
    });
    if (limit.exceeded) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const target = resolveTarget(rawUrl);
    if (!target) {
      return NextResponse.json(
        { error: "Unrecognized object URL" },
        { status: 400 }
      );
    }
    if (target.key.includes("..") || target.key.length === 0) {
      return NextResponse.json(
        { error: "Invalid object key" },
        { status: 400 }
      );
    }
    if (!(await isDeleteAuthorized(target, rawUrl, auth))) {
      return NextResponse.json(
        { error: "Object is not owned by this user" },
        { status: 403 }
      );
    }

    if (target.kind === "supabase") {
      const supabase = getServiceRoleClient();
      const { error } = await supabase.storage
        .from(target.bucket)
        .remove([target.key]);
      if (error) {
        console.error(
          "[uploads/delete] Supabase remove failed:",
          error.message
        );
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: target.key })
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[uploads/delete] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
