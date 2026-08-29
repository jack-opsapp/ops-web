import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  LIST_WORK_QUEUE_CANDIDATE,
  WORK_QUEUE_AUTHORIZATION_VARIANT_KEYS,
  selectedWorkQueueVariantKeys,
} from "../work-queue";

describe("P2 work-queue candidate", () => {
  it("pins nine independent source authorization ceilings", () => {
    expect(WORK_QUEUE_AUTHORIZATION_VARIANT_KEYS).toEqual([
      "task",
      "lead",
      "correspondence",
      "commitment",
      "match_review",
      "schedule",
      "financial_document",
      "payment",
      "expense",
    ]);
    expect(
      LIST_WORK_QUEUE_CANDIDATE.authorization.variants.map((variant) => ({
        key: variant.key,
        scopes: variant.policy.requiredOAuthScopes,
      }))
    ).toEqual([
      { key: "task", scopes: ["ops.operations.read", "ops.tasks.read"] },
      { key: "lead", scopes: ["ops.jobs.read", "ops.operations.read"] },
      {
        key: "correspondence",
        scopes: ["ops.correspondence.read", "ops.operations.read"],
      },
      {
        key: "commitment",
        scopes: ["ops.correspondence.read", "ops.operations.read"],
      },
      {
        key: "match_review",
        scopes: ["ops.correspondence.read", "ops.operations.read"],
      },
      {
        key: "schedule",
        scopes: ["ops.operations.read", "ops.schedule.read"],
      },
      {
        key: "financial_document",
        scopes: ["ops.financial_documents.read", "ops.operations.read"],
      },
      { key: "payment", scopes: ["ops.operations.read", "ops.payments.read"] },
      { key: "expense", scopes: ["ops.expenses.read", "ops.operations.read"] },
    ]);
    expect(
      LIST_WORK_QUEUE_CANDIDATE.authorization.variants.map((variant) => ({
        key: variant.key,
        groups: variant.policy.permissionRequirementGroups.map((group) =>
          group.map((requirement) => [
            requirement.permission,
            requirement.allowedScopes,
          ])
        ),
      }))
    ).toEqual([
      {
        key: "task",
        groups: [
          [
            ["projects.view", ["all", "assigned"]],
            ["tasks.view", ["all", "assigned"]],
          ],
        ],
      },
      { key: "lead", groups: [[["pipeline.view", ["all", "assigned"]]]] },
      {
        key: "correspondence",
        groups: [
          [
            ["email.view", ["all", "own"]],
            ["inbox.view", ["all", "assigned", "own"]],
            ["pipeline.view", ["all", "assigned"]],
          ],
        ],
      },
      {
        key: "commitment",
        groups: [
          [
            ["email.view", ["all", "own"]],
            ["inbox.view", ["all", "assigned", "own"]],
            ["pipeline.view", ["all", "assigned"]],
          ],
        ],
      },
      {
        key: "match_review",
        groups: [
          [
            ["email.view", ["all", "own"]],
            ["inbox.view", ["all", "assigned", "own"]],
            ["pipeline.view", ["all", "assigned"]],
            ["projects.view", ["all", "assigned"]],
          ],
        ],
      },
      {
        key: "schedule",
        groups: [
          [
            ["calendar.view", ["all", "own"]],
            ["projects.view", ["all", "assigned"]],
            ["tasks.view", ["all", "assigned"]],
          ],
        ],
      },
      {
        key: "financial_document",
        groups: [
          [
            ["estimates.view", ["all", "assigned"]],
            ["invoices.view", ["all", "assigned"]],
            ["pipeline.view", ["all", "assigned"]],
            ["projects.view", ["all", "assigned"]],
            ["projects.view_financials", ["all"]],
          ],
        ],
      },
      {
        key: "payment",
        groups: [
          [
            ["finances.view", ["all"]],
            ["invoices.view", ["all", "assigned"]],
            ["pipeline.view", ["all", "assigned"]],
            ["projects.view", ["all", "assigned"]],
          ],
        ],
      },
      {
        key: "expense",
        groups: [
          [
            ["expenses.approve", ["all", "assigned"]],
            ["expenses.view", ["all"]],
          ],
          [["expenses.view", ["all", "own"]]],
        ],
      },
    ]);
  });

  it("selects defaults and explicit subsets without widening", () => {
    expect(selectedWorkQueueVariantKeys({})).toEqual(
      WORK_QUEUE_AUTHORIZATION_VARIANT_KEYS
    );
    expect(
      selectedWorkQueueVariantKeys({ sources: ["expense", "task"] })
    ).toEqual(["task", "expense"]);
  });

  it("stays dark, immutable, read-only, and bounded", () => {
    expect(LIST_WORK_QUEUE_CANDIDATE).toMatchObject({
      name: "list_work_queue",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      riskTier: "high",
      bounds: { maxResultItems: 25, maxOutputCharacters: 60_000 },
      availability: { implementation: "available" },
      rolloutFlag: "agent_control_plane.capability.list_work_queue",
    });
    expect(Object.isFrozen(LIST_WORK_QUEUE_CANDIDATE)).toBe(true);
    expect(
      CAPABILITY_MANIFEST.find((entry) => entry.name === "list_work_queue")
    ).toBe(LIST_WORK_QUEUE_CANDIDATE);
  });
});
