import { NextRequest, NextResponse } from "next/server";

import {
  SupplierBillIntakeService,
  supplierBillIntakeHttpStatus,
} from "@/lib/accounting/supplier-bills/intake-service";
import { resolveSupplierBillActor } from "@/lib/accounting/supplier-bills/route-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request, ["accounting.view"]);
  if (actor instanceof NextResponse) return actor;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      typeof body.intentId !== "string" ||
      typeof body.confirmationText !== "string"
    ) {
      return NextResponse.json(
        { error: "Intent and exact confirmation are required." },
        { status: 400 }
      );
    }
    const result = await new SupplierBillIntakeService(actor).commit({
      intentId: body.intentId,
      confirmationText: body.confirmationText,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Supplier bill write failed.",
      },
      { status: supplierBillIntakeHttpStatus(error) }
    );
  }
}
