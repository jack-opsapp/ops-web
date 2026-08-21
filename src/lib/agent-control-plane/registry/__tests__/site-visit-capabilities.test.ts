import { describe, expect, it } from "vitest";

import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
  getCapabilityManifestEntry,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";

const SITE_VISIT_CAPABILITIES = [
  ["list_site_visits", "read"],
  ["get_site_visit_context", "read"],
  ["prepare_site_visit_booking", "prepare"],
  ["commit_site_visit_booking", "commit"],
  ["prepare_site_visit_reschedule", "prepare"],
  ["commit_site_visit_reschedule", "commit"],
  ["prepare_site_visit_booking_cancellation", "prepare"],
  ["commit_site_visit_booking_cancellation", "commit"],
] as const;

const IDEMPOTENCY_KEY = "request-00000001";
const SOURCE_EVIDENCE_IDS = ["evidence-site-visit-1"];

function policyShape(name: string) {
  return getCapabilityManifestEntry(name).authorization.variants.map(
    (variant) => ({
      key: variant.key,
      oauth: variant.policy.requiredOAuthScopes,
      permissions: variant.policy.permissionRequirementGroups.map((group) =>
        group.map(
          (requirement) =>
            `${requirement.permission}:${requirement.allowedScopes.join(",")}`
        )
      ),
    })
  );
}

