import { NextRequest, NextResponse } from "next/server";

import {
  SupplierBillAccountingService,
  supplierBillHttpStatus,
} from "@/lib/accounting/supplier-bills/service";
import { resolveSupplierBillActor } from "@/lib/accounting/supplier-bills/route-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request);
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
    const result = await new SupplierBillAccountingService(actor).commit({
      intentId: body.intentId,
      confirmationText: body.confirmationText,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Supplier bill write failed.";
    return NextResponse.json(
      { error: message },
      { status: supplierBillHttpStatus(error) }
    );
  }
}
