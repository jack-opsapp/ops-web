import { NextResponse } from "next/server";

/** Retired arbitrary-recipient/arbitrary-copy push proxy. */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
