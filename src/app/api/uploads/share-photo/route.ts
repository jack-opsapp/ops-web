/**
 * Authenticated raw-photo endpoint for the iOS share extension.
 *
 * Both the extension's background transfer and the main app's durable queue use
 * the same UUID job ID. The object key and project_photos primary key are
 * derived from that ID, while the database RPC serializes same-job retries and
 * project_images appends in one transaction.
 */

import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import {
  getS3Client,
  S3_BUCKET,
  buildPublicS3Url,
  getStorageBackend,
} from "@/lib/s3/client";
import { authorizeFolder } from "@/lib/s3/path-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveSharePhotoAuth } from "@/lib/uploads/share-photo-auth";
import { canonicalUuid } from "@/lib/uploads/share-photo-contract";
import { canEditSharePhotoProject } from "@/lib/uploads/share-photo-permission";
import { rateLimit } from "@/lib/utils/ratelimit";

export const runtime = "nodejs";

const REQUIRED_IMAGE_TYPE = "image/jpeg";
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = 120;
const NOTIFICATION_BUCKET_MS = 15 * 60 * 1000;
const IDENTITY_CONFLICT_MESSAGE = "jobId is already bound to a different photo";

interface ProjectRow {
  id: string;
  company_id: string;
  title: string;
  deleted_at: string | null;
}

interface ExistingPhotoRow {
  id: string;
  project_id: string;
  company_id: string;
  url: string;
  uploaded_by: string;
  taken_at: string | null;
  deleted_at: string | null;
}

function expectedPublicUrl(key: string): string {
  if (getStorageBackend() === "supabase") {
    return getServiceRoleClient().storage.from("images").getPublicUrl(key).data
      .publicUrl;
  }
  return buildPublicS3Url(key);
}

async function storePhotoBytes(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  if (getStorageBackend() === "supabase") {
    const { error } = await getServiceRoleClient()
      .storage.from("images")
      .upload(key, buffer, { contentType, upsert: true });
    if (error) {
      throw new Error(`Supabase storage upload failed: ${error.message}`);
    }
    return;
  }

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

async function deleteStoredPhotoIfUnclaimed(
  key: string,
  jobId: string
): Promise<void> {
  try {
    const supabase = getServiceRoleClient();
    const { data, error: lookupError } = await supabase
      .from("project_photos")
      .select("id")
      .eq("id", jobId)
      .maybeSingle();
    if (lookupError || data) return;

    if (getStorageBackend() === "supabase") {
      const { error } = await supabase.storage.from("images").remove([key]);
      if (error) throw error;
      return;
    }

    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      })
    );
  } catch (error) {
    console.error("[uploads/share-photo] orphan object cleanup failed:", error);
  }
}

function samePhotoIdentity(
  existing: ExistingPhotoRow,
  expected: {
    projectId: string;
    companyId: string;
    url: string;
    uploadedBy: string;
    takenAt: string;
  }
): boolean {
  const existingTakenAt = existing.taken_at
    ? Date.parse(existing.taken_at)
    : Number.NaN;
  return (
    existing.project_id === expected.projectId &&
    existing.company_id === expected.companyId &&
    existing.url === expected.url &&
    existing.uploaded_by === expected.uploadedBy &&
    existingTakenAt === Date.parse(expected.takenAt)
  );
}

type FilingResult =
  | { errorResponse: NextResponse; attached: false }
  | { errorResponse: null; attached: boolean };

async function filePhoto(input: {
  jobId: string;
  projectId: string;
  companyId: string;
  url: string;
  uploadedBy: string;
  takenAt: string;
}): Promise<FilingResult> {
  const { data, error } = await getServiceRoleClient().rpc(
    "file_share_photo_as_system",
    {
      p_job_id: input.jobId,
      p_project_id: input.projectId,
      p_company_id: input.companyId,
      p_url: input.url,
      p_actor_user_id: input.uploadedBy,
      p_taken_at: input.takenAt,
    }
  );

  if (!error) {
    const result = data?.[0];
    if (!result || typeof result.attached !== "boolean") {
      console.error("[uploads/share-photo] atomic filing returned no outcome");
      return {
        errorResponse: NextResponse.json(
          { error: "Failed to attach photo" },
          { status: 500 }
        ),
        attached: false,
      };
    }
    return { errorResponse: null, attached: result.attached };
  }
  if (
    error.code === "23505" ||
    error.message.includes("share_photo_identity_conflict")
  ) {
    return {
      errorResponse: NextResponse.json(
        { error: IDENTITY_CONFLICT_MESSAGE },
        { status: 409 }
      ),
      attached: false,
    };
  }
  if (
    error.code === "P0002" ||
    error.message.includes("share_photo_project_not_found")
  ) {
    return {
      errorResponse: NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      ),
      attached: false,
    };
  }
  if (
    error.code === "42501" ||
    error.message.includes("share_photo_forbidden")
  ) {
    return {
      errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      attached: false,
    };
  }

  console.error("[uploads/share-photo] atomic filing failed:", error.message);
  return {
    errorResponse: NextResponse.json(
      { error: "Failed to attach photo" },
      { status: 500 }
    ),
    attached: false,
  };
}

