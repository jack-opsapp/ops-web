/**
 * GET  /api/admin/email/campaigns           — list campaigns
 * POST /api/admin/email/campaigns           — create a draft campaign
 */
import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import {
  listCampaigns,
  createCampaign,
  type CampaignStatus,
} from "@/lib/email/campaigns";
import { estimateAudience } from "@/lib/email/audiences";
import { z } from "zod";

const ALL_STATUSES: CampaignStatus[] = [
  "draft",
  "scheduled",
  "in_flight",
  "completed",
  "failed",
  "cancelled",
  "paused",
];

function parseStatus(raw: string | null): CampaignStatus | undefined {
  if (!raw) return undefined;
  return (ALL_STATUSES as string[]).includes(raw)
    ? (raw as CampaignStatus)
    : undefined;
}

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, and dashes")
    .min(1)
    .max(80),
  templateId: z.string().min(1),
  audienceFilter: z.record(z.string(), z.unknown()).default({}),
  audienceTemplateId: z.string().uuid().nullable().optional(),
});

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const sp = req.nextUrl.searchParams;
  const status = parseStatus(sp.get("status"));
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(sp.get("offset") ?? 0), 0);
  const includeVersions = sp.get("include_versions") === "1";
  const result = await listCampaigns({ status, limit, offset, includeVersions });
  return NextResponse.json(result);
});

export const POST = withAdmin(async (req: NextRequest) => {
  const user = await requireAdmin(req);
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const recipientCountEstimate = await estimateAudience(parsed.data.audienceFilter);
  const campaign = await createCampaign({
    ...parsed.data,
    createdByUserId: user.uid,
    recipientCountEstimate,
  });
  return NextResponse.json({ campaign }, { status: 201 });
});
