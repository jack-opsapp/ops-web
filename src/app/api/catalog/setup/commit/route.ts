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

import { createHash } from "crypto";
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
import {
  commitTaskTypes,
  recordCompanyTrade,
} from "@/lib/catalog-setup/commit/task-types-commit";
import {
  collectExternalStampTargets,
  stampExternalIdentity,
} from "@/lib/catalog-setup/commit/external-identity-stamp";

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

/**
 * Short, stable content hash of a commit payload. Folded into the idempotency
 * key so the key is CONTENT-addressed: an exact re-submit of the same set reuses
 * the key (the RPC replays its cached success — no double-commit), but a CHANGED
 * set (the operator fixed a blocker, edited, added, or reordered cards and hit
 * BUILD IT again) gets a fresh key and is reprocessed instead of dead-ending on
 * the RPC's `idempotency_conflict` guard (which rejects a reused key carrying a
 * different payload hash). buildCatalogSetupPayload is deterministic, so equal
 * inputs hash equal.
 */
function payloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

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

    if (
      products.length === 0 &&
      stockFamilies.length === 0 &&
      typeCards.length === 0
    ) {
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
      const payload = buildCatalogSetupPayload({ mode, products });
      calls.push({
        key: `${sessionId}:${mode}:products:${payloadHash(payload)}`,
        payload,
      });
    }
    stockFamilies.forEach((family, i) => {
      const payload = buildCatalogSetupPayload({ mode, family });
      // Slot = the family's stable card id (NOT the array index), so removing or
      // reordering families between attempts can't collide one family's key
      // against another's prior payload; the content hash lets a fixed retry of
      // the same family reprocess instead of dead-ending.
      const slot = family.clientId ?? family.id ?? String(i);
      calls.push({
        key: `${sessionId}:${mode}:family:${slot}:${payloadHash(payload)}`,
        payload,
      });
    });

    const counts = { products: 0, stock: 0 };
    const blockers: Array<{ code?: string; message?: string }> = [];
    // client_id → committed row id, accumulated across calls. Product client ids
    // (= card.id) only appear in the products call's map; merging all is safe and
    // lets the external-identity stamp resolve fresh-create rows (spec §11).
    const idMap: Record<string, unknown> = {};

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
            // Calls commit sequentially and each is its own transaction, so an
            // earlier call may already be live when a later one fails. Disclose
            // it so the UI never claims a flat "nothing saved" over live rows.
            partial: { products: counts.products, stock: counts.stock },
            blockers: [{ code: isScope ? SCOPE_MISMATCH : "rpc_error", message: error.message }],
          },
          { status: 422 },
        );
      }

      const result = (data ?? {}) as RpcResult;
      if (result.id_map) Object.assign(idMap, result.id_map);
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
      // Required-field / scope blockers — do NOT stamp completion. Disclose any
      // calls that already committed so the UI doesn't report flat failure.
      return NextResponse.json(
        { ok: false, partial: { products: counts.products, stock: counts.stock }, blockers },
        { status: 422 },
      );
    }

    // The RPC may not echo per-key counts; fall back to what we committed so the
    // toast/notification are honest.
    if (counts.products === 0) counts.products = products.length;
    if (counts.stock === 0) counts.stock = stockFamilies.length;

    const serviceDb = getServiceRoleClient();
    const warnings: string[] = [];
    let typesCount = 0;

    // ── TYPES (trade + task_types) — committed outside catalog_setup_save ──────
    // task_types via the same accessToken client (RLS company_isolation, any
    // company member); trade provenance via service-role (companies UPDATE is
    // admin-gated under the bridge). A task_types failure with nothing else
    // committed is a hard 422; with SELL/STOCK already written it degrades to a
    // warning — those rows are live and TYPES re-runs idempotently (merge).
    if (typeCards.length > 0) {
      const tt = await commitTaskTypes(client, companyId, typeCards);
      if (tt.error) {
        console.error("[api/catalog/setup/commit] task_types commit failed:", tt.error);
        const hadCatalog = products.length > 0 || stockFamilies.length > 0;
        if (!hadCatalog) {
          return NextResponse.json(
            {
              ok: false,
              blockers: [
                {
                  code: "task_types_error",
                  message:
                    tt.error instanceof Error
                      ? tt.error.message
                      : "Could not save task types",
                },
              ],
            },
            { status: 422 },
          );
        }
        warnings.push("types_commit_failed");
      } else {
        typesCount = tt.inserted;
        if (tt.trade) {
          // Best-effort, non-blocking — the operator may not be permitted to
          // update the company row, and task types are already saved.
          void recordCompanyTrade(serviceDb, companyId, tt.trade).then(({ error }) => {
            if (error)
              console.error(
                "[api/catalog/setup/commit] trade provenance failed:",
                error,
              );
          });
        }
      }
    }

    // Re-import identity stamp — service-role, fire-and-forget. catalog_setup_save
    // ignores external_*; stamp it onto the committed import rows so the NEXT pull
    // re-syncs the same row (matchCards keys external_id first) instead of a
    // duplicate the partial unique index would reject (spec §11). Non-fatal: the
    // rows are already live; a miss only degrades the next pull to sku/name match.
    const stampTargets = collectExternalStampTargets(cards, idMap);
    if (stampTargets.length > 0) {
      void stampExternalIdentity(serviceDb, companyId, stampTargets).then(({ error }) => {
        if (error)
          console.error("[api/catalog/setup/commit] external-id stamp failed:", error);
      });
    }

    // Completion side-effects — service-role, fire-and-forget. A failure here
    // must never fail the commit (rows are already written).
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
      counts: { ...counts, types: typesCount },
      warnings,
    });
  } catch (error) {
    console.error("[api/catalog/setup/commit] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired token" },
        { status: 401 },
      );
    }
    // Generic message only — never echo raw DB/RPC error text to the client.
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
