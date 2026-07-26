import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import {
  GuidedSetupVersionConflictError,
  runGuidedSetupTurn,
} from "@/lib/catalog-setup/phase-c/turn-service";
import {
  SetupAgentConfigError,
  SetupAgentOutputError,
} from "@/lib/catalog-setup/agent/setup-agent-service";
import { isGuidedCatalogSourceDocument } from "@/lib/catalog-setup/phase-c/source-document";

interface TurnBody {
  token?: unknown;
  answer?: unknown;
  expectedVersion?: unknown;
}

const MAX_ANSWER_BYTES = 20_000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  try {
    const { sessionId } = await params;
    const body = (await req.json()) as TurnBody;
    if (typeof body.token !== "string" || !body.token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }
    if (
      !Number.isInteger(body.expectedVersion) ||
      Number(body.expectedVersion) < 0
    ) {
      return NextResponse.json(
        { error: "expectedVersion must be a non-negative integer" },
        { status: 400 },
      );
    }
    const answerRecord =
      body.answer &&
      typeof body.answer === "object" &&
      !Array.isArray(body.answer)
        ? (body.answer as Record<string, unknown>)
        : null;
    const isSourceDocument =
      answerRecord?.kind === "catalog_source_document";
    if (isSourceDocument && !isGuidedCatalogSourceDocument(body.answer)) {
      return NextResponse.json(
        { error: "Price sheet is invalid or too large" },
        { status: 400 },
      );
    }
    if (
      !isSourceDocument &&
      JSON.stringify(body.answer ?? null).length > MAX_ANSWER_BYTES
    ) {
      return NextResponse.json(
        { error: "Answer is too large" },
        { status: 400 },
      );
    }

    const verified = await verifyAuthToken(body.token);
    const userRow = await findUserByAuth(
      verified.uid,
      verified.email,
      "id, company_id",
    );
    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const operatorId = userRow.id as string;
    const companyId = userRow.company_id as string | null;
    if (!companyId) {
      return NextResponse.json(
        { error: "User has no company" },
        { status: 400 },
      );
    }

    const [canView, canRun] = await Promise.all([
      checkPermissionById(operatorId, "catalog.view"),
      checkPermissionById(operatorId, "catalog.run_setup"),
    ]);
    if (!canView || !canRun) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await runGuidedSetupTurn({
      token: body.token,
      companyId,
      operatorId,
      sessionId,
      answer: body.answer ?? null,
      expectedVersion: Number(body.expectedVersion),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GuidedSetupVersionConflictError) {
      return NextResponse.json(
        { error: "Setup changed in another window", code: "version_conflict" },
        { status: 409 },
      );
    }
    if (error instanceof SetupAgentConfigError) {
      return NextResponse.json(
        { error: "Guided setup is temporarily unavailable" },
        { status: 503 },
      );
    }
    if (error instanceof SetupAgentOutputError) {
      return NextResponse.json(
        { error: "The setup response could not be verified. Try again." },
        { status: 422 },
      );
    }
    console.error("[api/catalog/setup/sessions/turn] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
