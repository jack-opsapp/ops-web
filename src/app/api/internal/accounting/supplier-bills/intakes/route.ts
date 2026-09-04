import { NextRequest, NextResponse } from "next/server";

import {
  SupplierBillIntakeService,
  supplierBillIntakeHttpStatus,
  type SupplierBillIntakeCaptureMetadata,
} from "@/lib/accounting/supplier-bills/intake-service";
import type { SupplierBillIntakeStage } from "@/lib/accounting/supplier-bills/intake-contracts";
import { resolveSupplierBillActor } from "@/lib/accounting/supplier-bills/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STAGES = new Set<SupplierBillIntakeStage>([
  "review",
  "to_pay",
  "paid",
  "held",
  "payroll",
]);

function noStore<T>(body: T, init?: ResponseInit): NextResponse<T> {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
    typeof value === "object" &&
    "name" in value &&
    "type" in value &&
    "arrayBuffer" in value
  );
}

export async function GET(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request, ["accounting.view"]);
  if (actor instanceof NextResponse) return actor;

  const rawStage = new URL(request.url).searchParams.get("stage");
  if (rawStage && !STAGES.has(rawStage as SupplierBillIntakeStage)) {
    return noStore({ error: "Bill stage is invalid." }, { status: 400 });
  }

  try {
    const items = await new SupplierBillIntakeService(actor).list(
      (rawStage as SupplierBillIntakeStage | null) ?? undefined
    );
    return noStore({ items });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Supplier bills unavailable.";
    return noStore(
      { error: message },
      { status: supplierBillIntakeHttpStatus(error) }
    );
  }
}

export async function POST(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request, [
    "accounting.view",
    "accounting.bills.capture",
  ]);
  if (actor instanceof NextResponse) return actor;

  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (contentType && !contentType.includes("multipart/form-data")) {
    return noStore(
      { error: "Metadata and original PDF are required." },
      { status: 415 }
    );
  }

  try {
    const form = await request.formData();
    const metadataText = form.get("metadata");
    const document = form.get("document");
    if (typeof metadataText !== "string" || !isUploadedFile(document)) {
      return noStore(
        { error: "Metadata and original PDF are required." },
        { status: 400 }
      );
    }
    if (document.type !== "application/pdf") {
      return noStore(
        { error: "Supplier bills must be PDF files." },
        { status: 400 }
      );
    }
    const metadata = JSON.parse(
      metadataText
    ) as SupplierBillIntakeCaptureMetadata;
    const result = await new SupplierBillIntakeService(actor).prepareCapture({
      metadata,
      filename: document.name,
      bytes: Buffer.from(await document.arrayBuffer()),
    });
    return noStore(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Supplier bill capture failed.";
    return noStore(
      { error: message },
      { status: supplierBillIntakeHttpStatus(error) }
    );
  }
}
