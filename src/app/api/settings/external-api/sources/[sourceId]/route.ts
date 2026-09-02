import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireExternalApiSettingsActor } from "@/lib/external-api/settings/actor";
import {
  ExternalApiSettingsServiceError,
  settingsRequestUsesJson,
  updateLeadIntakeSource,
  updateSourceInputSchema,
} from "@/lib/external-api/settings/settings-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  if (!settingsRequestUsesJson(request)) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }
  const authorization = await requireExternalApiSettingsActor(request);
  if (authorization.response) return authorization.response;

  const { sourceId } = await params;
  if (!z.string().uuid().safeParse(sourceId).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const input = updateSourceInputSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!input.success) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await updateLeadIntakeSource(authorization.actor, sourceId, input.data)
    );
  } catch (error) {
    if (error instanceof ExternalApiSettingsServiceError) {
      return NextResponse.json(
        { error: error.safeMessage },
        { status: error.responseStatus }
      );
    }
    return NextResponse.json(
      { error: "Settings unavailable" },
      { status: 500 }
    );
  }
}
