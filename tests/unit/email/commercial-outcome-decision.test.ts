import { describe, expect, it } from "vitest";

import * as terminalStageDecision from "@/lib/email/terminal-stage-decision";

type CommercialSignal =
  | "explicit_acceptance"
  | "schedule_confirmed"
  | "deposit_requested"
  | "payment_confirmed"
  | "budget_timing_deferral"
  | "customer_declined";

interface CommercialOutcomeMessage {
  evidenceKey?: string;
  providerMessageId: string;
  occurredAt: string;
  direction: "inbound" | "outbound";
  authorRole: "customer" | "operator" | "untrusted";
  subject: string;
  body: string;
}

interface CommercialFacts {
  currentPrice: number | null;
  currentScope: string | null;
  excludedScope: string | null;
  schedule: string | null;
  objection: string | null;
  nextAction: string | null;
}

type CommercialOutcomeDecision =
  | {
      outcome: "won";
      confidence: "high";
      reasonCode: "customer_committed";
      decisiveEvidenceKey: string;
      decisiveMessageId: string;
      decisiveDirection: "inbound" | "outbound";
      evidenceMessageIds: string[];
      decisiveSignals: CommercialSignal[];
      signals: CommercialSignal[];
      followUpAt: null;
      facts: CommercialFacts;
    }
  | {
      outcome: "deferred";
      confidence: "high";
      reasonCode: "budget_timing";
      decisiveEvidenceKey: string;
      decisiveMessageId: string;
      decisiveDirection: "inbound";
      evidenceMessageIds: string[];
      decisiveSignals: CommercialSignal[];
      signals: CommercialSignal[];
      followUpAt: string;
      facts: CommercialFacts;
    }
  | {
      outcome: "declined";
      confidence: "high";
      reasonCode: "customer_declined";
      decisiveEvidenceKey: string;
      decisiveMessageId: string;
      decisiveDirection: "inbound";
      evidenceMessageIds: string[];
      decisiveSignals: CommercialSignal[];
      signals: CommercialSignal[];
      followUpAt: null;
      facts: CommercialFacts;
    }
  | null;

type DetectCommercialOutcome = (input: {
  messages: CommercialOutcomeMessage[];
  now: Date;
}) => CommercialOutcomeDecision;

const detectCommercialOutcome: DetectCommercialOutcome =
  (
    terminalStageDecision as typeof terminalStageDecision & {
      detectCommercialOutcome?: DetectCommercialOutcome;
    }
  ).detectCommercialOutcome ?? (() => null);

function message(
  providerMessageId: string,
  occurredAt: string,
  direction: "inbound" | "outbound",
  body: string,
  subject = "Re: Estimate",
  authorRole: "customer" | "operator" | "untrusted" = direction === "inbound"
    ? "customer"
    : "operator"
): CommercialOutcomeMessage {
  return {
    providerMessageId,
    occurredAt,
    direction,
    authorRole,
    subject,
    body,
  };
}

const NOW = new Date("2026-07-21T18:00:00.000Z");

