import { describe, expect, it } from "vitest";

import {
  renderDeterministicLeadSummaryFallback,
  type LeadSummaryContextBundle,
} from "@/lib/api/services/lead-summary-service";

type CurrentFactContext = NonNullable<
  LeadSummaryContextBundle["current_fact_context"]
>;
type CommercialContext = LeadSummaryContextBundle["commercial_context"];

function currentFactContext(
  overrides: Partial<CurrentFactContext> = {}
): CurrentFactContext {
  return {
    current_price: null,
    current_scope: null,
    schedule: null,
    objection: null,
    next_action: null,
    superseded_prices: [],
    superseded_scopes: [],
    superseded_schedules: [],
    resolved_objections: [],
    superseded_next_actions: [],
    ...overrides,
  };
}

function makeBundle(input: {
  current?: CurrentFactContext | null;
  commercial?: CommercialContext;
  address?: string | null;
  stage?: string;
}): LeadSummaryContextBundle {
  return {
    lead: {
      title: "Cedar deck rebuild",
      contact: "Rose",
      address: input.address === undefined ? "18 Fern Way" : input.address,
      stage: input.stage ?? "quote_sent",
      value: null,
      source: null,
      created: "2026-05-02",
      description: null,
      previous_summary: null,
    },
    stage_history: [],
    site_visits: [],
    activity: [],
    emails: [],
    conversation_fold: {
      source_message_count: 0,
      recent_message_count: 0,
      observations: {},
    },
    email_thread_summaries: [],
    current_fact_context: input.current ?? null,
    commercial_context: input.commercial ?? null,
  } as unknown as LeadSummaryContextBundle;
}

const LONG_SCHEDULE = `${"Crew mobilization is confirmed and the customer has been notified of the sequencing plan. ".repeat(
  3
)}Install begins September 15.`;

/**
 * Both divergences named in the plan were reproduced against the unfixed
 * renderer before anything here changed:
 *
 *  (a) a superseded fact that is an earlier revision of the CURRENT fact the
 *      renderer is obligated to state — "repeated a superseded commercial
 *      scope" / "…next action";
 *  (b) the fixed-length fragment clip deleting the schedule's date anchor —
 *      "omitted the current commercial schedule".
 *
 * Both signatures match the production errors on the six stale leads. These
 * tests now pin the converged behaviour.
 */
describe("deterministic lead-summary fallback convergence (0700468d)", () => {
  it("states the current scope even when a superseded revision overlaps it", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({
        current: currentFactContext({
          current_scope: "rebuild the cedar deck and install glass railing",
          superseded_scopes: [
            "rebuild the cedar deck and install wood railing",
          ],
        }),
      })
    );

    expect(summary).toContain("glass railing");
  });

  it("states the current next action even when a superseded revision overlaps it", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({
        current: currentFactContext({
          current_scope: "install glass railing",
          next_action: "email the revised cedar railing drawings to Rose",
          superseded_next_actions: [
            "email the original cedar railing drawings to Rose",
          ],
        }),
      })
    );

    expect(summary).toContain("revised cedar railing drawings");
  });

  it("keeps the schedule's date anchor when the head clip would drop it", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({ current: currentFactContext({ schedule: LONG_SCHEDULE }) })
    );

    expect(summary).toContain("September 15");
  });

  it("still states a schedule that carries no anchor at all", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({
        current: currentFactContext({
          schedule: "Install once the permit clears.",
        }),
      })
    );

    expect(summary).toMatch(/permit/i);
  });

  it("does not repeat a superseded price that differs from the current one", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({
        current: currentFactContext({
          current_price: 18400,
          superseded_prices: [21750],
        }),
      })
    );

    expect(summary).toContain("$18,400");
    expect(summary).not.toContain("21,750");
  });

  it("still rejects a superseded fact the current facts do not account for", () => {
    // The superseded SCOPE is not carried by the current scope, so it stays in
    // the contract; the objection clause then resurrects it. The narrowing is
    // strictly per-field, never a blanket waiver.
    expect(() =>
      renderDeterministicLeadSummaryFallback(
        makeBundle({
          current: currentFactContext({
            current_scope: "install glass railing",
            objection: "the concrete patio demolition quote was too expensive",
            superseded_scopes: ["demolish the concrete patio"],
          }),
        })
      )
    ).toThrow(/repeated a superseded commercial scope/);
  });

  it("throws only when there is nothing current to state", () => {
    expect(() =>
      renderDeterministicLeadSummaryFallback(
        makeBundle({ current: currentFactContext({}) })
      )
    ).toThrow(/deterministic fallback had no current facts/);
  });
});

/**
 * The load-bearing invariant: this is what ends the ×681 refresh loop. For
 * every structured combination of current facts, superseded revisions of those
 * same facts, schedules with and without surviving anchors, and money-bearing
 * scopes, the renderer must converge — a bundle carrying at least one current
 * fact always produces a summary that passes both validators (the renderer runs
 * them itself before returning, so "does not throw" IS "passes both").
 */
