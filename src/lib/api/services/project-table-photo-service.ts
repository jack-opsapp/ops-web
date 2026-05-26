import { requireSupabase } from "@/lib/supabase/helpers";
import {
  ProjectTableMutationError,
  normalizeProjectTableMutationError,
} from "@/lib/api/services/project-table-service";

const PROJECT_PHOTOS_BUCKET = "project-photos";
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export interface ProjectTablePhoto {
  id: string;
  projectId: string;
  companyId: string;
  url: string;
  thumbnailUrl: string | null;
  source: string;
  uploadedBy: string;
  createdAt: string | null;
  deletedAt: string | null;
  isClientVisible: boolean;
}

export interface UploadProjectTablePhotoParams {
  companyId: string;
  projectId: string;
  uploadedBy: string;
  file: File;
  thumbnailUrl?: string | null;
}

export interface UploadProjectTablePhotoResult {
  photo: ProjectTablePhoto;
  objectPath: string;
}

function mapPhoto(row: Record<string, unknown>): ProjectTablePhoto {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    companyId: String(row.company_id),
    url: String(row.url),
    thumbnailUrl: typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
    source: typeof row.source === "string" ? row.source : "other",
    uploadedBy: String(row.uploaded_by),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
    isClientVisible: row.is_client_visible === true,
  };
}

function extensionForFile(file: File): string {
  const mimeExtension = MIME_EXTENSION_MAP[file.type];
  if (mimeExtension) return mimeExtension;

  const fileExtension = file.name.split(".").pop()?.toLowerCase();
  if (fileExtension === "jpeg") return "jpg";
  if (fileExtension && ["jpg", "png", "webp", "heic", "heif"].includes(fileExtension)) {
    return fileExtension;
  }
  return "jpg";
}

function assertAllowedMimeType(file: File): void {
  if (ALLOWED_IMAGE_MIME_TYPES.has(file.type)) return;
  throw new ProjectTableMutationError("Unsupported project photo file type", "22023");
}

export const ProjectTablePhotoService = {
  async fetchProjectPhotos(projectId: string, companyId: string): Promise<ProjectTablePhoto[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("project_photos")
      .select("*")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch project table photos: ${error.message}`);
    return (data ?? []).map((row) => mapPhoto(row as Record<string, unknown>));
  },

  async uploadProjectPhoto(params: UploadProjectTablePhotoParams): Promise<UploadProjectTablePhotoResult> {
    assertAllowedMimeType(params.file);

    const supabase = requireSupabase();
    const extension = extensionForFile(params.file);
    const objectPath = `${params.companyId}/${params.projectId}/${crypto.randomUUID()}.${extension}`;
    const bucket = supabase.storage.from(PROJECT_PHOTOS_BUCKET);

    const { error: uploadError } = await bucket.upload(objectPath, params.file, {
      cacheControl: "3600",
      upsert: false,
    });

    if (uploadError) throw normalizeProjectTableMutationError(uploadError);

    const { data: publicUrlData } = bucket.getPublicUrl(objectPath);
    const publicUrl = publicUrlData.publicUrl;
    const thumbnailUrl = params.thumbnailUrl ?? publicUrl;

    const { data, error } = await supabase
      .from("project_photos")
      .insert({
        company_id: params.companyId,
        project_id: params.projectId,
        url: publicUrl,
        thumbnail_url: thumbnailUrl,
        source: "other",
        uploaded_by: params.uploadedBy,
        is_client_visible: false,
      })
      .select()
      .single();

    if (error) {
      await bucket.remove([objectPath]);
      throw normalizeProjectTableMutationError(error);
    }

    return {
      photo: mapPhoto(data as Record<string, unknown>),
      objectPath,
    };
  },

  async deleteProjectPhoto(photoId: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("project_photos")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", photoId);

    if (error) throw normalizeProjectTableMutationError(error);
  },
};