async function notifyPhotoAdded(input: {
  userId: string;
  companyId: string;
  projectId: string;
  projectTitle: string;
  takenAt: string;
}): Promise<boolean> {
  try {
    const bucket = Math.floor(
      Date.parse(input.takenAt) / NOTIFICATION_BUCKET_MS
    );
    const { error } = await getServiceRoleClient().rpc(
      "create_notification_if_new_with_status",
      {
        p_user_id: input.userId,
        p_company_id: input.companyId,
        p_type: "photo_uploaded",
        p_title: "Photos added",
        p_body: `${input.projectTitle} has new photos.`,
        p_persistent: false,
        p_action_url: `/dashboard?openProject=${input.projectId}&mode=view`,
        p_action_label: "VIEW PROJECT",
        p_project_id: input.projectId,
        p_deep_link_type: "projectNotes",
        p_dedupe_key: `share-photo:project:${input.projectId}:burst:${bucket}`,
      }
    );
    if (error) {
      console.error(
        "[uploads/share-photo] completion notification failed:",
        error.message
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      "[uploads/share-photo] completion notification failed:",
      error
    );
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await resolveSharePhotoAuth(req);
    if (auth instanceof NextResponse) return auth;

    const limited = await rateLimit({
      key: `share-photo:${auth.uid}`,
      limit: RATE_LIMIT_PER_MINUTE,
      windowSec: 60,
    });
    if (limited.exceeded) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: { "Retry-After": String(limited.retryAfterSec) },
        }
      );
    }

    const projectId = canonicalUuid(req.nextUrl.searchParams.get("projectId"));
    const jobId = canonicalUuid(req.nextUrl.searchParams.get("jobId"));
    if (!projectId) {
      return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
    }
    if (!jobId) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }

    const contentType = (req.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (contentType !== REQUIRED_IMAGE_TYPE) {
      return NextResponse.json(
        { error: `Invalid content type: ${contentType || "(none)"}` },
        { status: 400 }
      );
    }

    const takenAtRaw = req.nextUrl.searchParams.get("takenAt");
    if (!takenAtRaw || Number.isNaN(Date.parse(takenAtRaw))) {
      return NextResponse.json({ error: "Invalid takenAt" }, { status: 400 });
    }
    const takenAt = new Date(takenAtRaw).toISOString();

    const buffer = Buffer.from(await req.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 15MB)" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();
    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select("id, company_id, title, deleted_at")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) {
      console.error(
        "[uploads/share-photo] project lookup failed:",
        projectError.message
      );
      return NextResponse.json(
        { error: "Failed to load project" },
        { status: 500 }
      );
    }
    const project = projectData as ProjectRow | null;
    if (!project || project.deleted_at) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.company_id !== auth.companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const canEdit = await canEditSharePhotoProject(auth.userId, projectId);
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const folderResult = authorizeFolder(
      `projects/${auth.companyId}/${projectId}`,
      auth.companyId
    );
    if (!folderResult.ok) {
      return NextResponse.json({ error: folderResult.reason }, { status: 403 });
    }

    const key = `${folderResult.folder}/share-${jobId}.jpg`;
    const url = expectedPublicUrl(key);
    const identity = {
      projectId,
      companyId: auth.companyId,
      url,
      uploadedBy: auth.userId,
      takenAt,
    };

    const { data: existingData, error: existingError } = await supabase
      .from("project_photos")
      .select(
        "id, project_id, company_id, url, uploaded_by, taken_at, deleted_at"
      )
      .eq("id", jobId)
      .maybeSingle();
    if (existingError) {
      console.error(
        "[uploads/share-photo] idempotency lookup failed:",
        existingError.message
      );
      return NextResponse.json(
        { error: "Failed to validate upload" },
        { status: 500 }
      );
    }

    const existing = existingData as ExistingPhotoRow | null;
    if (existing && !samePhotoIdentity(existing, identity)) {
      return NextResponse.json(
        { error: IDENTITY_CONFLICT_MESSAGE },
        { status: 409 }
      );
    }

    if (!existing) {
      await storePhotoBytes(key, buffer, contentType);
    }

    const filing = await filePhoto({
      jobId,
      projectId,
      companyId: auth.companyId,
      url,
      uploadedBy: auth.userId,
      takenAt,
    });
    if (filing.errorResponse) {
      if (
        !existing &&
        (filing.errorResponse.status === 403 ||
          filing.errorResponse.status === 404)
      ) {
        await deleteStoredPhotoIfUnclaimed(key, jobId);
      }
      return filing.errorResponse;
    }

    if (filing.attached) {
      const notified = await notifyPhotoAdded({
        userId: auth.userId,
        companyId: auth.companyId,
        projectId,
        projectTitle: project.title,
        takenAt,
      });
      if (!notified) {
        return NextResponse.json(
          { error: "Upload completion pending" },
          { status: 503 }
        );
      }
    }

    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error("[uploads/share-photo] Error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
