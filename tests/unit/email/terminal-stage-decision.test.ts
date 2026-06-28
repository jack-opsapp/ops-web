import { describe, expect, it } from "vitest";
import {
  detectTerminalStageFromMessages,
  shouldAutoConvertLikelyWon,
} from "@/lib/email/terminal-stage-decision";

describe("terminal-stage-decision", () => {
  it("auto-converts likely-won active opportunities", () => {
    expect(
      shouldAutoConvertLikelyWon({
        terminalFlag: "likely_won",
        currentStage: "quoted",
        stageManuallySet: false,
      })
    ).toBe(true);
  });

  it("does not auto-convert likely-lost opportunities", () => {
    expect(
      shouldAutoConvertLikelyWon({
        terminalFlag: "likely_lost",
        currentStage: "quoted",
        stageManuallySet: false,
      })
    ).toBe(false);
  });

  it("respects manually set stages", () => {
    expect(
      shouldAutoConvertLikelyWon({
        terminalFlag: "likely_won",
        currentStage: "quoted",
        stageManuallySet: true,
      })
    ).toBe(false);
  });

  it("does not reconvert terminal opportunities", () => {
    for (const stage of ["won", "lost", "discarded"]) {
      expect(
        shouldAutoConvertLikelyWon({
          terminalFlag: "likely_won",
          currentStage: stage,
          stageManuallySet: false,
        })
      ).toBe(false);
    }
  });

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
});
