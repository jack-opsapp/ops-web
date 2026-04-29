/**
 * POST /api/admin/email/campaigns/audience-estimate
 *
 * Returns the recipient count for a given audience filter — drives the
 * live count under the Audience selector in the campaign create modal.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { estimateAudience } from "@/lib/email/audiences";
import { z } from "zod";

const Body = z.object({
  filter: z.record(z.string(), z.unknown()).default({}),
});

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const count = await estimateAudience(parsed.data.filter);
  return NextResponse.json({ count });
});
