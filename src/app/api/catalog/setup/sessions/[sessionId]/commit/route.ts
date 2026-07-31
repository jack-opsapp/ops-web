import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  insertCatalogReadyNotification,
  stampCatalogSetupCompleted,
} from "@/lib/catalog-setup/commit/completion-notification";
import { executeGuidedCatalogCommit } from "@/lib/catalog-setup/phase-c/commit-service";
import { createSupabaseCatalogGuidedCommitAdapter } from "@/lib/catalog-setup/phase-c/supabase-commit-adapter";

interface CommitBody {
  token?: unknown;
  approvalHash?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  try {
    const { sessionId } = await params;
    const body = (await req.json()) as CommitBody;
    if (
      typeof body.token !== "string" ||
      !body.token ||
      typeof body.approvalHash !== "string" ||
      !body.approvalHash
    ) {
      return NextResponse.json(
        { error: "Missing token or approvalHash" },
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

    const result = await executeGuidedCatalogCommit({
      sessionId,
      approvalHash: body.approvalHash,
      adapter: createSupabaseCatalogGuidedCommitAdapter({
        token: body.token,
        companyId,
        operatorId,
      }),
    });

    if (result.ok && !result.replayed) {
      const serviceDb = getServiceRoleClient();
      const productCount = Number(result.readback.products ?? 0);
      void stampCatalogSetupCompleted(serviceDb, companyId).then(
        ({ error }) => {
          if (error) {
            console.error(
              "[api/catalog/setup/sessions/commit] completion stamp failed:",
              error,
            );
          }
        },
      );
      void insertCatalogReadyNotification(serviceDb, {
        userId: operatorId,
        companyId,
        productCount,
        stockCount: 0,
      }).then(({ error }) => {
        if (error) {
          console.error(
            "[api/catalog/setup/sessions/commit] notification failed:",
            error,
          );
        }
      });
    }

    return NextResponse.json(result, {
      status: result.ok ? 200 : 422,
    });
  } catch (error) {
    console.error("[api/catalog/setup/sessions/commit] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }
    if (
      error instanceof Error &&
      (error.message.includes("Approval hash") ||
        error.message.includes("not ready") ||
        error.message.includes("blockers"))
    ) {
      return NextResponse.json(
        { error: "The reviewed setup has changed. Review it again." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
