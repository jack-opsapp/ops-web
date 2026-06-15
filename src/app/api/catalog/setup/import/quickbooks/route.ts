/**
 * POST /api/catalog/setup/import/quickbooks
 *
 * Read-only QuickBooks → catalog-setup pull lane (spec §8, §11; plan Phase 6).
 *
 *   token → verifyAuthToken → findUserByAuth → has_permission(catalog.run_setup)
 *        → CATALOG_QB_IMPORT gate (Canpro-scoped / flagged — see GATE below)
 *        → accounting_connections (quickbooks, this env) → getValidToken
 *        → QuickBooksPullService.pullItems()   [GET only — qbWriteCalls MUST be 0]
 *        → mapQbItems → qbDraftsToCards → classifyImportedCards(live products)
 *        → { connected, cards (proposed/merge), existingRows, summary }
 *
 * The owner then reviews the staged cards on the canvas and commits via the
 * shared /api/catalog/setup/commit (which stamps external_source/external_id so
 * the NEXT pull re-syncs the same rows instead of duplicating).
 *
 * ── GATE (HARD — surfaced to Jackson) ─────────────────────────────────────────
 * Enabling QuickBooks import BEYOND the Canpro tenant is gated on the plaintext-
 * token remediation (bug 7600a1a2 / branch feat/qb-token-encryption). The token
 * cipher IS in-branch and fail-closed (token-cipher.ts), but broad rollout needs
 * the operational sign-off. This route is therefore DARK BY DEFAULT:
 *   • CATALOG_QB_IMPORT_ENABLED must be "true" (server), else 404 — never reveal.
 *   • CATALOG_QB_IMPORT_COMPANY_ALLOWLIST (optional, comma-separated company ids)
 *     restricts the route to those companies when set (the Canpro scope lever).
 *   • A live QuickBooks connection is required — only Canpro has one today.
 * READ-ONLY ONLY: the pull service issues GET only; a non-zero qbWriteCalls fails
 * the run. Nothing is ever written back to QuickBooks in this lane.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  AccountingTokenService,
  ReconnectRequiredError,
} from "@/lib/api/services/accounting-token-service";
import { QuickBooksPullService } from "@/lib/api/services/quickbooks-pull-service";
import { getQuickBooksProviderEnvironment } from "@/lib/api/services/quickbooks-config";
import { mapQbItems, type InventoryMode } from "@/lib/catalog-setup/import/qb-item-mapper";
import {
  qbDraftsToCards,
  QB_IMPORT_SOURCE,
} from "@/lib/catalog-setup/import/qb-drafts-to-cards";
import { classifyImportedCards } from "@/lib/catalog-setup/import/qb-import-classify";
import type { LiveCatalogRow } from "@/lib/catalog-setup/commit/dedupe-matcher.types";

const PROVIDER = "quickbooks";

const QB_IMPORT_ENABLED = process.env.CATALOG_QB_IMPORT_ENABLED === "true";
const QB_IMPORT_ALLOWLIST = (process.env.CATALOG_QB_IMPORT_COMPANY_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Live PRODUCT columns the dedupe-matcher + classify need (same as the upload lane). */
const LIVE_PRODUCT_COLUMNS =
  "id, name, sku, base_price, unit_cost, is_taxable, kind, type, external_source, external_id";

interface PullBody {
  token: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Dark by default — never reveal the lane exists when the flag is off.
    if (!QB_IMPORT_ENABLED) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const body = (await req.json()) as PullBody;
    const token = body?.token;
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing required field: token" },
        { status: 400 },
      );
    }

    const verified = await verifyAuthToken(token);
    const userRow = await findUserByAuth(verified.uid, verified.email, "id, company_id");
    if (!userRow) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }
    const userId = userRow.id as string;
    const companyId = userRow.company_id as string | null;
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "User has no company" }, { status: 400 });
    }

    // Granular gate — never role names (CLAUDE.md). Running the QB pull is part of
    // running setup, so it shares the wizard's permission bit.
    const allowed = await checkPermissionById(userId, "catalog.run_setup");
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Canpro scope lever — when an allowlist is configured, restrict to it.
    if (QB_IMPORT_ALLOWLIST.length > 0 && !QB_IMPORT_ALLOWLIST.includes(companyId)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();
    const providerEnvironment = getQuickBooksProviderEnvironment();

    // Resolve the connection. Absent / not-connected → an honest connect prompt.
    const { data: connection } = await supabase
      .from("accounting_connections")
      .select("id, is_connected")
      .eq("company_id", companyId)
      .eq("provider", PROVIDER)
      .eq("provider_environment", providerEnvironment)
      .maybeSingle();

    if (!connection || !connection.is_connected) {
      return NextResponse.json({ ok: true, connected: false });
    }

    // Valid (decrypted, refreshed) access token. A stale refresh token → reconnect.
    let accessToken: string;
    let realmId: string | null;
    let tokenEnvironment: string;
    try {
      const tok = await AccountingTokenService.getValidToken(supabase, connection.id as string);
      accessToken = tok.accessToken;
      realmId = tok.realmId;
      tokenEnvironment = tok.providerEnvironment;
    } catch (err) {
      if (err instanceof ReconnectRequiredError) {
        return NextResponse.json({ ok: true, connected: false, reconnect: true });
      }
      throw err;
    }
    if (!realmId) {
      return NextResponse.json({ ok: true, connected: false, reconnect: true });
    }

    // Read-only pull of QB Items (GET only).
    const pull = new QuickBooksPullService(realmId, accessToken, tokenEnvironment);
    const rawItems = await pull.pullItems();
    if (pull.qbWriteCalls !== 0) {
      // Read-only invariant violated — fail the run loudly, never silently write.
      console.error("[catalog/setup/import/quickbooks] qbWriteCalls != 0 — aborting");
      return NextResponse.json({ ok: false, error: "Read-only invariant failed" }, { status: 500 });
    }

    // Inventory mode gates whether on-hand is surfaced on the mapped material.
    const { data: invRow } = await supabase
      .from("company_inventory_settings")
      .select("inventory_mode")
      .eq("company_id", companyId)
      .maybeSingle();
    const inventoryMode: InventoryMode =
      invRow?.inventory_mode === "tracked" ? "tracked" : "off";

    // Map raw Items → catalog drafts → SELL StagingCards (Category folders dropped).
    const { cards: drafts, blockers, needsReview } = mapQbItems(rawItems, { inventoryMode });
    const adapted = qbDraftsToCards(drafts);

    // Live products for the import-time dedupe (same scope/columns as the upload
    // lane's client read — deleted_at null). Classify binds matches by id so the
    // commit UPSERTs instead of erroring on the partial unique indexes.
    const { data: liveProducts } = await supabase
      .from("products")
      .select(LIVE_PRODUCT_COLUMNS)
      .eq("company_id", companyId)
      .is("deleted_at", null);
    const liveRows = (liveProducts ?? []) as unknown as LiveCatalogRow[];

    const { cards, existingRows, matchedCount } = classifyImportedCards(
      adapted,
      liveRows,
      QB_IMPORT_SOURCE,
    );

    return NextResponse.json(
      {
        ok: true,
        connected: true,
        cards,
        existingRows,
        summary: {
          pulled: rawItems.length,
          staged: cards.length,
          matched: matchedCount,
          blockers: blockers.length,
          needsReview: needsReview.length,
        },
        qbWriteCalls: 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[catalog/setup/import/quickbooks] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json({ ok: false, error: "Invalid or expired token" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
