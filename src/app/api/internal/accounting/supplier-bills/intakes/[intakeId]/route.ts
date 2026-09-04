import { NextRequest, NextResponse } from "next/server";

import {
  SupplierBillIntakeService,
  supplierBillIntakeHttpStatus,
} from "@/lib/accounting/supplier-bills/intake-service";
import { resolveSupplierBillActor } from "@/lib/accounting/supplier-bills/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ intakeId: string }> }
) {
  const actor = await resolveSupplierBillActor(request, ["accounting.view"]);
  if (actor instanceof NextResponse) return actor;

  const { intakeId } = await params;
  if (!UUID_RE.test(intakeId)) {
    return NextResponse.json({ error: "Bill not found." }, { status: 404 });
  }

  try {
    const detail = await new SupplierBillIntakeService(actor).detail(intakeId);
    if (!detail) {
      return NextResponse.json({ error: "Bill not found." }, { status: 404 });
    }
    const response = NextResponse.json(detail);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Supplier bill unavailable.",
      },
      { status: supplierBillIntakeHttpStatus(error) }
    );
  }
}
