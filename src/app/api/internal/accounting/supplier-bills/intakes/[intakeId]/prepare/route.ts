import { NextRequest, NextResponse } from "next/server";

import {
  SupplierBillIntakeService,
  supplierBillIntakeHttpStatus,
} from "@/lib/accounting/supplier-bills/intake-service";
import { resolveSupplierBillActor } from "@/lib/accounting/supplier-bills/route-auth";

export const runtime = "nodejs";

const ACTIONS = new Set([
  "save_review",
  "hold",
  "release_hold",
  "approve",
  "route_payroll",
  "schedule_payment",
  "record_payment",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ intakeId: string }> }
) {
  const actor = await resolveSupplierBillActor(request, ["accounting.view"]);
  if (actor instanceof NextResponse) return actor;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!ACTIONS.has(body.kind as string)) {
      return NextResponse.json(
        { error: "Bill action is invalid." },
        { status: 400 }
      );
    }
    const { intakeId } = await params;
    const result = await new SupplierBillIntakeService(actor).prepareAction(
      intakeId,
      body
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Supplier bill action failed.",
      },
      { status: supplierBillIntakeHttpStatus(error) }
    );
  }
}
