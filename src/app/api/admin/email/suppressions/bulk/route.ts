/**
 * POST /api/admin/email/suppressions/bulk
 *
 * Bulk add or remove suppressions. Body: { action, emails[], list?, reason? }.
 * Used by the admin Suppressions tab for multi-select remove + import flows.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { addSuppression, removeSuppression } from "@/lib/email/suppressions";

const Body = z.object({
  action: z.enum(["add", "remove"]),
  emails: z.array(z.string().email()).min(1).max(1000),
  list: z.string().default("global"),
  reason: z
    .enum([
      "hard_bounce",
      "spam_report",
      "unsubscribe",
      "manual",
      "invalid_address",
    ])
    .default("manual"),
});

export const POST = withAdmin(async (req: NextRequest) => {
  const adminUser = await requireAdmin(req);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { action, emails, list, reason } = parsed.data;
  let processed = 0;
  const errors: Array<{ email: string; message: string }> = [];

  for (const email of emails) {
    try {
      if (action === "add") {
        await addSuppression({
          email,
          list,
          reason,
          source: "manual",
          metadata: { addedBy: adminUser.email },
        });
      } else {
        await removeSuppression(email, list);
      }
      processed++;
    } catch (e) {
      errors.push({
        email,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ processed, errors });
});
