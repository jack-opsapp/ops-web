import { NextRequest, NextResponse } from "next/server";

import {
  SupplierBillAccountingService,
  supplierBillHttpStatus,
} from "@/lib/accounting/supplier-bills/service";
import { resolveSupplierBillActor } from "@/lib/accounting/supplier-bills/route-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request);
  if (actor instanceof NextResponse) return actor;

  try {
    const service = new SupplierBillAccountingService(actor);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("multipart/form-data")) {
      const form = await request.formData();
      const commandText = form.get("command");
      const document = form.get("document");
      if (typeof commandText !== "string" || !(document instanceof File)) {
        return NextResponse.json(
          { error: "Command and original PDF are required." },
          { status: 400 }
        );
      }
      const draft = JSON.parse(commandText) as Record<string, unknown>;
      const result = await service.prepareCapture({
        draft: draft as never,
        filename: document.name,
        bytes: Buffer.from(await document.arrayBuffer()),
      });
      return NextResponse.json(result);
    }

    const command = (await request.json()) as Record<string, unknown>;
    const result = await service.prepareAction(command);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Supplier bill preparation failed.";
    return NextResponse.json(
      { error: message },
      { status: supplierBillHttpStatus(error) }
    );
  }
}
