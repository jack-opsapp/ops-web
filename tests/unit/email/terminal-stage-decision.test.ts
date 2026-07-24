import { describe, expect, it } from "vitest";
import { detectTerminalStageFromMessages } from "@/lib/email/terminal-stage-decision";

describe("terminal-stage-decision", () => {
  it("detects a client acceptance reply after an estimate as likely won", () => {
    expect(
      detectTerminalStageFromMessages([
        {
          direction: "outbound",
          body: "Attached is the estimate for the deck resurfacing.",
        },
        {
          direction: "inbound",
          body: "Sounds Great! 4204 Springridge Cres. Thanks . 250 216 6119 Cell",
        },
      ])
    ).toEqual({ terminalFlag: "likely_won", stage: "won" });
  });

  it("detects an accepted reply when Gmail stores the prior estimate in the same inbound body", () => {
    expect(
      detectTerminalStageFromMessages([
        {
          direction: "inbound",
          body: [
            "Sounds Great! 4204 Springridge Cres. Thanks . 250 216 6119 Cell",
            "",
            "On Jun 22, Jackson wrote:",
            "For your deck, the carpentry + new vinyl estimate comes to roughly $8,064.",
            "",
            "On Jun 18, Liane wrote:",
            "Let me know if you need more info to get us a quote.",
          ].join("\n"),
        },
      ])
    ).toEqual({ terminalFlag: "likely_won", stage: "won" });
  });

  it("detects crew-arrival scheduling as likely won", () => {
    expect(
      detectTerminalStageFromMessages([
        {
          direction: "inbound",
          body: "What time will your crew arrive on Thursday?",
        },
      ])
    ).toEqual({ terminalFlag: "likely_won", stage: "won" });
  });

  it("does not treat polite positive language before a quote as won", () => {
    expect(
      detectTerminalStageFromMessages([
        {
          direction: "inbound",
          body: "Sounds great, please send an estimate when you can.",
        },
      ])
    ).toBeNull();
  });

  it.each([
    ["negated", "The estimate was not accepted."],
    ["tentative", "If the estimate is accepted, we can discuss scheduling."],
    ["reported", "Jake said the estimate was accepted."],
    ["example-only", 'Example only: "the estimate was accepted."'],
    ["example-only suffix", "This is an accepted estimate example only."],
    [
      "example-only object suffix",
      "The quote was accepted as an example only.",
    ],
    ["non-asserted", "I assume the estimate was accepted."],
  ])("does not treat %s acceptance language as won", (_kind, body) => {
    expect(
      detectTerminalStageFromMessages([
        {
          direction: "inbound",
          body,
        },
      ])
    ).toBeNull();
  });

  it.each([
    ["negated", "The crew is not scheduled to arrive Thursday."],
    ["tentative", "The crew might arrive Thursday if the quote is accepted."],
    ["reported", "Jake said the crew will arrive Thursday."],
    ["example-only", 'Example only: "the crew will arrive Thursday."'],
    ["non-asserted", "I assume the crew will arrive Thursday."],
  ])("does not treat %s scheduling language as won", (_kind, body) => {
    expect(
      detectTerminalStageFromMessages([
        {
          direction: "inbound",
          body,
        },
      ])
    ).toBeNull();
  });
});
