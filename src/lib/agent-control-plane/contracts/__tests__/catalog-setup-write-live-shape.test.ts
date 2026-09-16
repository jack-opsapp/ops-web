import { describe, expect, it } from "vitest";

import live from "../__fixtures__/catalog-setup-write-live-documents.json";
import {
  CatalogSetupWriteReceiptSchema,
  CatalogSetupWriteResultSchema,
} from "../catalog-setup-write";
import { matchesCreateVariantRequest } from "@/lib/agent-control-plane/services/catalog-setup-write/catalog-setup-write-repository";

/**
 * The published result and receipt are unions over the write kind. The fixture
 * is a create_variant round trip, so narrow once here and let every assertion
 * below read that kind's own fields.
 */
function createVariantPrepare() {
  const parsed = CatalogSetupWriteResultSchema.parse(live.prepare);
  if (parsed.proposal.kind !== "create_variant") {
    throw new Error("The live fixture is a create_variant prepare");
  }
  return { ...parsed, proposal: parsed.proposal };
}

function createVariantReceipt() {
  const parsed = CatalogSetupWriteReceiptSchema.parse(live.receipt);
  if (parsed.kind !== "create_variant") {
    throw new Error("The live fixture is a create_variant receipt");
  }
  return parsed;
}

/**
 * The fixture is the literal jsonb `public.prepare_catalog_setup_write_as_system`
 * and `public.commit_catalog_setup_write_as_actor` returned against a local copy
 * of production structure and Canpro's real catalogue, first captured by
 * `docs/artifacts/mcp-catalog-setup-writes/create-variant-proof.sql` and
 * re-captured after the override-level migration by
 * `docs/artifacts/mcp-catalog-setup-writes/live-fixture-capture.sql`.
 *
 * Every other test in this vertical mocks the database, which proves nothing
 * about the shape the database actually emits. This one closes that gap: if the
 * SQL and the zod contract ever drift apart, this fails rather than a customer
 * finding out. Re-capture the fixture whenever the SQL result shape changes.
 */
describe("catalogue setup write live database shape", () => {
  it("parses the real prepare result against the published contract", () => {
    const parsed = CatalogSetupWriteResultSchema.safeParse(live.prepare);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("parses the real commit receipt against the published contract", () => {
    const parsed = CatalogSetupWriteReceiptSchema.safeParse(live.receipt);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("carries the decisions the tool is supposed to enforce", () => {
    const result = createVariantPrepare();
    expect(result.status).toBe("approval_required");
    expect(result.proposal.kind).toBe("create_variant");
    // Opening stock is an event, and the scalar the rest of OPS reads agrees.
    expect(result.proposal.after.opening_quantity?.recorded_as).toBe(
      "stock_receive_event"
    );
    expect(result.proposal.after.variant.quantity).toBe("12");
    expect(result.proposal.effects.stock_events_recorded).toBe(1);
    expect(result.proposal.effects.stock_units_created).toBe(1);
    expect(result.proposal.effects.messages_sent).toBe(0);
    expect(result.proposal.effects.accounting_sync_enqueued).toBe(0);
    // The family has no default price, so the variant carries its own — and
    // the preview says which level the price is at, not just the number.
    expect(result.proposal.before.default_price).toBeNull();
    expect(result.proposal.after.variant.sale_price).toEqual({
      amount: "45.0000",
      origin: "variant",
    });
    // Vinyl carries no family cost and the write sets none on the variant.
    expect(result.proposal.after.variant.unit_cost).toEqual({
      amount: null,
      origin: "none",
    });
    // Thresholds are whole units, as OPS stores and shows them, with the level
    // they resolve at: Vinyl has no family or category level, so they are the
    // variant's own.
    expect(result.proposal.after.variant.warning_threshold).toEqual({
      value: "30",
      origin: "variant",
    });
    expect(result.proposal.after.variant.critical_threshold).toEqual({
      value: "12",
      origin: "variant",
    });
  });

  it("reads back exactly what the approved preview predicted", () => {
    const result = createVariantPrepare();
    const receipt = createVariantReceipt();
    expect(receipt.readback).toEqual(result.proposal.after.variant);
    expect(receipt.preview_sha256).toBe(result.preview_sha256);
    expect(receipt.change_set_id).toBe(result.change_set_id);
    expect(receipt.action_id).toBe(result.action_id);
    expect(receipt.effects).toEqual(result.proposal.effects);
    expect(receipt.variant_ref.kind).toBe("catalog_variant");
  });

  it("satisfies the repository's own request/preview matcher", () => {
    const result = createVariantPrepare();
    const request = {
      family_ref: result.proposal.family.family_ref,
      option_values: result.proposal.after.variant.option_values.map(
        (entry) => ({
          option_ref: entry.option_ref,
          value_ref: entry.value_ref,
        })
      ),
      price_override: {
        amount: result.proposal.after.variant.sale_price.amount!,
        currency: result.proposal.after.currency,
      },
      warning_threshold: 30,
      critical_threshold: 12,
      opening_quantity: {
        quantity: result.proposal.after.opening_quantity!.quantity,
        note: result.proposal.after.opening_quantity!.note!,
      },
      evidence: result.proposal.evidence.map((item) => ({
        kind: "operator_statement" as const,
        text: item.text,
      })),
      idempotency_key: "catalog-setup:proof:boardwalk-smooth",
    };
    expect(matchesCreateVariantRequest(result, request)).toBe(true);
    expect(
      matchesCreateVariantRequest(result, {
        ...request,
        warning_threshold: 31,
      })
    ).toBe(false);
  });
});
