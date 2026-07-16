import { NextResponse } from "next/server";

/**
 * Retired: lead matching is now frozen into the completed analysis result and
 * revalidated by the durable import approval boundary. Keeping a second
 * caller-supplied verification path would let stale browser data diverge from
 * the evidence that the import worker is authorized to use.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Lead verification moved to import review" },
    { status: 410 }
  );
}
