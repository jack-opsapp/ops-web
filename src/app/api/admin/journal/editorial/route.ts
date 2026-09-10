import { requireAdmin } from "@/lib/admin/api-auth";
import { readJournalEditorial } from "@/lib/journal/editorial/admin";
import { createEditorialReadHandler } from "@/lib/social/editorial/routes";

export const runtime = "nodejs";

export const GET = createEditorialReadHandler({
  authenticate: requireAdmin,
  read: readJournalEditorial,
});
