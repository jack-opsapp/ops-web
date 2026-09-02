import { NextRequest, NextResponse } from "next/server";
import { requireExternalApiSettingsActor } from "@/lib/external-api/settings/actor";
import {
  ExternalApiSettingsServiceError,
  listExternalApiSettings,
} from "@/lib/external-api/settings/settings-service";

export async function GET(request: NextRequest) {
  const authorization = await requireExternalApiSettingsActor(request);
  if (authorization.response) return authorization.response;

  try {
    return NextResponse.json(
      await listExternalApiSettings(authorization.actor),
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
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
