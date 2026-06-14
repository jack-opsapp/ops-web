/**
 * POST /api/catalog/setup/commit
 *
 * Commits the accepted staging-card set from the Catalog Setup Wizard into real
 * catalog rows via the merge-capable, idempotent `catalog_setup_save` RPC.
 *
 *   token → verifyAuthToken → findUserByAuth → has_permission(catalog.run_setup)
 *        → cardsToBuilderInput → buildCatalogSetupPayload
 *        → catalog_setup_save (accessToken client — SECURITY INVOKER)
 *        → stamp completion + rail notification (fire-and-forget)
 *
 * Why the accessToken client (NOT service-role): `catalog_setup_save` is SECURITY
 * INVOKER and guards `p_company_id == private.get_user_company_id()` via
 * `auth.jwt()->>'email'`. A service-role call has no JWT email → it would reject
 * with company_scope_mismatch. The per-request accessToken client carries the
 * operator's verified idToken so the guard passes.
 *
 * Single-family contract: the RPC writes exactly ONE family per call, so stock
 * families are looped — one RPC per family, each with its own idempotency suffix.
 * SELL products commit in a single call.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";
import type { SetupMode } from "@/lib/catalog-setup/commit/payload-builder.types";
import { cardsToBuilderInput } from "@/lib/catalog-setup/commit/card-to-builder-input";
import { buildCatalogSetupPayload } from "@/lib/catalog-setup/commit/payload-builder";
import {
  insertCatalogReadyNotification,
  stampCatalogSetupCompleted,
} from "@/lib/catalog-setup/commit/completion-notification";

interface CommitBody {
  token: string;
  /** Stable wizard-session id → derives a replay-safe idempotency key. */
  sessionId: string;
  cards: StagingCard[];
  /** "create" | "edit"; defaults to "edit" so re-runs merge, not duplicate. */
  mode?: SetupMode;
  /** Re-import dedupe provenance (e.g. "quickbooks"); absent for manual/template. */
  externalSource?: string;
}

interface RpcResult {
  ok?: boolean;
  counts?: Record<string, number>;
  id_map?: Record<string, unknown>;
  blockers?: Array<{ code?: string; message?: string }>;
  warnings?: unknown[];
}

const SCOPE_MISMATCH = "company_scope_mismatch";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as CommitBody;
    const { token, sessionId, cards } = body;

    if (!token || !sessionId || !Array.isArray(cards)) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: token, sessionId, cards" },
        { status: 400 },
      );
    }

    const verified = await verifyAuthToken(token);
    const userRow = await findUserByAuth(
      verified.uid,
      verified.email,
      "id, company_id",
    );
    if (!userRow) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }
    const userId = userRow.id as string;
    const companyId = userRow.company_id as string | null;
    if (!companyId) {
      return NextResponse.json(
        { ok: false, error: "User has no company" },
        { status: 400 },
      );
    }

    // Granular gate — never role names (CLAUDE.md). Write authority is also
    // enforced at the RPC's company-scope guard; this is the app-layer gate.
    const allowed = await checkPermissionById(userId, "catalog.run_setup");
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { products, stockFamilies, typeCards } = cardsToBuilderInput(cards, {
      externalSource: body.externalSource,
    });

    if (products.length === 0 && stockFamilies.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nothing to commit — accept at least one card" },
        { status: 400 },
      );
    }

    const mode: SetupMode = body.mode === "create" ? "create" : "edit";
    const client = getAccessTokenClient(token);

    // Build the call plan: one products call + one call per stock family. Each
    // gets a stable, replay-safe key derived from the session (NOT a per-click
    // uuid), so a retry of the SAME set hits the RPC's idempotency cache.
    const calls: Array<{ key: string; payload: ReturnType<typeof buildCatalogSetupPayload> }> = [];
    if (products.length > 0) {
      calls.push({
        key: `${sessionId}:${mode}:products`,
        payload: buildCatalogSetupPayload({ mode, products }),
      });
    }
    stockFamilies.forEach((family, i) => {
      calls.push({
        key: `${sessionId}:${mode}:family:${i}`,
        payload: buildCatalogSetupPayload({ mode, family }),
      });
    });

    const counts = { products: 0, stock: 0 };
    const blockers: Array<{ code?: string; message?: string }> = [];

    for (const call of calls) {
      const { data, error } = await client.rpc("catalog_setup_save", {
        p_company_id: companyId,
        p_idempotency_key: call.key,
        p_payload: call.payload,
      });

      if (error) {
        // A scope guard failure means the accessToken bridge did not carry the
        // operator's email to Postgres — surface it clearly, never as a 500.
        const isScope = (error.message ?? "").includes(SCOPE_MISMATCH);
        console.error(
          `[api/catalog/setup/commit] catalog_setup_save failed (key=${call.key}) ` +
            `code=${error.code ?? "?"} message=${error.message ?? "?"}`,
        );
        return NextResponse.json(
          {
            ok: false,
            error: isScope ? "Catalog scope check failed" : "Commit failed",
            blockers: [{ code: isScope ? SCOPE_MISMATCH : "rpc_error", message: error.message }],
          },
          { status: 422 },
        );
      }

      const result = (data ?? {}) as RpcResult;
      if (result.blockers?.length) {
        blockers.push(...result.blockers);
        continue;
      }
      counts.products += Number(result.counts?.products ?? 0);
      counts.stock += Number(
        result.counts?.variants ?? result.counts?.stock_units ?? 0,
      );
    }

    if (blockers.length > 0) {
      // Required-field / scope blockers — do NOT stamp completion.
      return NextResponse.json({ ok: false, blockers }, { status: 422 });
    }

    // The RPC may not echo per-key counts; fall back to what we committed so the
    // toast/notification are honest.
    if (counts.products === 0) counts.products = products.length;
    if (counts.stock === 0) counts.stock = stockFamilies.length;

    // Completion side-effects — service-role, fire-and-forget. A failure here
    // must never fail the commit (rows are already written).
    const serviceDb = getServiceRoleClient();
    void stampCatalogSetupCompleted(serviceDb, companyId).then(({ error }) => {
      if (error) console.error("[api/catalog/setup/commit] completion stamp failed:", error);
    });
    void insertCatalogReadyNotification(serviceDb, {
      userId,
      companyId,
      productCount: counts.products,
      stockCount: counts.stock,
    }).then(({ error }) => {
      if (error) console.error("[api/catalog/setup/commit] rail notification failed:", error);
    });

    return NextResponse.json({
      ok: true,
      counts,
      // TYPES (trade / task_types) are committed outside catalog_setup_save —
      // surfaced so the client knows they were not persisted by this call.
      warnings: typeCards.length > 0 ? ["types_commit_deferred"] : [],
    });
  } catch (error) {
    console.error("[api/catalog/setup/commit] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
