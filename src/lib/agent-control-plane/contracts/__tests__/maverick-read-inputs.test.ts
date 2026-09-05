import { describe, expect, it } from "vitest";
import { z } from "zod-v4";
import { GetTaskContextInputSchema, ListTasksInputSchema } from "../tasks";
import {
  GetSiteVisitContextInputSchema,
  ListSiteVisitsInputSchema,
} from "../site-visits";
import { GetIntegrationHealthInputSchema } from "../company-operations";
import { JobSummaryInputSchema } from "../job-catalog";
import { CustomerContextInputSchema } from "../customer-context";
import { P2CanonicalTimestampSchema } from "../p2-common";
import { getCustomerUpdateCapabilityManifestEntry } from "../../registry/capability-manifest";
const id = "d0000000-0000-4000-d000-00000000000e";
describe("Maverick ordinary read inputs", () => {
  it("canonicalizes selection order without removing duplicates or unknown values", () => {
    expect(
      GetTaskContextInputSchema.parse({
        task_ref: id,
        sections: ["schedule", "notes"],
      }).sections
    ).toEqual(["notes", "schedule"]);
    expect(
      GetIntegrationHealthInputSchema.parse({
        integrations: [
          { integration_type: "mailbox", provider: "gmail" },
          { integration_type: "accounting", provider: "sage" },
        ],
      }).integrations[0]!.provider
    ).toBe("sage");
    expect(
      GetSiteVisitContextInputSchema.parse({
        anchor: "opportunity",
        opportunity_ref: { kind: "opportunity", id },
        site_visit_ref: { kind: "site_visit", id },
        sections: ["timeline", "booking"],
      }).sections
    ).toEqual(["booking", "timeline"]);
    expect(
      GetIntegrationHealthInputSchema.safeParse({
        integrations: [
          { integration_type: "mailbox", provider: "gmail" },
          { integration_type: "mailbox", provider: "gmail" },
        ],
      }).success
    ).toBe(false);
    for (const sections of [
      ["notes", "notes"],
      ["notes", "permission_override"],
      [],
    ]) {
      expect(
        GetTaskContextInputSchema.safeParse({ task_ref: id, sections }).success
      ).toBe(false);
    }
  });
  it.each([
    "2026-09-07T07:00:00Z",
    "2026-09-07T07:00:00.0Z",
    "2026-09-07T07:00:00.00Z",
    "2026-09-07T07:00:00.000Z",
  ])("accepts UTC precision at the read boundary: %s", (from) => {
    const input = ListSiteVisitsInputSchema.parse({
      view: "booked_appointments",
      from,
      to: "2026-09-08T07:00:00Z",
    });
    expect(input.view === "booked_appointments" && input.from).toBe(
      "2026-09-07T07:00:00.000Z"
    );
    expect(
      ListTasksInputSchema.parse({
        view: {
          kind: "schedule_window",
          starts_at: from,
          ends_before: "2026-09-08T07:00:00Z",
        },
      }).view.kind
    ).toBe("schedule_window");
  });
  it.each([
    "2026-02-30T07:00:00Z",
    "2026-09-07T07:00:00",
    "2026-09-07T07:00:00-07:00",
    "2026-09-07T07:00:00.0001Z",
  ])("keeps invalid or non-UTC instants exact: %s", (from) => {
    expect(
      ListSiteVisitsInputSchema.safeParse({
        view: "booked_appointments",
        from,
        to: "2026-09-08T07:00:00Z",
      }).success
    ).toBe(false);
  });
  it("keeps canonical evidence timestamps and conditional authority selections strict", () => {
    expect(
      P2CanonicalTimestampSchema.safeParse("2026-09-07T07:00:00Z").success
    ).toBe(false);
    expect(
      JobSummaryInputSchema.safeParse({
        job_ref: { kind: "opportunity", id },
        sections: ["schedule"],
      }).success
    ).toBe(false);
    expect(
      JobSummaryInputSchema.safeParse({
        job_ref: { kind: "project", id },
        sections: ["financials"],
      }).success
    ).toBe(false);
    expect(
      CustomerContextInputSchema.safeParse({
        customer_ref: { kind: "client", id },
        sections: ["job_rollup"],
      }).success
    ).toBe(false);
  });
  it("advertises conditional selections in JSON input contracts", () => {
    const summary = JSON.stringify(
      z.toJSONSchema(
        getCustomerUpdateCapabilityManifestEntry("get_job_summary").inputSchema,
        { io: "input" }
      )
    );
    expect(
      JSON.stringify(
        z.toJSONSchema(
          getCustomerUpdateCapabilityManifestEntry("get_task_context")
            .inputSchema,
          { io: "input" }
        )
      )
    ).toContain("exclusive midnight");
    expect(summary).toContain("project only");
    expect(summary).toContain("Required exactly when");
    const customer = JSON.stringify(
      z.toJSONSchema(
        getCustomerUpdateCapabilityManifestEntry("get_customer_context")
          .inputSchema,
        { io: "input" }
      )
    );
    expect(customer).toContain("Required exactly when job_rollup");
  });
});
