import type { NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { engineAdminHandlers } from "@/lib/ads/engine/admin-runtime";

export const runtime = "nodejs";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  return engineAdminHandlers().listTests();
});
