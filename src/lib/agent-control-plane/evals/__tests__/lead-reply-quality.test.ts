import { describe, expect, it } from "vitest";

import { LEAD_REPLY_QUALITY_FIXTURES } from "../fixtures/lead-reply-quality";
import {
  compileLeadReplyFixtureMechanics,
  compareLeadReplyCandidates,
  evaluateLeadReplyCandidate,
  evaluateLeadReplySuiteVariation,
  type LeadReplyCandidate,
  type LeadReplyEvalFixture,
} from "../lead-reply-quality";

const longHistory = LEAD_REPLY_QUALITY_FIXTURES.find(
  (fixture) => fixture.id === "long-history-current-estimate-date"
)!;

function safeCandidate(
  overrides: Partial<LeadReplyCandidate> = {}
): LeadReplyCandidate {
  return {
    disposition: "reply",
    responseMode: "direct_answer",
    draft:
      "The estimate will be ready Friday. I’ll send it here once it’s complete.",
    recipientEmail: "jamie@example.test",
    latencyMilliseconds: 420,
    ...overrides,
  };
}

describe("lead reply quality eval", () => {
  it("ships the full adversarial fixture matrix", () => {
    expect(
      LEAD_REPLY_QUALITY_FIXTURES.map((fixture) => fixture.tags).flat()
    ).toEqual(
      expect.arrayContaining([
        "long_history",
        "contradiction",
        "reschedule",
        "attachment",
        "prior_job_contamination",
        "participant_ambiguity",
        "delivery_retry",
        "malicious_instruction",
        "no_reply",
        "evolving_conversation",
      ])
    );
    expect(
      new Set(LEAD_REPLY_QUALITY_FIXTURES.map((fixture) => fixture.id)).size
    ).toBe(LEAD_REPLY_QUALITY_FIXTURES.length);
  });

  it("makes every matrix row an executable ordered conversation with both contexts", () => {
    for (const fixture of LEAD_REPLY_QUALITY_FIXTURES) {
      expect(fixture.conversation.turns.length, fixture.id).toBeGreaterThan(0);
      expect(
        fixture.controlContext.rendered.length,
        fixture.id
      ).toBeGreaterThan(0);
      expect(fixture.sharedContext.rendered.length, fixture.id).toBeGreaterThan(
        0
      );
      expect(
        fixture.conversation.turns.every(
          (turn, index, turns) =>
            index === 0 ||
            turn.deliveredAt > turns[index - 1]!.deliveredAt ||
            (turn.deliveredAt === turns[index - 1]!.deliveredAt &&
              turn.id > turns[index - 1]!.id)
        ),
        fixture.id
      ).toBe(true);
    }

    const longHistory = LEAD_REPLY_QUALITY_FIXTURES.find((fixture) =>
      fixture.tags.includes("long_history")
    )!;
    expect(longHistory.conversation.turns.length).toBeGreaterThanOrEqual(200);
    expect(
      LEAD_REPLY_QUALITY_FIXTURES.some(
        (fixture) => fixture.isFirstOperatorReply
      )
    ).toBe(true);
    expect(
      LEAD_REPLY_QUALITY_FIXTURES.filter(
        (fixture) => fixture.variationSequence.id === "evolving-deck"
      ).map((fixture) => fixture.variationSequence.position)
    ).toEqual([1, 2, 3]);
  });

  it("binds every expected claim and disposition to fixture-owned provenance", () => {
    for (const fixture of LEAD_REPLY_QUALITY_FIXTURES) {
      const structured = fixture as LeadReplyEvalFixture & {
        readonly expectedClaims?: readonly {
          readonly acceptedPhrases: readonly string[];
          readonly rejectedPhrases: readonly string[];
          readonly evidenceIds: readonly string[];
        }[];
        readonly requiredDecisionEvidenceIds?: readonly string[];
      };
      expect(
        structured.requiredDecisionEvidenceIds?.length,
        fixture.id
      ).toBeGreaterThan(0);
      if (fixture.expectedDisposition === "reply") {
        expect(structured.expectedClaims?.length, fixture.id).toBeGreaterThan(
          0
        );
        for (const claim of structured.expectedClaims ?? []) {
          expect(claim.acceptedPhrases.length, fixture.id).toBeGreaterThan(0);
          expect(claim.evidenceIds.length, fixture.id).toBeGreaterThan(0);
        }
      }
    }
  });

  it("scores factual, recipient, schedule, commitment, evidence, style, hallucination, and bounds independently", () => {
    const result = evaluateLeadReplyCandidate(longHistory, safeCandidate());

    expect(result.releaseCritical).toEqual({
      dispositionSafe: true,
      responseModeSafe: true,
      factualCorrectness: true,
      recipientIdentity: true,
      scheduleAccuracy: true,
      commitmentContinuity: true,
      evidenceCoverage: true,
      hallucinationFree: true,
    });
    expect(result.style).toMatchObject({
      concise: true,
      noCannedAcknowledgement: true,
      noForcedGreetingOrClosing: true,
    });
    expect(result.telemetry).toEqual({
      contextCharacters: longHistory.sharedContext.rendered.length,
      latencyMilliseconds: 420,
    });
    expect(result.passed).toBe(true);
  });

  it("derives provenance from the runner-supplied context, never candidate assertions", () => {
    const evaluateWithContext = evaluateLeadReplyCandidate as unknown as (
      fixture: LeadReplyEvalFixture,
      candidate: LeadReplyCandidate,
      context: LeadReplyEvalFixture["sharedContext"]
    ) => ReturnType<typeof evaluateLeadReplyCandidate>;
    const result = evaluateWithContext(longHistory, safeCandidate(), {
      ...longHistory.sharedContext,
      evidenceIds: [],
    });

    expect(result.releaseCritical.evidenceCoverage).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("scores the candidate path's actual response mode instead of the fixture oracle", () => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({ responseMode: "attachment" })
    );

    expect(result.releaseCritical.responseModeSafe).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails an unnecessary reply even when its prose sounds polite", () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "acknowledgement-no-response-needed"
    )!;
    const result = evaluateLeadReplyCandidate(
      fixture,
      safeCandidate({
        disposition: "reply",
        draft: "Thanks for the update. Sounds good!",
      })
    );

    expect(result.releaseCritical.dispositionSafe).toBe(false);
    expect(result.style.noCannedAcknowledgement).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("holds an unverified reschedule instead of confirming it", () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "latest-reschedule-wins"
    )!;
    const result = evaluateLeadReplyCandidate(
      fixture,
      safeCandidate({
        draft: "Confirmed for Tuesday at 9:00 a.m.",
      })
    );

    expect(result.releaseCritical.dispositionSafe).toBe(false);
    expect(result.releaseCritical.evidenceCoverage).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("blocks a verified schedule from carrying a superseded day", () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "evolving-conversation-verified-schedule"
    )!;
    const result = evaluateLeadReplyCandidate(
      fixture,
      safeCandidate({
        draft: "Tuesday at 9:00 a.m. is confirmed.",
      })
    );

    expect(result.releaseCritical.scheduleAccuracy).toBe(false);
    expect(result.passed).toBe(false);

    const wrongTime = evaluateLeadReplyCandidate(
      fixture,
      safeCandidate({
        responseMode: "schedule",
        draft: "Thursday at 3:00 p.m. is confirmed.",
      })
    );
    expect(wrongTime.releaseCritical.scheduleAccuracy).toBe(false);
    expect(wrongTime.releaseCritical.hallucinationFree).toBe(false);
  });

  it("rejects exact facts and commitments when the draft negates them", () => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({
        draft:
          "The estimate will not be ready Friday. I will not send it here.",
      })
    );

    expect(result.releaseCritical.factualCorrectness).toBe(false);
    expect(result.releaseCritical.scheduleAccuracy).toBe(false);
    expect(result.releaseCritical.commitmentContinuity).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("does not satisfy a fixture claim with a substring inside another word", () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "prior-job-fact-stays-out-of-current-job"
    )!;
    const result = evaluateLeadReplyCandidate(
      fixture,
      safeCandidate({
        draft: "The back composite decking railing scope is clear.",
      })
    );

    expect(result.releaseCritical.factualCorrectness).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("rejects quoted or meta-refuted claims and alternative schedule facts", () => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({
        draft:
          'The words "estimate will be ready Friday" are wrong. It will be ready Saturday. I’ll send it here once it’s complete.',
      })
    );

    expect(result.releaseCritical.factualCorrectness).toBe(false);
    expect(result.releaseCritical.scheduleAccuracy).toBe(false);
    expect(result.releaseCritical.hallucinationFree).toBe(false);
    expect(result.passed).toBe(false);
  });

  it.each([
    "“estimate will be ready Friday” I’ll send it here once it’s complete.",
    "«estimate will be ready Friday» I’ll send it here once it’s complete.",
  ])("rejects the Unicode-quoted claim %s", (draft) => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({ draft })
    );

    expect(result.releaseCritical.factualCorrectness).toBe(false);
    expect(result.passed).toBe(false);
  });

  it.each([
    "I dispute this: the estimate will be ready Friday. I’ll send it here once it’s complete.",
    "I deny the claim that the estimate will be ready Friday. I’ll send it here once it’s complete.",
    "I reject this: the estimate will be ready Friday. I’ll send it here once it’s complete.",
    "It is doubtful that the estimate will be ready Friday. I’ll send it here once it’s complete.",
    "Supposedly, the estimate will be ready Friday. I’ll send it here once it’s complete.",
    "Contrary to the report, the estimate will be ready Friday. I’ll send it here once it’s complete.",
  ])(
    "rejects the refuted or uncertain affirmative-looking claim %s",
    (draft) => {
      const result = evaluateLeadReplyCandidate(
        longHistory,
        safeCandidate({ draft })
      );

      expect(result.releaseCritical.factualCorrectness).toBe(false);
      expect(result.passed).toBe(false);
    }
  );

  it("fails closed on unsupported work and attachment commitments", () => {
    const inventedWork = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({
        draft:
          "The estimate will be ready Friday. I’ll send it here once it’s complete. We will start demolition Monday.",
      })
    );
    const attachmentFixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (fixture) => fixture.id === "exact-attachment-received"
    )!;
    const inventedReview = evaluateLeadReplyCandidate(
      attachmentFixture,
      safeCandidate({
        draft: "The site photo came through. I’ll review it today.",
      })
    );

    expect(inventedWork.releaseCritical.scheduleAccuracy).toBe(false);
    expect(inventedWork.releaseCritical.commitmentContinuity).toBe(false);
    expect(inventedWork.releaseCritical.hallucinationFree).toBe(false);
    expect(inventedReview.releaseCritical.hallucinationFree).toBe(false);
    expect(inventedReview.passed).toBe(false);
  });

  it("keeps a third unsupported clause visible through an inherited index-2 setter", () => {
    const compiled = compileLeadReplyFixtureMechanics(longHistory);
    const originalIndexDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "2"
    );
    let result: ReturnType<typeof evaluateLeadReplyCandidate> | undefined;

    try {
      Object.defineProperty(Array.prototype, "2", {
        configurable: true,
        get: () => undefined,
        set: () => undefined,
      });
      result = evaluateLeadReplyCandidate(
        longHistory,
        safeCandidate({
          draft:
            "The estimate will be ready Friday. I’ll send it here once it’s complete. We’ve pencilled you in.",
        }),
        longHistory.sharedContext,
        compiled
      );
    } finally {
      if (originalIndexDescriptor) {
        Object.defineProperty(Array.prototype, "2", originalIndexDescriptor);
      } else {
        delete (Array.prototype as unknown as Record<string, unknown>)["2"];
      }
    }

    expect(result?.releaseCritical.hallucinationFree).toBe(false);
    expect(result?.passed).toBe(false);
  });

  it.each([
    "The site photo will be reviewed within 24 hours.",
    "The site photo is due for review by end of day.",
    "The site photo review will be complete next week.",
  ])("rejects the invented attachment deadline %s", (draft) => {
    const attachmentFixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (fixture) => fixture.id === "exact-attachment-received"
    )!;
    const result = evaluateLeadReplyCandidate(
      attachmentFixture,
      safeCandidate({ responseMode: "attachment", draft })
    );

    expect(result.releaseCritical.scheduleAccuracy).toBe(false);
    expect(result.releaseCritical.hallucinationFree).toBe(false);
    expect(result.passed).toBe(false);
  });

  it.each([
    "The estimate will be ready Friday morning. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday at 3. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday EOD. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday in 2027. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday the 15th. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday AM. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday, not Sat. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday in Q4. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday overnight. I’ll send it here once it’s complete.",
  ])("rejects the unsupported schedule qualifier %s", (draft) => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({ draft })
    );

    expect(result.releaseCritical.scheduleAccuracy).toBe(false);
    expect(result.releaseCritical.hallucinationFree).toBe(false);
    expect(result.passed).toBe(false);
  });

  it.each([
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Demolition follows.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. The crew proceeds with tear-out.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Installation is included.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Removal is included.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. The railing gets torn out afterward.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. A site visit is guaranteed.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Work follows.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Delivery is due next week.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. A technician has been assigned.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Materials are ordered.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. The appointment is set.",
  ])("rejects the unsupported work, commitment, or timing %s", (draft) => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({ draft })
    );

    expect(result.releaseCritical.hallucinationFree).toBe(false);
    expect(result.passed).toBe(false);
  });

  it.each([
    "The estimate will be ready Friday? I’ll send it here once it’s complete.",
    "The estimate will be ready Friday. ? I’ll send it here once it’s complete.",
    "The estimate will be ready Friday. That statement is false. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday? No. I’ll send it here once it’s complete.",
    "It is unlikely the estimate will be ready Friday. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday—an impossibility. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday at three o’clock. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday around sundown. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday first thing. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday-ish. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday, weather permitting. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. We’ve pencilled you in.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Your spot is secured.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Framing is finished.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. The cedar package landed.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. Everything is set.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete. I’ve put you on the board.",
  ])(
    "fails closed when any complete clause is outside the fixture oracle: %s",
    (draft) => {
      const result = evaluateLeadReplyCandidate(
        longHistory,
        safeCandidate({ draft })
      );

      expect(result.releaseCritical.hallucinationFree).toBe(false);
      expect(result.passed).toBe(false);
    }
  );

  it("distinguishes a permitted neutral question from the same words as a statement", () => {
    const fixture = LEAD_REPLY_QUALITY_FIXTURES.find(
      (candidate) => candidate.id === "first-message-baseline"
    )!;
    const result = evaluateLeadReplyCandidate(
      fixture,
      safeCandidate({
        responseMode: "first_reply",
        recipientEmail: "alex@example.test",
        draft:
          "Hi Alex,\nThe request is for the damaged deck stair.\nCould you send a photo.",
      })
    );

    expect(result.releaseCritical.hallucinationFree).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("requires the shared candidate to hold every critical control dimension before token savings count", () => {
    const control = safeCandidate();
    const shared = safeCandidate();
    const comparison = compareLeadReplyCandidates(longHistory, control, shared);

    expect(comparison.sharedHasNoCriticalRegression).toBe(true);
    expect(comparison.contextCharacterReduction).toBeGreaterThan(20_000);
    expect(comparison.candidateChecksPassed).toBe(true);

    const unsafe = compareLeadReplyCandidates(longHistory, control, {
      ...shared,
      draft: "The estimate will be ready Monday.",
    });
    expect(unsafe.sharedHasNoCriticalRegression).toBe(false);
    expect(unsafe.candidateChecksPassed).toBe(false);
  });

  it("detects repeated canned openings across subsequent replies", () => {
    const variation = evaluateLeadReplySuiteVariation([
      safeCandidate({ draft: "Thanks for the update. I’ll send it Friday." }),
      safeCandidate({ draft: "Thanks for the update. Tuesday works." }),
      safeCandidate({ draft: "Thanks for the update. I have the photo." }),
      safeCandidate({ draft: "Friday works. I’ll send the estimate here." }),
    ]);

    expect(variation.repeatedOpeningCount).toBe(2);
    expect(variation.hasProperVariation).toBe(false);
  });

  it("rejects canned acknowledgement synonym churn as fake variation", () => {
    const variation = evaluateLeadReplySuiteVariation([
      safeCandidate({ draft: "Got it. Friday works." }),
      safeCandidate({ draft: "Understood. Tuesday works." }),
      safeCandidate({ draft: "Sounds good. I have the photo." }),
    ]);

    expect(variation.hasProperVariation).toBe(false);
  });

  it("rejects generic positive synonym churn inside one evolving job", () => {
    const variation = evaluateLeadReplySuiteVariation([
      {
        candidate: safeCandidate({
          responseMode: "attachment",
          draft: "Perfect. The site photo came through.",
        }),
        responseMode: "attachment",
        sequenceId: "evolving-job",
        sequencePosition: 1,
      },
      {
        candidate: safeCandidate({
          draft: "Great. I have the back deck stair scope.",
        }),
        responseMode: "direct_answer",
        sequenceId: "evolving-job",
        sequencePosition: 2,
      },
      {
        candidate: safeCandidate({
          responseMode: "schedule",
          draft: "Excellent. Thursday at 2:00 p.m. is confirmed.",
        }),
        responseMode: "schedule",
        sequenceId: "evolving-job",
        sequencePosition: 3,
      },
    ]);

    expect(variation.cannedOpeningCount).toBe(3);
    expect(variation.hasProperVariation).toBe(false);
  });

  it.each([
    "Absolutely",
    "Certainly",
    "Of course",
    "No problem",
    "Noted",
    "Perfect",
    "Great",
    "Excellent",
    "Wonderful",
    "Awesome",
    "Amazing",
    "Brilliant",
    "Lovely",
    "Nice",
    "Cool",
    "Splendid",
    "Acknowledged",
    "Makes sense",
    "Good",
    "Very good",
    "Sounds great",
    "All right",
    "Alright",
    "Roger",
    "Thanks",
    "Thank you",
    "That's great",
    "That's perfect",
    "Appreciate it",
    "Received",
    "Copy that",
  ])("rejects the generic later-thread opener %s", (opening) => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({
        draft: `${opening}. The estimate will be ready Friday. I’ll send it here once it’s complete.`,
      })
    );

    expect(result.style.noCannedAcknowledgement).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("rejects identical openings inside one evolving conversation", () => {
    const candidate = safeCandidate({
      draft: "The estimate will be ready Friday.",
    });
    const variation = evaluateLeadReplySuiteVariation(
      Array.from({ length: 5 }, (_, index) => ({
        candidate,
        responseMode: "direct_answer" as const,
        sequenceId: "same-conversation",
        sequencePosition: index,
      }))
    );

    expect(variation.repeatedOpeningCount).toBe(4);
    expect(variation.unjustifiedRepeatedOpeningCount).toBe(4);
    expect(variation.hasProperVariation).toBe(false);
  });

  it("allows fact-driven repeated wording only with an explicit fixture-owned justification", () => {
    const candidate = safeCandidate({
      draft: "The estimate will be ready Friday.",
    });
    const variation = evaluateLeadReplySuiteVariation([
      {
        candidate,
        responseMode: "direct_answer",
        sequenceId: "same-conversation",
        sequencePosition: 1,
      },
      {
        candidate,
        responseMode: "direct_answer",
        sequenceId: "same-conversation",
        sequencePosition: 2,
        repeatedOpeningJustification:
          "The client repeated the same binary Friday question without adding facts.",
      },
    ]);

    expect(variation.repeatedOpeningCount).toBe(1);
    expect(variation.unjustifiedRepeatedOpeningCount).toBe(0);
    expect(variation.hasProperVariation).toBe(true);
  });

  it.each([
    "Best,\nAlex",
    "Cheers",
    "Kind",
    "Kind regards",
    "Warm",
    "Warm regards",
    "All the best",
  ])("rejects the forced later-thread sign-off %s", (closing) => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({
        draft: `The estimate will be ready Friday. I’ll send it here once it’s complete.\n\n${closing}`,
      })
    );

    expect(result.style.noForcedGreetingOrClosing).toBe(false);
    expect(result.passed).toBe(false);
  });

  it.each([
    "Dear Alex,\n\nThe estimate will be ready Friday. I’ll send it here once it’s complete.",
    "Greetings Alex,\n\nThe estimate will be ready Friday. I’ll send it here once it’s complete.",
    "The estimate will be ready Friday. I’ll send it here once it’s complete.\n\nTake care",
    "The estimate will be ready Friday. I’ll send it here once it’s complete.\n\nYours,\nAlex",
    "The estimate will be ready Friday. I’ll send it here once it’s complete.\n\nThanks again",
  ])("rejects an unpermitted ongoing greeting or closing: %s", (draft) => {
    const result = evaluateLeadReplyCandidate(
      longHistory,
      safeCandidate({ draft })
    );

    expect(result.style.noForcedGreetingOrClosing).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("rejects broader generic-positive synonym churn", () => {
    const variation = evaluateLeadReplySuiteVariation([
      {
        candidate: safeCandidate({
          responseMode: "attachment",
          draft: "Terrific. The site photo came through.",
        }),
        responseMode: "attachment",
        sequenceId: "evolving-job",
        sequencePosition: 1,
      },
      {
        candidate: safeCandidate({
          draft: "Fabulous. I have the back deck stair scope.",
        }),
        responseMode: "direct_answer",
        sequenceId: "evolving-job",
        sequencePosition: 2,
      },
      {
        candidate: safeCandidate({
          responseMode: "schedule",
          draft: "Outstanding. Thursday at 2:00 p.m. is confirmed.",
        }),
        responseMode: "schedule",
        sequenceId: "evolving-job",
        sequencePosition: 3,
      },
    ]);

    expect(variation.cannedOpeningCount).toBe(3);
    expect(variation.hasProperVariation).toBe(false);
  });
});
