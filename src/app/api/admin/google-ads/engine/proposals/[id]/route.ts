import type { NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { engineAdminHandlers } from "@/lib/ads/engine/admin-runtime";

export const runtime = "nodejs";
// The apply runs synchronously inside a 25-second budget; the route needs the
// headroom for validateOnly plus the real mutate.
export const maxDuration = 60;

export const POST = withAdmin(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin(req);
  const { id } = await context.params;
  return engineAdminHandlers().reviewProposal(req, id, user.email ?? "admin");
});
