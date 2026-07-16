import { NextResponse } from "next/server";

/**
 * Retired: this endpoint accepted body-trusted identity and used service-role
 * writes. Employee setup now calls the server-only notification service with
 * the canonical user row it resolved from the verified token.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
