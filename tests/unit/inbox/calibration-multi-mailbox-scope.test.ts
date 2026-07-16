import { describe, expect, it } from "vitest";

import {
  aggregateCalibrationConnectionConfig,
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
        category_autonomy: { general: "auto_draft" },
      },
      sync_filters: { rules: [{ id: "a" }] },
    },
    {
      id: "company-microsoft",
      type: "company",
      user_id: null,
      status: "active",
      auto_send_settings: {
        category_autonomy: { client_followup: "auto_send" },
      },
      sync_filters: { rules: [{ id: "b" }, { id: "c" }] },
    },
    {
      id: "actor-personal",
      type: "individual",
      user_id: "actor-1",
      status: "active",
      auto_send_settings: {
        category_autonomy: { warranty_claim: "off" },
      },
      sync_filters: { rules: [] },
    },
    {
      id: "other-personal",
      type: "individual",
      user_id: "actor-2",
      status: "active",
      auto_send_settings: {
        category_autonomy: { vendor_ordering: "auto_send" },
      },
      sync_filters: { rules: [{ id: "secret" }] },
    },
    {
      id: "disabled-company",
      type: "company",
      user_id: null,
      status: "disconnected",
      auto_send_settings: {
        category_autonomy: { vendor_ordering: "auto_send" },
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
        general: "auto_draft",
        client_followup: "auto_send",
        warranty_claim: "off",
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
});
