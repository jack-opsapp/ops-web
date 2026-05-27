/**
 * POST /api/admin/spec/board/refresh
 *
 * Operator-only manual force-refresh of the public board snapshot. The route
 * layer rejects with 403 before any service-role call when the caller isn't a
 * SPEC operator — the parent `/admin/spec/layout.tsx` gate does NOT carry
 * through to API routes, so we re-check explicitly here.
 *
 * On success: calls `private.refresh_spec_board_snapshot()` via the service
 * role (anon/authenticated do NOT have EXECUTE on the function). Returns the
 * new `refreshed_at` value so the UI can show "UPDATED [N min ago]".
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { isSpecOperator } from "@/lib/admin/spec-permissions";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { revalidateTag } from "next/cache";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const fbUser = await verifyAdminAuth(req);
  if (!fbUser?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const opsUser = await findUserByAuth(fbUser.uid, fbUser.email, "id");
  if (!opsUser || typeof opsUser.id !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ok = await isSpecOperator(opsUser.id);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceRoleClient();

  // Call the public-schema wrapper added by the Stage F.1 migration
  // (`2026-05-26-03-spec-stage-f1-board-refresh-wrapper.sql`). The wrapper
  // delegates to `private.refresh_spec_board_snapshot()`; EXECUTE on the
  // wrapper is granted to `service_role` only, so anon / authenticated
  // cannot fire a refresh — only this server route (after clearing the
  // operator gate above) can.
  const { error: rpcError } = await db.rpc("refresh_spec_board_snapshot");
  if (rpcError) {
    console.error("[spec/board/refresh] RPC failed:", rpcError.message);
    return NextResponse.json(
      { error: "Snapshot refresh failed", detail: rpcError.message },
      { status: 502 },
    );
  }

  // Read back the new refreshed_at value from the snapshot row.
  const { data: snapshot, error: snapshotErr } = await db
    .from("spec_public_board_snapshot")
    .select("refreshed_at")
    .limit(1)
    .maybeSingle();

  if (snapshotErr) {
    console.error("[spec/board/refresh] snapshot read failed:", snapshotErr.message);
    return NextResponse.json(
      { refreshed_at: new Date().toISOString() },
      { status: 200 },
    );
  }

  // Invalidate the cached capacity-panel snapshot tag so the next overview load
  // reflects the new refreshed_at.
  revalidateTag("spec-capacity");

  return NextResponse.json({
    refreshed_at: (snapshot?.refreshed_at as string | undefined) ?? new Date().toISOString(),
  });
}