describe("detectCommercialOutcome — real lead lifecycle regressions", () => {
  it("treats Camille's acceptance and confirmed installation date as Won while superseding removal and the old price", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "camille-installation-quote",
          "2026-06-10T17:00:00.000Z",
          "outbound",
          "Our minimum charge is 1500.00, but if we do the install we might be able to do 1200.00. Supply only would cost 880.00."
        ),
        message(
          "camille-accept-revision",
          "2026-06-12T17:00:00.000Z",
          "inbound",
          "I'll take you up on the install offer for $1,200. I'm looking to replace it with white railings."
        ),
        message(
          "camille-removal-option",
          "2026-06-12T18:00:00.000Z",
          "outbound",
          "If we are doing the removal of the existing steel as well, I would have to bring it up to 1400 at least."
        ),
        message(
          "camille-remove-scope-revision",
          "2026-06-12T19:00:00.000Z",
          "inbound",
          "My husband says he'll remove it tonight (or the night before the confirmed appointment). Is tomorrow still open?"
        ),
        message(
          "camille-date-confirmed",
          "2026-06-13T17:00:00.000Z",
          "outbound",
          "Sure thing. Tomorrow is good still!"
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      confidence: "high",
      reasonCode: "customer_committed",
      decisiveMessageId: "camille-date-confirmed",
      evidenceMessageIds: expect.arrayContaining([
        "camille-accept-revision",
        "camille-date-confirmed",
      ]),
      signals: expect.arrayContaining([
        "explicit_acceptance",
        "schedule_confirmed",
      ]),
      decisiveSignals: ["schedule_confirmed"],
      followUpAt: null,
      facts: {
        currentPrice: 1200,
        currentScope: expect.stringMatching(/install/i),
        excludedScope: expect.stringMatching(/husband.*remove/i),
        schedule: expect.stringMatching(/tomorrow/i),
        objection: null,
        nextAction: expect.stringMatching(/convert|project/i),
      },
    });
  });

  it("keeps the base price when a later removal total appears in the same message and removal is then excluded", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "camille-two-price-offer",
          "2026-06-10T17:00:00.000Z",
          "outbound",
          "Installation is $1,200. Removal would bring the total to $1,400."
        ),
        message(
          "camille-final-scope",
          "2026-06-11T17:00:00.000Z",
          "inbound",
          "My husband will remove the old railing, so removal is excluded. We accept and are ready to proceed."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      facts: {
        currentPrice: 1200,
        excludedScope: expect.stringMatching(/husband.*remove/i),
      },
    });
  });

  it("tracks a general scope exclusion and restores the applicable base price", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "trade-scope-options",
          "2026-06-10T17:00:00.000Z",
          "outbound",
          "Plumbing fixture installation is $2,400. Including fixture supply brings the total to $3,100."
        ),
        message(
          "trade-scope-revision",
          "2026-06-11T17:00:00.000Z",
          "inbound",
          "We accept the plumbing work. The owner will supply the fixtures, so fixture supply is excluded."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      facts: {
        currentPrice: 2400,
        currentScope: expect.stringMatching(/plumbing.*install/i),
        excludedScope: expect.stringMatching(/owner.*supply.*fixtures/i),
      },
    });
  });

  it("keeps an operator first-person removal promise in current scope", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "scope-acceptance",
          "2026-07-18T18:00:00.000Z",
          "inbound",
          "We accept the $1,200 installation. Please proceed."
        ),
        message(
          "operator-removal-promise",
          "2026-07-19T18:00:00.000Z",
          "outbound",
          "We will remove and dispose of the old railing as part of the installation."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      facts: {
        currentScope: expect.stringMatching(/we will remove.*old railing/i),
        excludedScope: null,
      },
    });
  });

  it("keeps customer self-performance excluded while preserving explicit operator exclusions", () => {
    const customerSelfPerformance = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "customer-self-performance",
          "2026-07-18T18:00:00.000Z",
          "inbound",
          "We accept the installation, but we will remove the old railing ourselves."
        ),
      ],
    });
    const operatorExplicitExclusion = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "scope-accepted",
          "2026-07-18T18:00:00.000Z",
          "inbound",
          "We accept the installation."
        ),
        message(
          "operator-explicit-exclusion",
          "2026-07-19T18:00:00.000Z",
          "outbound",
          "Removal is not included in the $1,200 installation."
        ),
      ],
    });

    expect(customerSelfPerformance).toMatchObject({
      outcome: "won",
      facts: {
        excludedScope: expect.stringMatching(/we will remove.*ourselves/i),
      },
    });
    expect(operatorExplicitExclusion).toMatchObject({
      outcome: "won",
      facts: {
        excludedScope: expect.stringMatching(/removal is not included/i),
      },
    });
  });

  it("treats Layla's acceptance and request for deposit instructions as Won", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "layla-offer",
          "2026-07-01T16:00:00.000Z",
          "outbound",
          "Supply-only is still possible. I can have it ready this week — 600.00 would be the cost."
        ),
        message(
          "layla-accept-deposit",
          "2026-07-02T16:00:00.000Z",
          "inbound",
          "That would be wonderful! We don't need them until August. Let me know what the deposit/payment is and we will get that sent your way."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      reasonCode: "customer_committed",
      decisiveMessageId: "layla-accept-deposit",
      evidenceMessageIds: expect.arrayContaining([
        "layla-offer",
        "layla-accept-deposit",
      ]),
      signals: expect.arrayContaining(["deposit_requested"]),
      decisiveSignals: ["deposit_requested"],
      facts: {
        currentPrice: 600,
        currentScope: expect.stringMatching(/supply.?only/i),
        schedule: expect.stringMatching(/august/i),
        nextAction: expect.stringMatching(/deposit|payment/i),
      },
    });
    expect(result?.signals).not.toContain("payment_confirmed");
  });

  it("treats Owen and Jennifer's paid deposits as Won despite the earlier conditional start request", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "owen-proceed",
          "2026-05-20T19:00:00.000Z",
          "inbound",
          "We would like to proceed if you're still able to start us week of July 13. Can we connect to sort out paying the deposit? Could we ask your crew to help get some of the larger heavier items off the deck as I'm limited in how much weight I can do? If it goes up to a 2x6 we'll be whacking our heads on it even more than we do now. Looking forward to get going on this!"
        ),
        message(
          "owen-deposit-paid",
          "2026-05-21T19:00:00.000Z",
          "inbound",
          "Just paid Jackson's deposit."
        ),
        message(
          "owen-deposit-receipt",
          "2026-05-22T19:00:00.000Z",
          "outbound",
          "Thank you Owen, received!"
        ),
        message(
          "jennifer-deposit-paid",
          "2026-05-23T19:00:00.000Z",
          "inbound",
          "Just sent deposit and the security answer via text. Let us know if we are on for Monday, July 13th."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      reasonCode: "customer_committed",
      decisiveMessageId: "jennifer-deposit-paid",
      evidenceMessageIds: expect.arrayContaining([
        "owen-proceed",
        "owen-deposit-paid",
        "owen-deposit-receipt",
        "jennifer-deposit-paid",
      ]),
      signals: expect.arrayContaining(["payment_confirmed"]),
      facts: {
        schedule: expect.stringMatching(/monday|july 13/i),
        nextAction: expect.stringMatching(/convert|project|schedule/i),
      },
    });
  });

  it("treats Owen's possessive paid-deposit wording as confirmed payment without requiring a later duplicate payer", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "owen-proceed",
          "2026-05-20T19:00:00.000Z",
          "inbound",
          "We would like to proceed if you're still able to start us week of July 13. Can we connect to sort out paying the deposit?"
        ),
        message(
          "owen-deposit-paid",
          "2026-05-21T19:00:00.000Z",
          "inbound",
          "Just paid Jackson's deposit."
        ),
        message(
          "owen-deposit-receipt",
          "2026-05-22T19:00:00.000Z",
          "outbound",
          "Thank you Owen, received!"
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      decisiveMessageId: "owen-deposit-paid",
      signals: expect.arrayContaining(["payment_confirmed"]),
      facts: {
        excludedScope: null,
        schedule: null,
        nextAction: "Convert or link the project and confirm the work schedule.",
      },
    });
    expect(result?.facts.nextAction).not.toMatch(/send deposit|instructions/i);
  });

  it("does not replace Camille's installation scope with availability chatter that happens to say work or job", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "camille-installation-quote",
          "2026-06-10T17:00:00.000Z",
          "outbound",
          "I might be able to do $1,200 for the installation."
        ),
        message(
          "camille-acceptance",
          "2026-06-11T17:00:00.000Z",
          "inbound",
          "I'll take you up on the installation offer for $1,200."
        ),
        message(
          "camille-availability",
          "2026-06-12T17:00:00.000Z",
          "inbound",
          "I'm not in a rush, so feel free to piggyback with another job. I work from home tomorrow."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      facts: {
        currentScope: expect.stringMatching(/installation offer/i),
      },
    });
    expect(result?.facts.currentScope).not.toMatch(
      /piggyback|another job|work from home/i
    );
  });

  it("treats Erick's explicit budget and timing postponement as deferred with a 12-month follow-up", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "erick-discounted-quote",
          "2026-07-10T18:00:00.000Z",
          "outbound",
          "We would be at 3547.44 for this work, minus 10% with our current promo (3192.70 after discount)."
        ),
        message(
          "erick-budget-deferral",
          "2026-07-11T18:00:00.000Z",
          "inbound",
          "I am forced to delay my deck project. The funds we have for the project now need to go toward a new engine in my truck. We're planning to do the deck next year, but just can't swing it this season."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "deferred",
      confidence: "high",
      reasonCode: "budget_timing",
      decisiveMessageId: "erick-budget-deferral",
      evidenceMessageIds: expect.arrayContaining([
        "erick-discounted-quote",
        "erick-budget-deferral",
      ]),
      signals: expect.arrayContaining(["budget_timing_deferral"]),
      decisiveSignals: ["budget_timing_deferral"],
      followUpAt: "2027-07-11T18:00:00.000Z",
      facts: {
        currentPrice: 3192.7,
        objection: expect.stringMatching(/truck repairs|budget|funds/i),
        nextAction: expect.stringMatching(
          /follow.?up.*next year|next year.*follow.?up/i
        ),
      },
    });
  });

  it("does not replace a quoted deal price with the customer's unrelated repair expense", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "quote-before-expense",
          "2026-07-19T18:00:00.000Z",
          "outbound",
          "Your discounted quote is $3,192.70."
        ),
        message(
          "external-expense-deferral",
          "2026-07-20T18:00:00.000Z",
          "inbound",
          "Truck repairs cost $4,000, so we need to postpone until next year."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "deferred",
      facts: {
        currentPrice: 3192.7,
        objection: expect.stringMatching(/truck repairs cost \$4,000/i),
      },
    });
  });

  it("derives a deferral follow-up from immutable evidence time, not retry time", () => {
    const messages = [
      message(
        "stable-deferral",
        "2026-07-11T18:00:00.000Z",
        "inbound",
        "Truck repairs consumed the funds, so we have to postpone until next year."
      ),
    ];

    const first = detectCommercialOutcome({
      now: new Date("2026-07-21T18:00:00.000Z"),
      messages,
    });
    const retry = detectCommercialOutcome({
      now: new Date("2026-08-21T18:00:00.000Z"),
      messages,
    });

    expect(first?.followUpAt).toBe("2027-07-11T18:00:00.000Z");
    expect(retry?.followUpAt).toBe(first?.followUpAt);
  });

  it.each([
    {
      name: "24-month deferral",
      body: "Truck repairs consumed the budget, so postpone the project for 24 months.",
      expectedAction:
        "Follow up within 18 months to reassess the customer's 24-month deferral.",
    },
    {
      name: "far-future year",
      body: "Truck repairs consumed the budget, so postpone the project until 2035.",
      expectedAction:
        "Follow up within 18 months to reassess the customer's 2035 timing.",
    },
  ])(
    "clamps a $name to the guarded 18-month horizon and keeps retries deterministic",
    ({ body, expectedAction }) => {
      const messages = [
        message(
          "long-term-deferral",
          "2026-07-20T18:00:00.000Z",
          "inbound",
          body
        ),
      ];
      const first = detectCommercialOutcome({
        now: new Date("2026-07-21T18:00:00.000Z"),
        messages,
      });
      const delayedRetry = detectCommercialOutcome({
        now: new Date("2036-01-01T00:00:00.000Z"),
        messages,
      });

      expect(first).toMatchObject({
        outcome: "deferred",
        followUpAt: "2028-01-20T18:00:00.000Z",
        facts: { nextAction: expectedAction },
      });
      expect(delayedRetry?.followUpAt).toBe(first?.followUpAt);
      expect(delayedRetry?.facts.nextAction).toBe(first?.facts.nextAction);
    }
  );

  it("lets a clear current commitment supersede an earlier deferral clause in the same customer message", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "same-message-deferral-corrected",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "We planned to postpone until next year because the budget was tight, but repairs are done and now we are ready to proceed."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveMessageId: "same-message-deferral-corrected",
      decisiveSignals: ["explicit_acceptance"],
      signals: expect.not.arrayContaining(["budget_timing_deferral"]),
    });
  });

  it("keeps a current deferral decisive when it corrects an earlier acceptance clause in the same customer message", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "same-message-acceptance-retracted",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "We were ready to proceed, but the truck repair consumed the budget, so now we have to postpone until next year."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "deferred",
      decisiveMessageId: "same-message-acceptance-retracted",
      decisiveSignals: ["budget_timing_deferral"],
      signals: ["budget_timing_deferral"],
    });
  });

  it("fails closed when one customer message contains unresolved acceptance and deferral signals", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "same-message-ambiguous",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "We are ready to proceed and we also need to postpone until next year because the budget is tight."
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    "Should we go ahead?",
    "Should we book it?",
    "Is installation confirmed for Tuesday?",
    "Has Tuesday been confirmed?",
    "Is the payment confirmed?",
    "Can you confirm the deposit was received?",
    "Please confirm the deposit was received.",
    "Please confirm the installation is booked for Monday.",
    "We accept your invitation to quote the project.",
    "Can you send a quote with deposit details?",
    "Please provide a quote and deposit details.",
  ])("does not turn a commercial inquiry into Won: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "commercial-inquiry",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it.each(["Where do I send the deposit?", "How do we submit the payment?"])(
    "keeps a deposit/payment-instruction question as commitment: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "payment-instructions",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "won",
        decisiveSignals: ["deposit_requested"],
      });
    }
  );

  it.each([
    "Sounds good, let's do it.",
    "Sounds good, let's do it—when can you start?",
    "Please proceed, when can you schedule us?",
    "Book it.",
    "That quote works for us.",
    "After reviewing the quote, we accept.",
  ])("recognizes an unambiguous customer commitment: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "customer-commitment",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["explicit_acceptance"],
    });
  });

  it("recognizes a same-message accepted schedule", () => {
    const body = "We accept the quote. Monday works for us.";
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "accepted-schedule",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["explicit_acceptance", "schedule_confirmed"],
      facts: { schedule: body },
    });
  });

  it("recognizes a see-you date only after a prior customer commitment", () => {
    const schedule = "See you Monday.";
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "accepted-first",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "We accept the quote."
          ),
          message(
            "see-you-schedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            schedule
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveMessageId: "see-you-schedule",
      decisiveSignals: ["schedule_confirmed"],
      facts: { schedule },
    });
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "uncommitted-see-you",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            schedule
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    "Your quote works for us if you can reduce the price.",
    "Please proceed once the permit is approved.",
    "Book it when financing clears.",
    "That estimate looks good upon final engineering approval.",
  ])("does not convert a conditional customer commitment: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "conditional-customer-commitment",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    "The deposit was received. Can you confirm Tuesday is still available?",
    "Payment received, please confirm Tuesday is still available?",
    "The deposit was received; is installation confirmed for Tuesday?",
  ])(
    "keeps a declarative payment fact before a trailing question: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "confirmed-before-question",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "won",
        decisiveSignals: expect.arrayContaining(["payment_confirmed"]),
      });
    }
  );

  it.each([
    "The deposit was received.",
    "Your deposit payment was received through the payment link.",
    "Payment received, receipt attached.",
    "Payment sent, please confirm receipt.",
  ])("preserves a genuine payment confirmation: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "genuine-payment-confirmation",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["payment_confirmed"],
    });
  });

  it("does not interpret Owen's 50% deposit confirmation as a work date", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "owen-deposit-received",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "We received and confirmed your 50% deposit payment."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["payment_confirmed"],
      signals: ["payment_confirmed"],
      facts: { schedule: null },
    });
  });

  it.each([
    {
      name: "payment follows the schedule",
      messages: [
        message(
          "owen-schedule",
          "2026-07-19T18:00:00.000Z",
          "outbound",
          "The installation is booked for July 13th."
        ),
        message(
          "owen-payment",
          "2026-07-20T18:00:00.000Z",
          "outbound",
          "We received and confirmed your 50% deposit payment."
        ),
      ],
    },
    {
      name: "schedule follows the payment",
      messages: [
        message(
          "owen-payment",
          "2026-07-19T18:00:00.000Z",
          "outbound",
          "We received and confirmed your 50% deposit payment."
        ),
        message(
          "owen-schedule",
          "2026-07-20T18:00:00.000Z",
          "outbound",
          "The installation is booked for July 13th."
        ),
      ],
    },
  ])("preserves Owen's actual work schedule when $name", ({ messages }) => {
    expect(detectCommercialOutcome({ now: NOW, messages })).toMatchObject({
      outcome: "won",
      facts: { schedule: "The installation is booked for July 13th." },
    });
  });

  it.each([
    "We received the payment but refunded it.",
    "The deposit was received and then sent back.",
  ])(
    "does not treat a reversed payment as current confirmation: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "reversed-payment",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toBeNull();
    }
  );

  it("revokes an earlier payment-only Won when the payment is later refunded", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "payment-first",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "Payment received."
          ),
          message(
            "payment-refunded",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "The payment was refunded."
          ),
        ],
      })
    ).toBeNull();
  });

  it("does not let a later operator payment statement reopen an explicit customer decline", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "customer-cancelled",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "We decided not to proceed with the project. Please cancel it."
          ),
          message(
            "operator-payment-note",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "The deposit payment is confirmed."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "declined",
      decisiveMessageId: "customer-cancelled",
      decisiveSignals: ["customer_declined"],
    });
  });

  it("allows a newer explicit customer recommitment to reopen a prior decline", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "customer-cancelled",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "We decided not to proceed with the project. Please cancel it."
          ),
          message(
            "customer-recommitted",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "The issue is resolved and we are ready to proceed."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveMessageId: "customer-recommitted",
      decisiveSignals: ["explicit_acceptance"],
    });
  });

  it.each([
    "We can't wait until next year; our budget covers the truck repair and the deck. Please proceed.",
    "We don't need to wait until next year because the repair and project budgets are both ready. We accept; please proceed.",
    "We are not postponing until next year. The truck repair is funded separately, and we accept the deck quote.",
    "We have no plans to postpone until next year; the truck repair is funded separately, and we accept the deck quote.",
    "We will not be postponing until next year; the budget is approved, and we are ready to proceed.",
  ])(
    "does not invert negated waiting or postponement into a budget deferral: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "negated-deferral-action",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "won",
        decisiveMessageId: "negated-deferral-action",
        signals: expect.not.arrayContaining(["budget_timing_deferral"]),
      });
    }
  );

  it.each([
    "We have no plans to postpone until next year; the truck repair is funded separately.",
    "We will not be postponing until next year; the budget is approved.",
  ])("does not create a deferral from a negated future plan: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "negated-future-plan",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    {
      body: "We can't do it until next year.",
      followUpAt: "2027-07-20T18:00:00.000Z",
      nextAction: "Follow up next year.",
    },
    {
      body: "After the truck repair, we can't afford the deck this season.",
      followUpAt: "2027-01-20T18:00:00.000Z",
      nextAction: "Follow up next season.",
    },
    {
      body: "Truck repairs used the budget, so let's revisit this next year.",
      followUpAt: "2027-07-20T18:00:00.000Z",
      nextAction: "Follow up next year.",
    },
    {
      body: "The truck repair used our funds; let's circle back next year.",
      followUpAt: "2027-07-20T18:00:00.000Z",
      nextAction: "Follow up next year.",
    },
    {
      body: "The budget is gone, so defer the project until next year.",
      followUpAt: "2027-07-20T18:00:00.000Z",
      nextAction: "Follow up next year.",
    },
  ])(
    "keeps a genuine future inability deferred: $body",
    ({ body, followUpAt, nextAction }) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "genuine-inability",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "deferred",
        followUpAt,
        facts: { nextAction },
      });
    }
  );

  it("ignores acceptance, scheduling, and payment language from an unauthenticated inbound author", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "untrusted-automation",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "We accept. Payment received and installation confirmed for tomorrow.",
            "Automated alert",
            "untrusted"
          ),
        ],
      })
    ).toBeNull();
  });

  it("does not treat operator availability or conditional payment text as a commitment", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "operator-options",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "We have August availability and can be scheduled for installation. Your deposit will be confirmed once payment is received."
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    "I would like to proceed with getting a quote for the railing.",
    "Please proceed with preparing the estimate.",
    "We would like to proceed if you can lower the quoted price.",
    "We approve the proposal provided that the gate is included at no charge.",
  ])("does not convert pre-quote or conditional language: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "conditional-or-prequote",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body,
            "Project inquiry"
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    "Accepted the quote.",
    "The proposal is approved.",
    "I've accepted the estimate.",
  ])("recognizes an explicit accepted-document form: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "accepted-document",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["explicit_acceptance"],
    });
  });

  it("keeps a customer budget deferral authoritative over a later operator schedule", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "customer-deferral",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "Truck repairs used the budget, so postpone this until next year."
          ),
          message(
            "operator-schedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "The installation is scheduled for Monday."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "deferred",
      decisiveMessageId: "customer-deferral",
    });
  });

  it("keeps a customer decline authoritative over a later operator schedule", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "customer-decline",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "We decided not to move forward and hired someone else."
          ),
          message(
            "operator-schedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "The installation is scheduled for Monday."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "declined",
      decisiveMessageId: "customer-decline",
    });
  });

  it("allows unequivocal payment receipt to reopen a budget deferral", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "customer-deferral",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "Truck repairs used the budget, so postpone this until next year."
          ),
          message(
            "payment-received",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "We received and confirmed your deposit payment."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveMessageId: "payment-received",
      decisiveSignals: ["payment_confirmed"],
    });
  });

  it.each([
    "The scheduled Monday installation was cancelled.",
    "The installation has been postponed from Monday.",
    "We need to reschedule the booked installation date.",
  ])("does not treat a cancelled or moved schedule as Won: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "moved-schedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it("does not treat an ordinary quote clarification as a confirmed schedule", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "quote-clarification",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "Just confirming the $1,200 quote is for installation only."
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    {
      direction: "inbound" as const,
      body: "Tuesday works for the estimate appointment.",
    },
    {
      direction: "outbound" as const,
      body: "Payment instructions have been sent.",
    },
    {
      direction: "outbound" as const,
      body: "The deposit invoice link was sent this morning.",
    },
  ])(
    "does not treat appointment or payment-administration text as a sale: $body",
    ({ direction, body }) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "administrative-message",
              "2026-07-20T18:00:00.000Z",
              direction,
              body
            ),
          ],
        })
      ).toBeNull();
    }
  );

  it.each([
    "The site visit for the project is booked Tuesday.",
    "The installation consultation is scheduled for Wednesday.",
    "Project measurements are confirmed for Friday.",
  ])("does not treat a scheduled pre-sale activity as Won: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "pre-sale-schedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    {
      body: "We accepted.",
      subject: "Re: Calendar invitation",
    },
    {
      body: "I approved it.",
      subject: "Re: Access request",
    },
    {
      body: "We accepted the calendar invitation.",
      subject: "Re: Tuesday meeting",
    },
    {
      body: "I approved the colour selection.",
      subject: "Re: Sample colours",
    },
    {
      body: "I approved the colour sample.",
      subject: "Re: Estimate",
    },
    {
      body: "We approved the measurements.",
      subject: "Re: Estimate",
    },
    {
      body: "I approved your request to access the property.",
      subject: "Re: Estimate",
    },
    {
      body: "We accept the site visit appointment.",
      subject: "Re: Estimate",
    },
    {
      body: "I accepted the calendar invitation.",
      subject: "Re: Estimate",
    },
  ])(
    "requires commercial context for a generic acceptance: $body",
    ({ body, subject }) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "generic-acceptance",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body,
              subject
            ),
          ],
        })
      ).toBeNull();
    }
  );

  it.each([
    "Payment confirmation was received.",
    "The payment status is confirmed.",
    "Payment authorization received.",
    "Your payment method was confirmed.",
    "We confirmed the payment method.",
  ])("requires a completed transfer fact for payment evidence: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "payment-administration",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it("does not extract a street number as the accepted price", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "accepted-address",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "We accept the work at 2745 Fernwood Road. Please proceed."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      facts: { currentPrice: null },
    });
  });

  it.each([
    {
      body: "We accept. The $1,200 quote is valid for 30 days.",
      expectedPrice: 1200,
    },
    {
      body: "We accept the 3192.70 quote covering 12 stairs.",
      expectedPrice: 3192.7,
    },
  ])(
    "keeps the deal amount and rejects counts or durations: $body",
    ({ body, expectedPrice }) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "accepted-price-with-count",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "won",
        facts: { currentPrice: expectedPrice },
      });
    }
  );

  it.each([
    {
      body: "We accept. Our quote is $3,000 plus $150 GST.",
      expectedPrice: 3000,
    },
    {
      body: "We accept. Our quote is $3,000 plus $150 GST; the final total is $3,150.",
      expectedPrice: 3150,
    },
  ])(
    "does not replace the deal price with a component amount: $body",
    ({ body, expectedPrice }) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "accepted-component-price",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "won",
        facts: { currentPrice: expectedPrice },
      });
    }
  );

  it.each([
    "We accept. Number of posts: 12.",
    "We accept. Installation time: 10 tomorrow.",
  ])(
    "does not infer a price from an unrelated colon-delimited number: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "accepted-unpriced-count",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "won",
        facts: { currentPrice: null },
      });
    }
  );

  it.each([
    "Installation starts Monday.",
    "The installation will start Monday.",
    "We start the project Monday.",
    "We will start the project Monday.",
    "The installation is starting Monday.",
    "The crew arrives Tuesday.",
    "The crew is arriving Tuesday.",
    "The crew is coming Tuesday.",
    "Installation is booked Monday — please confirm crew size.",
  ])("accepts a declarative execution schedule: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "declarative-execution-schedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            body
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["schedule_confirmed"],
      facts: { schedule: body },
    });
  });

  it("retains a numeric confirmed installation date as a mandatory schedule fact", () => {
    const body = "The installation starts on the 21st.";
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "numeric-execution-schedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            body
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["schedule_confirmed"],
      facts: { schedule: body },
    });
  });

  it("retains a corrected confirmed schedule after an earlier reschedule clause", () => {
    const schedule = "We had to reschedule, but Tuesday is now confirmed.";
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "accepted-before-reschedule",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "We accept the quote."
          ),
          message(
            "corrected-reschedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            schedule
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveMessageId: "corrected-reschedule",
      decisiveSignals: ["schedule_confirmed"],
      facts: { schedule },
    });
  });

  it("uses pre-correction installation context for a newly confirmed schedule", () => {
    const schedule =
      "We had to reschedule the installation, but Tuesday is now confirmed.";
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "standalone-corrected-reschedule",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            schedule
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["schedule_confirmed"],
      facts: { schedule },
    });
  });

  it("does not mistake quote expiry for an installation schedule", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "accepted-expiring-quote",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "We accept the quote. It is valid until July 21st."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      facts: { schedule: null },
    });
  });

  it.each([
    "Does installation start Monday?",
    "Installation starts Monday if the permit clears.",
  ])(
    "does not convert an interrogative or conditional schedule: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "unconfirmed-execution-schedule",
              "2026-07-20T18:00:00.000Z",
              "outbound",
              body
            ),
          ],
        })
      ).toBeNull();
    }
  );

  it("accepts an explicit installation schedule without an earlier acceptance phrase", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "installation-scheduled",
            "2026-07-20T18:00:00.000Z",
            "outbound",
            "Your railing installation is confirmed for Tuesday."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "won",
      decisiveSignals: ["schedule_confirmed"],
    });
  });

  it.each([
    "We cannot go ahead with the work.",
    "There is no go ahead for this project.",
    "Please do not send deposit instructions.",
    "No need to send payment details.",
    "The deposit has not been paid or received.",
    "No payment was received.",
    "No deposit has been paid.",
    "Installation is not confirmed or booked for Monday.",
    "No installation is scheduled for Monday.",
    "Nothing is booked for Tuesday; the project is still pending.",
    "We have not cancelled the project; the budget is ready.",
    "We didn't cancel the project.",
    "We never cancelled the project.",
    "We have not yet cancelled the project.",
    "Nothing is cancelled; the project is still on.",
    "Nothing has been postponed; the budget is approved for next year.",
    "We are not going with someone else.",
    "We haven't decided not to proceed.",
  ])("does not convert negated commitment language: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "negated-commitment",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    "Where do I send the deposit?",
    "How can I pay the deposit?",
    "Please provide the payment instructions.",
  ])(
    "treats an explicit deposit/payment-instructions request as commitment: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "deposit-instructions",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "won",
        signals: expect.arrayContaining(["deposit_requested"]),
      });
    }
  );

  it.each([
    "Please cancel the job. Do not proceed.",
    "Can you cancel the job?",
    "Would you cancel the job?",
    "Can we cancel the job?",
    "Could we cancel the job?",
    "Would it be possible to cancel the job?",
    "Would like to cancel the job.",
    "We decided not to move forward and hired someone else.",
    "We decline the proposal and no longer need the work.",
  ])(
    "lets a newer customer cancellation veto an older acceptance: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "older-acceptance",
              "2026-07-19T18:00:00.000Z",
              "inbound",
              "We accept the $1,200 installation. Please proceed."
            ),
            message(
              "newer-cancellation",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "declined",
        reasonCode: "customer_declined",
        decisiveMessageId: "newer-cancellation",
      });
    }
  );

  it.each([
    "If we cancel, is the deposit refundable?",
    "What happens if we cancel?",
    "Did we cancel the project?",
    "We might cancel the project if the permit fails.",
  ])("does not treat a hypothetical decline as authoritative: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "hypothetical-decline",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    "Please cancel Tuesday's site visit.",
    "We cancelled the installation date; please send new dates.",
    "I cancelled the payment method and need a new link.",
    "Please cancel the consultation appointment.",
    "I declined the calendar invitation.",
    "We cancelled the site visit and need a new date.",
    "We cancelled Tuesday but are still proceeding.",
    "We cancelled the cheque and sent an e-transfer instead.",
  ])(
    "does not treat an administrative cancellation as cancelling an accepted sale: %s",
    (body) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "accepted-sale",
              "2026-07-19T18:00:00.000Z",
              "inbound",
              "We accept the $1,200 installation quote. Please proceed."
            ),
            message(
              "administrative-cancellation",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              body
            ),
          ],
        })
      ).toMatchObject({
        outcome: "won",
        decisiveMessageId: "accepted-sale",
        decisiveSignals: ["explicit_acceptance"],
      });
    }
  );

  it("still recognizes an explicit sale decline after an appointment cancellation", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "accepted-before-decline",
            "2026-07-19T18:00:00.000Z",
            "inbound",
            "We accept the $1,200 installation quote. Please proceed."
          ),
          message(
            "appointment-and-sale-cancelled",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "I cancelled the appointment because we are not moving forward with the project."
          ),
        ],
      })
    ).toMatchObject({
      outcome: "declined",
      decisiveMessageId: "appointment-and-sale-cancelled",
      decisiveSignals: ["customer_declined"],
    });
  });

  it.each([
    "If the truck repair uses the budget, we may postpone until next year.",
    "We might defer the work until next year if cash gets tight.",
  ])("does not treat a hypothetical deferral as authoritative: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "hypothetical-deferral",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toBeNull();
  });

  it.each([
    "The repair used our budget. Please postpone this until next year.",
    "Truck repairs used the budget; we would like to postpone until next year.",
    "The repair consumed our funds. Would you defer the project until next year?",
    "Truck repairs used the budget. Would like to postpone until next year.",
    "Truck repairs used the budget. Can we postpone until next year?",
    "Truck repairs used the budget. Could we postpone until next year?",
    "Truck repairs used the budget. Would it be possible to postpone until next year?",
  ])("keeps a direct customer deferral request authoritative: %s", (body) => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "direct-deferral-request",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            body
          ),
        ],
      })
    ).toMatchObject({
      outcome: "deferred",
      followUpAt: "2027-07-20T18:00:00.000Z",
    });
  });

  it.each([
    {
      phrase: "Our repair budget is gone, so postpone this until next spring.",
      expected: "2027-03-01T18:00:00.000Z",
      expectedAction: "Follow up next spring.",
    },
    {
      phrase: "The repair budget is tied up, so wait until next summer.",
      expected: "2027-06-01T18:00:00.000Z",
      expectedAction: "Follow up next summer.",
    },
    {
      phrase:
        "Cash is tight after repairs; put this off until later this year.",
      expected: "2026-10-20T18:00:00.000Z",
      expectedAction: "Follow up later this year.",
    },
  ])(
    "maps an explicit timing phrase to its real follow-up: $phrase",
    (scenario) => {
      expect(
        detectCommercialOutcome({
          now: NOW,
          messages: [
            message(
              "specific-deferral",
              "2026-07-20T18:00:00.000Z",
              "inbound",
              scenario.phrase
            ),
          ],
        })
      ).toMatchObject({
        outcome: "deferred",
        followUpAt: scenario.expected,
        facts: { nextAction: scenario.expectedAction },
      });
    }
  );

  it.each([
    {
      name: "bare future month",
      occurredAt: "2026-07-20T18:00:00.000Z",
      phrase:
        "Truck repairs consumed the budget, so postpone the project until October.",
      expected: "2026-10-01T18:00:00.000Z",
      expectedAction: "Follow up in October.",
    },
    {
      name: "bare month rolls into the next year when this year's date passed",
      occurredAt: "2026-11-20T18:00:00.000Z",
      phrase: "The repair budget is gone, so wait until March.",
      expected: "2027-03-01T18:00:00.000Z",
      expectedAction: "Follow up in March.",
    },
    {
      name: "same bare month always resolves to a future occurrence",
      occurredAt: "2026-07-20T18:00:00.000Z",
      phrase: "Funds are tied up by repairs, so hold off until July.",
      expected: "2027-07-01T18:00:00.000Z",
      expectedAction: "Follow up in July.",
    },
    {
      name: "explicit month and year",
      occurredAt: "2026-07-20T18:00:00.000Z",
      phrase: "Cash is committed to repairs, so postpone until January 2028.",
      expected: "2028-01-01T18:00:00.000Z",
      expectedAction: "Follow up in January 2028.",
    },
    {
      name: "explicit future year",
      occurredAt: "2026-07-20T18:00:00.000Z",
      phrase: "The repair budget is spent, so put this off until 2028.",
      expected: "2028-01-01T18:00:00.000Z",
      expectedAction: "Follow up in 2028.",
    },
    {
      name: "named season",
      occurredAt: "2026-07-20T18:00:00.000Z",
      phrase: "Money is tight after repairs, so wait until fall.",
      expected: "2026-09-01T18:00:00.000Z",
      expectedAction: "Follow up in fall.",
    },
    {
      name: "relative word months",
      occurredAt: "2026-07-20T18:00:00.000Z",
      phrase: "The repair used our funds, so wait three months.",
      expected: "2026-10-20T18:00:00.000Z",
      expectedAction: "Follow up in three months.",
    },
    {
      name: "relative numeric months",
      occurredAt: "2026-07-20T18:00:00.000Z",
      phrase: "The truck repair took the budget, so postpone for 18 months.",
      expected: "2028-01-20T18:00:00.000Z",
      expectedAction: "Follow up in 18 months.",
    },
  ])(
    "resolves deterministic future deferral timing for $name",
    ({ occurredAt, phrase, expected, expectedAction }) => {
      const messages = [
        message("bounded-deferral", occurredAt, "inbound", phrase),
      ];
      const first = detectCommercialOutcome({
        now: new Date("2026-07-21T18:00:00.000Z"),
        messages,
      });
      const retry = detectCommercialOutcome({
        now: new Date("2029-01-01T00:00:00.000Z"),
        messages,
      });

      expect(first).toMatchObject({
        outcome: "deferred",
        followUpAt: expected,
        facts: { nextAction: expectedAction },
      });
      expect(retry?.followUpAt).toBe(first?.followUpAt);
    }
  );

  it("does not create a deferral from an explicit year that is not future to the evidence", () => {
    expect(
      detectCommercialOutcome({
        now: NOW,
        messages: [
          message(
            "stale-year",
            "2026-07-20T18:00:00.000Z",
            "inbound",
            "Truck repairs consumed the budget, so postpone this until 2024."
          ),
        ],
      })
    ).toBeNull();
  });

  it("uses post-acceptance price and scope revisions as current facts", () => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: [
        message(
          "accepted-original",
          "2026-07-18T18:00:00.000Z",
          "inbound",
          "We accept the $1,200 installation. Please proceed."
        ),
        message(
          "revised-current-scope",
          "2026-07-19T18:00:00.000Z",
          "outbound",
          "Current revised installation total is $1,275 with the added gate."
        ),
      ],
    });

    expect(result).toMatchObject({
      outcome: "won",
      decisiveMessageId: "accepted-original",
      evidenceMessageIds: ["accepted-original", "revised-current-scope"],
      facts: {
        currentPrice: 1275,
        currentScope: expect.stringMatching(/added gate/i),
      },
    });
  });

  it.each([
    {
      name: "a newer deferral supersedes an older acceptance",
      messages: [
        message(
          "precedence-old-win",
          "2026-06-01T18:00:00.000Z",
          "inbound",
          "We accept the quote. Please proceed."
        ),
        message(
          "precedence-new-deferral",
          "2026-07-01T18:00:00.000Z",
          "inbound",
          "Our budget was consumed by repairs. Put this off until next year."
        ),
      ],
      expectedOutcome: "deferred",
      decisiveMessageId: "precedence-new-deferral",
    },
    {
      name: "a newer acceptance supersedes an older deferral",
      messages: [
        message(
          "precedence-old-deferral",
          "2026-06-01T18:00:00.000Z",
          "inbound",
          "We cannot afford it right now. Let's wait until next year."
        ),
        message(
          "precedence-new-win",
          "2026-07-01T18:00:00.000Z",
          "inbound",
          "We found the funds. We accept the quote and are ready to proceed."
        ),
      ],
      expectedOutcome: "won",
      decisiveMessageId: "precedence-new-win",
    },
  ])("uses the newest decisive signal: $name", (scenario) => {
    const result = detectCommercialOutcome({
      now: NOW,
      messages: scenario.messages,
    });

    expect(result).toMatchObject({
      outcome: scenario.expectedOutcome,
      decisiveMessageId: scenario.decisiveMessageId,
    });
  });

  it("keeps mailbox-scoped evidence distinct when providers reuse a message id", () => {
    const older = message(
      "provider-reused-id",
      "2026-06-01T18:00:00.000Z",
      "inbound",
      "Our repair budget is gone, so postpone this until next year."
    );
    older.evidenceKey = "connection-a:event-1";
    const newer = message(
      "provider-reused-id",
      "2026-07-01T18:00:00.000Z",
      "inbound",
      "We found the funds. We accept the quote and are ready to proceed."
    );
    newer.evidenceKey = "connection-b:event-2";

    expect(
      detectCommercialOutcome({ now: NOW, messages: [older, newer] })
    ).toMatchObject({
      outcome: "won",
      decisiveEvidenceKey: "connection-b:event-2",
      signals: expect.arrayContaining(["explicit_acceptance"]),
    });
  });
});
