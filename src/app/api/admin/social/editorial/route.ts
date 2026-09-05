import { requireAdmin } from "@/lib/admin/api-auth";
import { createEditorialReadHandler } from "@/lib/social/editorial/routes";
import { readCloudEditorial } from "@/lib/social/editorial/runtime";
export const GET = createEditorialReadHandler({
  authenticate: requireAdmin,
  read: readCloudEditorial,
});
