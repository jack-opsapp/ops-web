import { describe, expect, it } from "vitest";

import {
  aggregateCalibrationConnectionConfig,
  deriveCalibrationAutoSendLadder,
  mergeCalibrationMilestones,
  selectActorCalibrationConnections,
} from "@/lib/email/calibration-mailbox-scope";

describe("calibration multi-mailbox scope", () => {
  const connections = [
    {
      id: "company-gmail",
      type: "company",
      user_id: null,
      status: "active",
      auto_send_settings: {
        category_autonomy: {
          "primary:CUSTOMER": "auto_draft",
          client_new_inquiry: "auto_send",
        },
      },
      sync_filters: { rules: [{ id: "a" }] },
    },
    {
      id: "company-microsoft",
      type: "company",
      user_id: null,
      status: "active",
      auto_send_settings: {
        category_autonomy: { "primary:PLATFORM_BID": "auto_send" },
      },
      sync_filters: { rules: [{ id: "b" }, { id: "c" }] },
    },
    {
      id: "actor-personal",
      type: "individual",
      user_id: "  actor-1  ",
      status: "active",
      auto_send_settings: {
        category_autonomy: { "primary:VENDOR": "off" },
      },
      sync_filters: { rules: [] },
    },
    {
      id: "other-personal",
      type: "individual",
      user_id: "actor-2",
      status: "active",
      auto_send_settings: {
        category_autonomy: { "primary:SUBTRADE": "auto_send" },
      },
      sync_filters: { rules: [{ id: "secret" }] },
    },
    {
      id: "disabled-company",
      type: "company",
      user_id: null,
      status: "disconnected",
      auto_send_settings: {
        category_autonomy: { "primary:INTERNAL": "auto_send" },
      },
      sync_filters: { rules: [{ id: "stale" }] },
    },
  ];

  it("includes every active company mailbox and only the actor's personal mailbox", () => {
    expect(
      selectActorCalibrationConnections(connections, "actor-1", "all").map(
        (connection) => connection.id
      )
    ).toEqual(["company-gmail", "company-microsoft", "actor-personal"]);
  });

  it("aggregates configuration without exposing another user's personal mailbox", () => {
    const selected = selectActorCalibrationConnections(
      connections,
      "actor-1",
      "all"
    );

    expect(aggregateCalibrationConnectionConfig(selected)).toEqual({
      categoryLevels: ["auto_draft", "auto_send", "off"],
      categoryAutonomy: {
        CUSTOMER: "auto_draft",
        PLATFORM_BID: "auto_send",
        VENDOR: "off",
      },
      rulesCount: 3,
    });
  });

  it("includes shared mailbox configuration only when the actor can see a thread on it", () => {
    expect(
      selectActorCalibrationConnections(
        connections,
        "actor-1",
        new Set(["company-gmail"])
      ).map((connection) => connection.id)
    ).toEqual(["company-gmail", "actor-personal"]);
  });

  it("projects a milestone reached on any currently authorized mailbox", () => {
    expect(
      mergeCalibrationMilestones([
        {
          draft_available_shown: true,
          auto_draft_suggested: false,
          auto_send_suggested: false,
          comms_wizard_ready_shown: false,
        },
        {
          draft_available_shown: false,
          auto_draft_suggested: true,
          auto_send_suggested: false,
          comms_wizard_ready_shown: true,
        },
      ])
    ).toEqual({
      draft_available_shown: true,
      auto_draft_suggested: true,
      auto_send_suggested: false,
      comms_wizard_ready_shown: true,
    });
  });

  it("derives auto-send milestones from exact mailbox-category readiness", () => {
    const selected = selectActorCalibrationConnections(
      connections,
      "actor-1",
      "all"
    );

    expect(
      deriveCalibrationAutoSendLadder({
        connections: selected,
        featureEnabled: true,
        readiness: [
          {
            connectionId: "company-gmail",
            category: "CUSTOMER",
            ready: false,
            sampleSize: 19,
          },
          {
            connectionId: "company-microsoft",
            category: "PLATFORM_BID",
            ready: true,
            sampleSize: 20,
          },
        ],
      })
    ).toEqual({
      readinessStatus: "complete",
      activeStatus: "complete",
    });
  });

  it("does not activate a category from another mailbox or a disabled kill switch", () => {
    const selected = selectActorCalibrationConnections(
      connections,
      "actor-1",
      "all"
    );
    const readiness = [
      {
        connectionId: "company-gmail",
        category: "PLATFORM_BID" as const,
        ready: true,
        sampleSize: 20,
      },
    ];

    expect(
      deriveCalibrationAutoSendLadder({
        connections: selected,
        featureEnabled: true,
        readiness,
      })
    ).toEqual({
      readinessStatus: "complete",
      activeStatus: "gated",
    });
    expect(
      deriveCalibrationAutoSendLadder({
        connections: selected,
        featureEnabled: false,
        readiness,
      }).activeStatus
    ).toBe("gated");
  });
});
