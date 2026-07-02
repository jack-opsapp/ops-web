import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { resolveVerifiedParcelRecord } from "@/lib/decks/zoning/parcel-records";

const lookupBodySchema = z.object({
  site_address: z.string(),
  jurisdiction_id: z.string().optional().nullable(),
  source_app: z.literal("ops_decks"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await readLookupBody(req);
  if (body instanceof NextResponse) return body;

  const siteAddress = body.site_address.trim();
  if (!siteAddress) {
    return NextResponse.json(
      { error: "site_address is required" },
      { status: 400 }
    );
  }

  const jurisdictionId = normalizeOptionalString(body.jurisdiction_id);

  try {
    const db = getServiceRoleClient();
    const resolution = await resolveVerifiedParcelRecord({
      db,
      companyId: auth.companyId,
      siteAddress,
      jurisdictionId,
    });

    if (!resolution) {
      return NextResponse.json(
        { error: "Parcel zoning record not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      request: {
        siteAddress,
        ...(jurisdictionId ? { jurisdictionId } : {}),
      },
      parcelZoning: resolution.parcelZoning,
    });
  } catch (error) {
    console.error("[decks/zoning/parcel] lookup failed", error);
    return NextResponse.json(
      { error: "Zoning lookup unavailable" },
      { status: 503 }
    );
  }
}

async function readLookupBody(
  req: NextRequest
): Promise<z.infer<typeof lookupBodySchema> | NextResponse> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = lookupBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "site_address, jurisdiction_id, and source_app are required" },
      { status: 400 }
    );
  }

  return parsed.data;
}

interface AuthContext {
  companyId: string;
}

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

  let verified: Awaited<ReturnType<typeof verifyAuthToken>>;
  try {
    verified = await verifyAuthToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  try {
    const user = await findUserByAuth(
      verified.uid,
      verified.email,
      "id, company_id"
    );
    const companyId = user?.company_id;

    if (typeof companyId !== "string" || !companyId) {
      return NextResponse.json(
        { error: "User has no company association" },
        { status: 403 }
      );
    }

    return { companyId };
  } catch (error) {
    console.error("[decks/zoning/parcel] auth lookup failed", error);
    return NextResponse.json(
      { error: "Zoning lookup unavailable" },
      { status: 503 }
    );
  }
}

function normalizeOptionalString(
  value: string | null | undefined
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
