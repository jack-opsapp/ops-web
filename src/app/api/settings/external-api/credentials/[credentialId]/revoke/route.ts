import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireExternalApiSettingsActor } from "@/lib/external-api/settings/actor";
import {
  ExternalApiSettingsServiceError,
  revokeCredentialInputSchema,
  revokeExternalApiCredential,
  settingsRequestUsesJson,
} from "@/lib/external-api/settings/settings-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ credentialId: string }> }
) {
  if (!settingsRequestUsesJson(request)) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }
  const authorization = await requireExternalApiSettingsActor(request);
  if (authorization.response) return authorization.response;

  const { credentialId } = await params;
  if (!z.string().uuid().safeParse(credentialId).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const input = revokeCredentialInputSchema.safeParse(
    await request.json().catch(() => ({}))
  );
  if (!input.success) {
    return NextResponse.json({ error: "Invalid revocation" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await revokeExternalApiCredential(
        authorization.actor,
        credentialId,
        input.data
      )
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