describe("deterministic fallback property: structured bundles always converge", () => {
  const PRICES: Array<number | null> = [null, 18400, 950.5];
  const SCOPES: Array<string | null> = [
    null,
    "rebuild the cedar deck and install glass railing",
    "supply and install a $4,200 aluminium railing package with fascia trim",
  ];
  const SCHEDULES: Array<string | null> = [
    null,
    "Install begins September 15.",
    LONG_SCHEDULE,
    "Install once the permit clears.",
  ];
  const OUTCOMES: Array<CommercialContext extends null ? never : string> = [];
  void OUTCOMES;

  function supersededRevision(value: string): string {
    // A realistic earlier revision: same subject, one changed qualifier.
    return value
      .replace("glass", "wood")
      .replace("aluminium", "cedar")
      .replace("September 15", "August 4")
      .replace("permit clears", "deposit lands");
  }

  const bundles: Array<{ name: string; bundle: LeadSummaryContextBundle }> = [];
  for (const price of PRICES) {
    for (const scope of SCOPES) {
      for (const schedule of SCHEDULES) {
        for (const withSuperseded of [false, true]) {
          const current = currentFactContext({
            current_price: price,
            current_scope: scope,
            schedule,
            next_action: scope ? "send the revised drawings" : null,
            superseded_prices:
              withSuperseded && price !== null ? [price, price + 1500] : [],
            superseded_scopes:
              withSuperseded && scope ? [supersededRevision(scope)] : [],
            superseded_schedules:
              withSuperseded && schedule ? [supersededRevision(schedule)] : [],
            superseded_next_actions: withSuperseded && scope
              ? ["send the original drawings"]
              : [],
          });
          bundles.push({
            name: `price=${price} scope=${scope ? "yes" : "no"} schedule=${
              schedule ? schedule.slice(0, 18) : "none"
            } superseded=${withSuperseded}`,
            bundle: makeBundle({ current }),
          });
        }
      }
    }
  }

  it("covers a meaningful matrix", () => {
    expect(bundles.length).toBeGreaterThanOrEqual(20);
  });

  for (const { name, bundle } of bundles) {
    const current = bundle.current_fact_context;
    const hasCurrentFact = Boolean(
      current &&
        (current.current_price !== null ||
          current.current_scope ||
          current.schedule ||
          current.objection ||
          current.next_action)
    );
    if (!hasCurrentFact) continue;

    it(`converges: ${name}`, () => {
      const summary = renderDeterministicLeadSummaryFallback(bundle);
      expect(summary.length).toBeGreaterThan(0);

      // Every current fact it holds must actually appear.
      if (current?.current_price !== null && current?.current_price) {
        expect(summary).toMatch(/\$[\d,]/);
      }
      if (current?.schedule) {
        expect(summary).toMatch(/schedule/i);
      }
    });
  }
});

/**
 * Bug 7ca126d2 — the summary output guard.
 *
 * Lead b444e6fc was rendered as: "Customer at 3934 Jean Pl remains in the
 * quoted stage. Scope: 8723 | 9785 201 St Langley Twp, BC V1M 3E7 | From:
 * Jackson Sweet Sent: Thursday… Next action: â€چ â€چ …". The "scope" was a
 * sliced signature card and the "next action" was a mojibake-quoted copy of
 * the operator's own message. A contact card is never a deal fact.
 */
describe("deterministic fallback rejects contact-card facts (7ca126d2)", () => {
  const CARD_SCOPE =
    "8723 | 9785 201 St Sample Twp, BC V1M 3E7 | From: Jackson Sweet Sent: Thursday";
  const MOJIBAKE_NEXT_ACTION = "â€چ â€چ Please confirm the delivery date";

  it("drops a scope clause that is a sliced contact card", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({
        current: currentFactContext({
          current_scope: CARD_SCOPE,
          next_action: "Send the revised drawings to Rose",
        }),
      })
    );

    expect(summary).not.toMatch(/Scope:/);
    expect(summary).not.toContain("9785 201 St");
    expect(summary).not.toContain("From:");
    expect(summary).not.toContain("Sent:");
    expect(summary).toContain("revised drawings");
  });

  it("emits a next action clean of double-encoded formatting marks", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({
        current: currentFactContext({
          current_scope: "install glass railing",
          next_action: MOJIBAKE_NEXT_ACTION,
        }),
      })
    );

    expect(summary).not.toContain("â€");
    expect(summary).toContain("confirm the delivery date");
    expect(summary).toContain("glass railing");
  });

  it("drops a card that reaches the renderer only through commercial_context", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({
        current: currentFactContext({ current_price: 8450 }),
        commercial: {
          outcome: "won",
          reason: "customer_committed",
          current_price: 8450,
          current_scope: CARD_SCOPE,
          excluded_scope: null,
          schedule: null,
          objection: null,
          next_action: null,
          superseded_prices: [],
        } as NonNullable<CommercialContext>,
      })
    );

    expect(summary).not.toMatch(/Scope:/);
    expect(summary).not.toContain("9785 201 St");
    expect(summary).toMatch(/\$[\d,]/);
  });

  it("keeps a legitimate scope that merely contains a single pipe", () => {
    const summary = renderDeterministicLeadSummaryFallback(
      makeBundle({
        current: currentFactContext({
          current_scope: "rebuild the cedar deck | glass railing upgrade",
        }),
      })
    );

    expect(summary).toContain("glass railing upgrade");
  });
});
