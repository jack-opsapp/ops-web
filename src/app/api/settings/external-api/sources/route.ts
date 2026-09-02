import { NextRequest, NextResponse } from "next/server";
import { requireExternalApiSettingsActor } from "@/lib/external-api/settings/actor";
import {
  createLeadIntakeSource,
  createSourceInputSchema,
  ExternalApiSettingsServiceError,
  settingsRequestUsesJson,
} from "@/lib/external-api/settings/settings-service";

export async function POST(request: NextRequest) {
  if (!settingsRequestUsesJson(request)) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }
  const authorization = await requireExternalApiSettingsActor(request);
  if (authorization.response) return authorization.response;

  const input = createSourceInputSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!input.success) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }

  try {
    const source = await createLeadIntakeSource(
      authorization.actor,
      input.data
    );
    return NextResponse.json(source, { status: 201 });
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
