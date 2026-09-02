import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireExternalApiSettingsActor } from "@/lib/external-api/settings/actor";
import {
  ExternalApiSettingsServiceError,
  rotateCredentialInputSchema,
  rotateExternalApiCredential,
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
  const input = rotateCredentialInputSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!input.success) {
    return NextResponse.json({ error: "Invalid rotation" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await rotateExternalApiCredential(
        authorization.actor,
        credentialId,
        input.data
      ),
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
        },
      }
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
