/**
 * POST /api/catalog/setup/agent
 *
 * The always-on, suggest-only Setup Agent (Phase 4). Turns the owner's plain
 * description of their business into accept/edit/reject staging cards — it never
 * writes; the owner approves every row and the commit still goes through
 * /api/catalog/setup/commit.
 *
 *   token → verify → findUserByAuth → has_permission(catalog.run_setup)
 *        → build ValidationContext from the live catalog (units/variants/trades)
 *        → generateCatalogProposals (OpenAI, JSON mode)
 *        → validateBatch (structural Zod gate + commit-safety guardrails)
 *        → { cards, rejected }
 *
 * Ungated for every company (suggest-only — spec §12); the deeper autonomous
 * layer stays phase_c-gated and is NOT this route. A missing OPENAI_API_KEY
 * returns 503 so the client falls back to the deterministic guided path with
 * zero data loss (already-accepted cards are untouched).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { WIZARD_TRADE_IDS } from "@/lib/catalog-setup/trade-list";
import {
  generateCatalogProposals,
  SetupAgentConfigError,
} from "@/lib/catalog-setup/agent/setup-agent-service";
import {
  validateBatch,
  type ValidationContext,
} from "@/lib/catalog-setup/agent/proposal-validator";

interface AgentBody {
  token: string;
  description: string;
  priorTurns?: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as AgentBody;
    const { token, description } = body;
    if (!token || typeof description !== "string" || !description.trim()) {
      return NextResponse.json(
        { error: "Missing required fields: token, description" },
        { status: 400 },
      );
    }

    const verified = await verifyAuthToken(token);
    const userRow = await findUserByAuth(verified.uid, verified.email, "id, company_id");
    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userId = userRow.id as string;
    const companyId = userRow.company_id as string | null;
    if (!companyId) {
      return NextResponse.json({ error: "User has no company" }, { status: 400 });
    }

    const allowed = await checkPermissionById(userId, "catalog.run_setup");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Build the validator's resolvable-reference sets from the live catalog so a
    // proposal that pins an unknown unit/variant is dropped, never committed.
    const db = getServiceRoleClient();
    const [units, variants] = await Promise.all([
      db.from("catalog_units").select("id").eq("company_id", companyId),
      db.from("catalog_variants").select("id").eq("company_id", companyId),
    ]);
    const ctx: ValidationContext = {
      knownUnitIds: new Set((units.data ?? []).map((r) => r.id as string)),
      knownVariantIds: new Set((variants.data ?? []).map((r) => r.id as string)),
      allowedTrades: new Set<string>(WIZARD_TRADE_IDS),
    };

    const batch = await generateCatalogProposals({
      description,
      priorTurns: body.priorTurns,
    });
    const { cards, rejected } = validateBatch(batch, ctx);

    return NextResponse.json({ cards, rejected });
  } catch (error) {
    if (error instanceof SetupAgentConfigError) {
      // Setup problem (no key) — the client falls back to guided setup.
      console.error("[api/catalog/setup/agent] config:", error.message);
      return NextResponse.json(
        { error: "Guided setup is unavailable", fallback: "guided" },
        { status: 503 },
      );
    }
    console.error("[api/catalog/setup/agent] Error:", error);
    if (error instanceof Error && error.message.toLowerCase().includes("token")) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
