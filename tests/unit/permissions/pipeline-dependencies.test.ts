import { describe, expect, it } from "vitest";
import {
  buildEditablePermissionDesiredState,
  normalizePipelinePermissionEdits,
  validatePipelinePermissionDependencies,
  type PermissionEditState,
} from "@/lib/permissions/pipeline-dependencies";
import {
  computeOverrideMutation,
  diffAgainstRole,
} from "@/lib/permissions/resolve";

function edits(
  rows: Array<[string, "all" | "assigned" | "own", boolean]>
): Map<string, PermissionEditState> {
  return new Map(
    rows.map(([permission, scope, enabled]) => [
      permission,
      { permission, scope, enabled },
    ])
  );
}

describe("validatePipelinePermissionDependencies", () => {
  it("accepts independent action scopes when every prerequisite is met", () => {
    expect(
      validatePipelinePermissionDependencies([
        { permission: "pipeline.create", scope: "all" },
        { permission: "pipeline.view", scope: "all" },
        { permission: "pipeline.edit", scope: "assigned" },
        { permission: "pipeline.assign", scope: "assigned" },
        { permission: "pipeline.convert", scope: "assigned" },
      ])
    ).toEqual([]);
  });

  it("returns stable prerequisite issues regardless of input order", () => {
    const grants = [
      { permission: "pipeline.convert", scope: "all" },
      { permission: "pipeline.assign", scope: "all" },
      { permission: "pipeline.edit", scope: "assigned" },
      { permission: "pipeline.view", scope: "assigned" },
      { permission: "pipeline.create", scope: "all" },
    ] as const;

    const expected = [
      {
        code: "assign_exceeds_edit",
        permission: "pipeline.assign",
        dependency: "pipeline.edit",
        scope: "all",
        dependencyScope: "assigned",
      },
      {
        code: "convert_exceeds_edit",
        permission: "pipeline.convert",
        dependency: "pipeline.edit",
        scope: "all",
        dependencyScope: "assigned",
      },
    ];

    expect(validatePipelinePermissionDependencies(grants)).toEqual(expected);
    expect(
      validatePipelinePermissionDependencies([...grants].reverse())
    ).toEqual(expected);
  });

  it("rejects missing create/view prerequisites, duplicate grants, and unsupported scopes", () => {
    expect(
      validatePipelinePermissionDependencies([
        { permission: "pipeline.create", scope: "all" },
        { permission: "pipeline.edit", scope: "own" },
        { permission: "pipeline.view", scope: "assigned" },
        { permission: "pipeline.view", scope: "assigned" },
      ])
    ).toEqual([
      {
        code: "duplicate_permission",
        permission: "pipeline.view",
      },
      {
        code: "unsupported_scope",
        permission: "pipeline.edit",
        scope: "own",
      },
    ]);

    expect(
      validatePipelinePermissionDependencies([
        { permission: "pipeline.create", scope: "all" },
      ])
    ).toEqual([
      {
        code: "create_requires_view",
        permission: "pipeline.create",
        dependency: "pipeline.view",
        scope: "all",
        dependencyScope: null,
      },
    ]);
  });

  it("orders repeated malformed scopes deterministically", () => {
    const rows = [
      { permission: "pipeline.edit", scope: "own" },
      { permission: "pipeline.edit", scope: "none" },
    ];
    const expected = [
      { code: "duplicate_permission", permission: "pipeline.edit" },
      { code: "unsupported_scope", permission: "pipeline.edit", scope: "none" },
      { code: "unsupported_scope", permission: "pipeline.edit", scope: "own" },
    ];

    expect(validatePipelinePermissionDependencies(rows)).toEqual(expected);
    expect(validatePipelinePermissionDependencies([...rows].reverse())).toEqual(
      expected
    );
  });
});

describe("normalizePipelinePermissionEdits", () => {
  it("caps edit, assign, and convert to their prerequisite scope", () => {
    const input = edits([
      ["pipeline.create", "all", true],
      ["pipeline.view", "assigned", true],
      ["pipeline.edit", "all", true],
      ["pipeline.assign", "all", true],
      ["pipeline.convert", "all", true],
    ]);

    const result = normalizePipelinePermissionEdits(input);

    expect(result.get("pipeline.create")).toMatchObject({
      enabled: true,
      scope: "all",
    });
    expect(result.get("pipeline.view")).toMatchObject({
      enabled: true,
      scope: "assigned",
    });
    expect(result.get("pipeline.edit")).toMatchObject({
      enabled: true,
      scope: "assigned",
    });
    expect(result.get("pipeline.assign")).toMatchObject({
      enabled: true,
      scope: "assigned",
    });
    expect(result.get("pipeline.convert")).toMatchObject({
      enabled: true,
      scope: "assigned",
    });
    expect(input.get("pipeline.edit")?.scope).toBe("all");
  });

  it("removes dependent actions when view access is removed", () => {
    const result = normalizePipelinePermissionEdits(
      edits([
        ["pipeline.create", "all", true],
        ["pipeline.view", "all", false],
        ["pipeline.edit", "all", true],
        ["pipeline.assign", "all", true],
        ["pipeline.convert", "assigned", true],
      ])
    );

    for (const permission of [
      "pipeline.create",
      "pipeline.edit",
      "pipeline.assign",
      "pipeline.convert",
    ]) {
      expect(result.get(permission)?.enabled).toBe(false);
    }
  });

  it("never widens view or unrelated and hidden permissions", () => {
    const result = normalizePipelinePermissionEdits(
      edits([
        ["pipeline.view", "all", true],
        ["pipeline.edit", "assigned", true],
        ["pipeline.assign", "all", true],
        ["pipeline.convert", "all", true],
        ["pipeline.manage", "own", true],
        ["inbox.view", "own", true],
      ])
    );

    expect(result.get("pipeline.view")?.scope).toBe("all");
    expect(result.get("pipeline.assign")?.scope).toBe("assigned");
    expect(result.get("pipeline.convert")?.scope).toBe("assigned");
    expect(result.get("pipeline.manage")).toEqual({
      permission: "pipeline.manage",
      scope: "own",
      enabled: true,
    });
    expect(result.get("inbox.view")).toEqual({
      permission: "inbox.view",
      scope: "own",
      enabled: true,
    });
  });
});

describe("buildEditablePermissionDesiredState", () => {
  it("leaves stored hidden grants and revokes untouched during a visible edit", () => {
    const hidden = new Set(["pipeline.manage", "inbox.view_company"]);
    const desired = buildEditablePermissionDesiredState(
      edits([
        ["pipeline.manage", "all", true],
        ["inbox.view_company", "all", false],
        ["pipeline.view", "all", true],
        ["pipeline.edit", "assigned", true],
      ]),
      hidden
    );
    const diff = diffAgainstRole(
      [
        { permission: "pipeline.manage", scope: "all" },
        { permission: "inbox.view_company", scope: "all" },
        { permission: "pipeline.view", scope: "all" },
      ],
      desired
    );
    const mutation = computeOverrideMutation(
      [
        { permission: "pipeline.manage", scope: "all", granted: true },
        { permission: "inbox.view_company", scope: null, granted: false },
      ],
      diff
    );

    expect(mutation.set).toEqual([
      { permission: "pipeline.edit", scope: "assigned", granted: true },
    ]);
    expect(mutation.clear).toEqual([]);
    expect([
      ...mutation.set.map((entry) => entry.permission),
      ...mutation.clear,
    ]).not.toEqual(expect.arrayContaining([...hidden]));
  });
});
