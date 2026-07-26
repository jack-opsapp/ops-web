import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { stageInventoryImport } from "@/lib/catalog-setup/inventory/inventory-import-service";
import type { ParsedSheet } from "@/lib/catalog-setup/csv-parse";

interface PreviewBody {
  token?: unknown;
  setupSessionId?: unknown;
  sourceName?: unknown;
  sourceMimeType?: unknown;
  defaultLocation?: unknown;
  sheet?: unknown;
}

const MAX_ROWS = 2_000;
const MAX_BODY_BYTES = 4_000_000;

function validSheet(value: unknown): value is ParsedSheet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sheet = value as Partial<ParsedSheet>;
  return (
    Array.isArray(sheet.headers) &&
    sheet.headers.every((header) => typeof header === "string") &&
    Array.isArray(sheet.rows) &&
    sheet.rows.length <= MAX_ROWS &&
    sheet.rows.every(
      (row) =>
        !!row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.values(row).every((cell) => typeof cell === "string"),
    ) &&
    Array.isArray(sheet.lineNumbers) &&
    sheet.lineNumbers.length === sheet.rows.length
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Inventory list is too large" },
        { status: 413 },
      );
    }
    const body = JSON.parse(raw) as PreviewBody;
    if (
      typeof body.token !== "string" ||
      !body.token ||
      typeof body.sourceName !== "string" ||
      !body.sourceName.trim() ||
      !validSheet(body.sheet)
    ) {
      return NextResponse.json(
        { error: "Missing or invalid inventory list" },
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
    const [canRun, canManageInventory] = await Promise.all([
      checkPermissionById(operatorId, "catalog.run_setup"),
      checkPermissionById(operatorId, "inventory.manage"),
    ]);
    if (!canRun || !canManageInventory) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await stageInventoryImport({
      token: body.token,
      companyId,
      operatorId,
      setupSessionId:
        typeof body.setupSessionId === "string"
          ? body.setupSessionId
          : null,
      sourceName: body.sourceName.trim(),
      sourceMimeType:
        typeof body.sourceMimeType === "string"
          ? body.sourceMimeType
          : null,
      sheet: body.sheet,
      defaultLocation:
        typeof body.defaultLocation === "string" &&
        body.defaultLocation.trim()
          ? body.defaultLocation.trim()
          : "Main Shop",
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/catalog/setup/inventory/preview] Error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