describe("site-visit capability boundary", () => {
  it("advances the immutable manifest identity and registers only dark capabilities", () => {
    expect(CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-20.capability-manifest.v7"
    );

    expect(
      CAPABILITY_MANIFEST.filter((entry) =>
        SITE_VISIT_CAPABILITIES.some(([name]) => name === entry.name)
      ).map((entry) => [entry.name, entry.operation])
    ).toEqual(SITE_VISIT_CAPABILITIES);

    for (const [name] of SITE_VISIT_CAPABILITIES) {
      expect(getCapabilityManifestEntry(name).availability).toEqual({
        implementation: "unavailable",
        externalExposure: "disabled",
      });
    }
  });

  it("never exposes the device-owned capture lifecycle or raw booking RPC names", () => {
    const names = CAPABILITY_MANIFEST.map((entry) => entry.name);
    for (const name of names) {
      expect(name).not.toMatch(
        /(?:^|_)(?:start_site_visit|complete_site_visit|site_visit_start|site_visit_complete)(?:_|$)/
      );
    }
    for (const prohibited of [
      "start_site_visit",
      "complete_site_visit",
      "complete_site_visit_guarded",
      "book_site_visit",
      "reschedule_site_visit",
      "cancel_site_visit_booking",
    ]) {
      expect(names).not.toContain(prohibited);
    }
  });

  it("locks soft-delete and legacy-schedule exclusions into the read contract", () => {
    expect(getCapabilityManifestEntry("list_site_visits").description).toBe(
      "Return non-deleted booked appointments or visit history. Booked mode requires booked_at and defaults to active visits. History uses created_at, never legacy scheduled_at."
    );
    expect(
      getCapabilityManifestEntry("get_site_visit_context").description
    ).toBe(
      "Return one non-deleted visit's lead, booking, checklist, review-ready artifact, evidence, and timeline context. Excludes deleted satellites."
    );
  });

  it("requires callers to distinguish booked appointments from capture history", () => {
    const schema = getCapabilityManifestEntry("list_site_visits").inputSchema;
    const window = {
      from: "2026-08-10T00:00:00Z",
      to: "2026-08-24T00:00:00Z",
    };

    expect(
      schema.safeParse({ view: "booked_appointments", ...window }).success
    ).toBe(true);
    expect(
      resolveCapabilityAuthorization("list_site_visits", {
        view: "booked_appointments",
        ...window,
      }).parsedInput.statuses
    ).toEqual(["scheduled", "in_progress"]);
    expect(
      schema.safeParse({
        view: "booked_appointments",
        ...window,
        statuses: ["cancelled"],
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        view: "visit_history",
        created_from: window.from,
        created_to: window.to,
      }).success
    ).toBe(true);
    expect(schema.safeParse(window).success).toBe(false);
    expect(
      schema.safeParse({
        view: "booked_appointments",
        ...window,
        booked: false,
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        view: "booked_appointments",
        from: "2026-01-01T00:00:00Z",
        to: "2026-04-02T00:00:01Z",
      }).success
    ).toBe(false);
  });

  it("keeps context bounded to review-safe artifact metadata", () => {
    const schema = getCapabilityManifestEntry(
      "get_site_visit_context"
    ).inputSchema;

    expect(
      schema.safeParse({
        anchor: "opportunity",
        opportunity_ref: { kind: "opportunity", id: "opportunity-1" },
        site_visit_id: "site-visit-1",
        artifact_evidence_limit: 20,
        timeline_activity_limit: 20,
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        anchor: "opportunity",
        opportunity_ref: { kind: "opportunity", id: "opportunity-1" },
        site_visit_id: "site-visit-1",
        include_asset_urls: true,
      }).success
    ).toBe(false);
  });

  it("locks reads to existing least-privilege scopes and granular permissions", () => {
    expect(policyShape("list_site_visits")).toEqual([
      {
        key: "booked_appointments",
        oauth: ["ops.customers.read", "ops.jobs.read", "ops.schedule.read"],
        permissions: [
          [
            "calendar.view:all,own",
            "clients.view:all,assigned",
            "pipeline.view:all,assigned",
          ],
        ],
      },
      {
        key: "visit_history",
        oauth: ["ops.customers.read", "ops.jobs.read", "ops.schedule.read"],
        permissions: [
          [
            "calendar.view:all,own",
            "clients.view:all,assigned",
            "pipeline.view:all,assigned",
          ],
        ],
      },
      {
        key: "unlinked_history",
        oauth: ["ops.jobs.read"],
        permissions: [["pipeline.view:all"]],
      },
    ]);
    expect(policyShape("get_site_visit_context")).toEqual([
      {
        key: "opportunity",
        oauth: [
          "ops.customers.read",
          "ops.jobs.read",
          "ops.photos.read",
          "ops.schedule.read",
        ],
        permissions: [
          [
            "calendar.view:all,own",
            "clients.view:all,assigned",
            "photos.view:all,assigned",
            "pipeline.view:all,assigned",
          ],
        ],
      },
      {
        key: "unlinked",
        oauth: ["ops.jobs.read", "ops.photos.read"],
        permissions: [["photos.view:all", "pipeline.view:all"]],
      },
    ]);
  });

  it("adds all-scope authorization whenever unlinked visit history is requested", () => {
    const booked = resolveCapabilityAuthorization("list_site_visits", {
      view: "booked_appointments",
      from: "2026-08-10T00:00:00Z",
      to: "2026-08-24T00:00:00Z",
    });
    const linkedHistory = resolveCapabilityAuthorization("list_site_visits", {
      view: "visit_history",
      created_from: "2026-08-10T00:00:00Z",
      created_to: "2026-08-24T00:00:00Z",
    });
    const unlinkedHistory = resolveCapabilityAuthorization("list_site_visits", {
      view: "visit_history",
      created_from: "2026-08-10T00:00:00Z",
      created_to: "2026-08-24T00:00:00Z",
      include_unlinked: true,
    });

    expect(booked.variants.map((variant) => variant.key)).toEqual([
      "booked_appointments",
    ]);
    expect(linkedHistory.variants.map((variant) => variant.key)).toEqual([
      "visit_history",
    ]);
    expect(unlinkedHistory.variants.map((variant) => variant.key)).toEqual([
      "visit_history",
      "unlinked_history",
    ]);
    expect(
      unlinkedHistory.variants[1].policy.permissionRequirementGroups
    ).toEqual([
      [
        {
          permission: "pipeline.view",
          allowedScopes: ["all"],
        },
      ],
    ]);
  });

  it("requires all-scope authorization for unlinked visit context", () => {
    const linked = resolveCapabilityAuthorization("get_site_visit_context", {
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: "opportunity-1" },
      site_visit_id: "site-visit-1",
    });
    const unlinked = resolveCapabilityAuthorization("get_site_visit_context", {
      anchor: "unlinked",
      site_visit_id: "site-visit-1",
    });

    expect(linked.variants.map((variant) => variant.key)).toEqual([
      "opportunity",
    ]);
    expect(unlinked.variants.map((variant) => variant.key)).toEqual([
      "unlinked",
    ]);
    expect(unlinked.variants[0].policy.permissionRequirementGroups).toEqual([
      [
        { permission: "photos.view", allowedScopes: ["all"] },
        { permission: "pipeline.view", allowedScopes: ["all"] },
      ],
    ]);
  });

  it("requires pipeline.convert plus existing prepare and write consent scopes", () => {
    for (const name of [
      "prepare_site_visit_booking",
      "prepare_site_visit_reschedule",
      "prepare_site_visit_booking_cancellation",
    ]) {
      expect(policyShape(name)).toEqual([
        {
          key: name.replace("prepare_", ""),
          oauth: ["ops.jobs.prepare", "ops.schedule.prepare"],
          permissions: [["pipeline.convert:all,assigned"]],
        },
      ]);
    }

    for (const name of [
      "commit_site_visit_booking",
      "commit_site_visit_reschedule",
      "commit_site_visit_booking_cancellation",
    ]) {
      expect(policyShape(name)).toEqual([
        {
          key: name.replace("commit_", ""),
          oauth: ["ops.jobs.write", "ops.schedule.write"],
          permissions: [["pipeline.convert:all,assigned"]],
        },
      ]);
    }
  });

  it("requires bounded appointment values and idempotency with optional evidence", () => {
    const bookingStart = {
      utc: "2026-08-12T17:00:00Z",
      local: "2026-08-12T10:00:00",
      timezone: "America/Vancouver",
    };
    const rescheduleStart = {
      utc: "2026-08-13T17:00:00Z",
      local: "2026-08-13T10:00:00",
      timezone: "America/Vancouver",
    };
    const booking = {
      opportunity_ref: { kind: "opportunity", id: "opportunity-1" },
      scheduled_start: bookingStart,
      duration_minutes: 60,
      assignee_ids: ["actor-1"],
      reminder_lead_minutes: 30,
      source_evidence_ids: SOURCE_EVIDENCE_IDS,
      idempotency_key: IDEMPOTENCY_KEY,
    };
    const reschedule = {
      site_visit_id: "site-visit-1",
      scheduled_start: rescheduleStart,
      duration_minutes: 90,
      assignee_ids: ["actor-1"],
      reminder_lead_minutes: null,
      source_evidence_ids: SOURCE_EVIDENCE_IDS,
      idempotency_key: IDEMPOTENCY_KEY,
    };
    const cancellation = {
      site_visit_id: "site-visit-1",
      source_evidence_ids: SOURCE_EVIDENCE_IDS,
      idempotency_key: IDEMPOTENCY_KEY,
    };

    expect(
      getCapabilityManifestEntry(
        "prepare_site_visit_booking"
      ).inputSchema.safeParse(booking).success
    ).toBe(true);
    expect(
      getCapabilityManifestEntry(
        "prepare_site_visit_reschedule"
      ).inputSchema.safeParse(reschedule).success
    ).toBe(true);
    expect(
      getCapabilityManifestEntry(
        "prepare_site_visit_booking_cancellation"
      ).inputSchema.safeParse(cancellation).success
    ).toBe(true);

    expect(
      getCapabilityManifestEntry(
        "prepare_site_visit_booking"
      ).inputSchema.safeParse({ ...booking, duration_minutes: 481 }).success
    ).toBe(false);
    expect(
      getCapabilityManifestEntry(
        "prepare_site_visit_booking"
      ).inputSchema.safeParse({ ...booking, reminder_lead_minutes: 1_441 })
        .success
    ).toBe(false);
    expect(
      getCapabilityManifestEntry(
        "prepare_site_visit_reschedule"
      ).inputSchema.safeParse({
        ...reschedule,
        assignee_ids: ["actor-1", "actor-1"],
      }).success
    ).toBe(false);
    expect(
      getCapabilityManifestEntry(
        "prepare_site_visit_booking_cancellation"
      ).inputSchema.safeParse({
        ...cancellation,
        idempotency_key: undefined,
      }).success
    ).toBe(false);
    expect(
      getCapabilityManifestEntry(
        "prepare_site_visit_booking_cancellation"
      ).inputSchema.safeParse({
        ...cancellation,
        source_evidence_ids: ["evidence-1", "evidence-1"],
      }).success
    ).toBe(false);
  });

  it("marks every booking commit as confirmed, destructive, and open-world", () => {
    for (const [prepareName, commitName] of [
      ["prepare_site_visit_booking", "commit_site_visit_booking"],
      ["prepare_site_visit_reschedule", "commit_site_visit_reschedule"],
      [
        "prepare_site_visit_booking_cancellation",
        "commit_site_visit_booking_cancellation",
      ],
    ] as const) {
      const prepare = getCapabilityManifestEntry(prepareName);
      const commit = getCapabilityManifestEntry(commitName);
      expect(prepare.confirmationPolicy).toEqual({
        kind: "change_set_preview",
        exactPreviewRequired: true,
        expires: true,
      });
      expect(commit.confirmationPolicy).toEqual({
        kind: "confirmation_receipt",
        prepareCapability: prepareName,
        exactPreviewRequired: true,
        singleUse: true,
      });
      expect(commit.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
      expect(commit.auditClass).toBe("external_commit");
    }
  });
});
