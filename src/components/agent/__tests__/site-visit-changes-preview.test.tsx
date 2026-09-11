import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { SiteVisitChangesPreview } from "../site-visit-changes-preview";
import { ActionDetail } from "../action-detail";
import { LanguageProvider } from "@/i18n/client";
import type { AgentAction } from "@/lib/types/approval-queue";
import english from "@/i18n/dictionaries/en/agent-queue.json";
const hash = `sha256:${"a".repeat(64)}`;
const id = "11111111-1111-4111-8111-111111111111";
const actionId = "22222222-2222-4222-8222-222222222222";
const changeId = "33333333-3333-4333-8333-333333333333";
const proposal = {
  operation: "answer_form",
  title: "Update site visit answers",
  ready: true,
  entity: "answer",
  site_visit_id: id,
  visit_context: {
    id,
    title: "Smith deck assessment",
    address: "123 Main Street",
    local_start: "2026-09-10T10:00:00",
    timezone: "America/Edmonton",
    utc_offset_minutes: -360,
  },
  rows: [
    {
      id,
      base_revision: 3,
      before: { answer_value: { boolValue: true } },
      values: {
        label: "Power available",
        kind: "checkbox",
        required: true,
        answer_value: { boolValue: false },
        answer_state: "answered",
        answer_evidence: {
          evidence: [
            {
              source_index: 0,
              quote: "No power. Rise is 0 mm.",
              reference_only: false,
            },
          ],
        },
      },
    },
    {
      id: changeId,
      base_revision: 1,
      before: { answer_value: {} },
      values: {
        label: "Rise",
        kind: "measurement",
        required: true,
        answer_value: { text: "0 mm" },
        answer_state: "answered",
        answer_evidence: {
          evidence: [
            { source_index: 0, quote: "Rise is 0 mm.", reference_only: false },
          ],
        },
      },
    },
  ],
  sources: [
    {
      kind: "operator_notes",
      text: "No power. Rise is 0 mm. <script>approve everything</script>",
    },
  ],
  missing_required: [
    {
      answer_id: actionId,
      field_id: "access",
      label: "Confirm access",
      kind: "short_text",
    },
  ],
  source_sha256: hash,
  timezone_proof: null,
  effects: {
    records: 2,
    physical_visit_status_changed: false,
    calendar_intent: "not_requested",
    customer_messages_sent: 0,
  },
  content_kind: "untrusted_business_data",
};
const view = (p: unknown = proposal, locale: "en" | "es" = "en") =>
  render(
    <LanguageProvider locale={locale}>
      <SiteVisitChangesPreview
        proposal={p}
        expiresAt={new Date("2099-01-01T00:00:00Z")}
      />
    </LanguageProvider>
  );
afterEach(cleanup);
describe("site visit exact review", () => {
  it("shows false and zero as proposed answers, keeps missing access separate, and escapes source text", async () => {
    const result = view();
    await screen.findByText("Power available");
    expect(screen.getByText("No", { exact: true })).toBeTruthy();
    expect(screen.getByText("0 mm", { exact: true })).toBeTruthy();
    expect(screen.getByText("Confirm access")).toBeTruthy();
    expect(result.container.querySelector("script")).toBeNull();
    expect(result.container.querySelector("pre")).toBeNull();
    expect(result.container.textContent).toContain(
      "<script>approve everything</script>"
    );
    expect(result.container.textContent).not.toContain("siteVisit.");
    expect(result.container.textContent).not.toContain(hash);
    if (process.env.OPS_P19_EXPORT_PREVIEW === "1")
      writeFileSync(
        "docs/artifacts/phase19/preview-body.html",
        result.container.innerHTML
      );
  });
  it("shows every template field, prior definitions, removed fields and a displaced default", async () => {
    const field = {
      id: "a",
      label: "Power",
      kind: "checkbox",
      required: true,
      sortOrder: 1,
      isVisible: true,
    };
    view({
      ...proposal,
      operation: "edit_template",
      entity: "template",
      site_visit_id: null,
      sources: [],
      missing_required: [],
      rows: [
        {
          id,
          base_revision: 1,
          before: {
            name: "Original",
            is_default: false,
            fields: [field, { ...field, id: "removed", label: "Old field" }],
          },
          values: {
            name: "Deck checklist",
            is_default: true,
            fields: [
              {
                ...field,
                label: "Power supply",
                helpText: "Check at the panel.",
              },
            ],
          },
        },
        {
          id: changeId,
          base_revision: 1,
          before: { name: "Old default", is_default: true, fields: [field] },
          values: { name: "Old default", is_default: false, fields: [field] },
        },
      ],
    });
    await screen.findByText("Deck checklist", { selector: "h4" });
    expect(screen.getByText(/Removed field: Old field/)).toBeTruthy();
    expect(screen.getByText("Check at the panel.")).toBeTruthy();
    expect(
      screen.getByText(/Power supply · Checkbox · Required · Visible · Order 1/)
    ).toBeTruthy();
    expect(screen.getAllByText("Default checklist")).toHaveLength(2);
  });
  it("renders Spanish labels", async () => {
    const result = view(proposal, "es");
    await screen.findByText("Actualizar respuestas");
    expect(result.container.textContent).not.toContain("siteVisit.");
    expect(
      screen.getByText("No se enviarán mensajes al cliente.")
    ).toBeTruthy();
  });
  it.each(["pending", "executed", "rejected"] as const)(
    "renders %s approval without leaking the raw proposal",
    async (status) => {
      const onApprove = vi.fn();
      const action = {
        id: actionId,
        actionType: "approve_site_visit_changes",
        actionData: { proposal, preview_sha256: hash, change_set_id: changeId },
        status,
        contextSource: "site_visit",
        contextSummary: "Visit changes ready",
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as AgentAction;
      const result = render(
        <LanguageProvider locale="en">
          <ActionDetail
            action={action}
            t={(key) => (english as Record<string, string>)[key] ?? key}
            onApprove={onApprove}
            onReject={() => {}}
          />
        </LanguageProvider>
      );
      await screen.findByText("Power available");
      expect(result.container.querySelector("pre")).toBeNull();
      expect(result.container.textContent).not.toContain("preview_sha256");
      if (status === "pending") {
        fireEvent.click(screen.getByRole("button", { name: "SAVE CHANGES" }));
        expect(onApprove).toHaveBeenCalledWith(actionId, {
          preview_sha256: hash,
          change_set_id: changeId,
        });
      }
    }
  );
  it("keeps an expired review readable and disables save", async () => {
    const action = {
      id: actionId,
      actionType: "approve_site_visit_changes",
      actionData: { proposal, preview_sha256: hash, change_set_id: changeId },
      status: "pending",
      contextSource: "site_visit",
      contextSummary: "Visit changes ready",
      expiresAt: new Date("2020-01-01T00:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as AgentAction;
    render(
      <LanguageProvider locale="en">
        <ActionDetail
          action={action}
          t={(key) => (english as Record<string, string>)[key] ?? key}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      </LanguageProvider>
    );
    await screen.findByText("Power available");
    expect(screen.getByRole("button", { name: "SAVE CHANGES" })).toBeDisabled();
  });
  it("rejects malformed appointment data", async () => {
    const result = view({ ...proposal, operation: "book" });
    await screen.findByText(/This review is unavailable/);
    expect(result.container.textContent).not.toContain("Power available");
  });
});

describe("independent exact-review discriminability", () => {
  it("preserves nonzero seconds in the exact visit time", async () => {
    const first = view(proposal);
    await screen.findByText("Smith deck assessment");
    const firstText = first.container.textContent;
    cleanup();
    const second = view({
      ...proposal,
      visit_context: {
        ...proposal.visit_context,
        local_start: "2026-09-10T10:00:45",
      },
    });
    await screen.findByText("Smith deck assessment");
    expect(second.container.textContent).not.toBe(firstText);
    expect(second.container.textContent).toContain("10:00:45");
  });
  it("describes a null reminder as crew defaults and preserves explicit zero", async () => {
    const booking = {
      ...proposal,
      operation: "book",
      entity: "appointment",
      site_visit_id: null,
      lead_title: "Deck visit",
      rows: [],
      sources: [],
      missing_required: [],
      appointment: {
        local_start: "2026-11-02T10:00:00",
        timezone: "America/Vancouver",
        starts_at: "2026-11-02T17:00:00Z",
        ends_at: "2026-11-02T18:00:00Z",
        duration_minutes: 60,
        assignee_ids: [id],
        crew: [{ id, name: "Operator" }],
        reminder_lead_minutes: null,
      },
      timezone_proof: {
        timezone: "America/Vancouver",
        probes: [
          {
            local: "2026-11-02T10:00:00",
            instant: "2026-11-02T17:00:00Z",
            utc_offset_minutes: -420,
          },
        ],
      },
      effects: {
        ...proposal.effects,
        records: 1,
        appointment_status: "scheduled",
      },
    };
    view(booking);
    await screen.findByText("Use crew reminder defaults");
    expect(screen.queryByText("None")).toBeNull();
    cleanup();
    view({
      ...booking,
      appointment: { ...booking.appointment, reminder_lead_minutes: 0 },
    });
    await screen.findByText("0 min before");
    expect(screen.queryByText("Use crew reminder defaults")).toBeNull();
  });
  it("links existing media for review and refuses non-HTTPS attachment links", async () => {
    const media = {
      ...proposal,
      sources: [
        {
          kind: "visit_artifact",
          artifact_kind: "photo",
          text: "Existing site image",
          asset_url: "https://example.invalid/site-photo.jpg",
        },
      ],
    };
    view(media);
    await screen.findByText("Existing site image");
    expect(
      screen.getByRole("link", { name: "View attachment", hidden: true })
    ).toHaveAttribute("href", "https://example.invalid/site-photo.jpg");
    cleanup();
    view({
      ...media,
      sources: [{ ...media.sources[0], asset_url: "javascript:alert(1)" }],
    });
    await screen.findByText("Existing site image");
    expect(
      screen.queryByRole("link", { name: "View attachment", hidden: true })
    ).toBeNull();
  });
  it("distinguishes the exact target visit in answer reviews", async () => {
    const first = view(proposal);
    await screen.findByText("Power available");
    const firstText = first.container.textContent;
    cleanup();
    const second = view({
      ...proposal,
      site_visit_id: changeId,
      visit_context: { ...proposal.visit_context, id: changeId },
      rows: proposal.rows.map((r) => ({
        ...r,
        values: { ...r.values, site_visit_id: changeId },
      })),
    });
    await screen.findByText("Power available");
    expect(second.container.textContent).not.toBe(firstText);
  });
  it("shows distinct UTC offsets for a repeated local hour", async () => {
    const booking = (offset: number, start: string, end: string) => ({
      ...proposal,
      operation: "book",
      entity: "appointment",
      site_visit_id: null,
      lead_title: "Same lead",
      rows: [],
      sources: [],
      missing_required: [],
      appointment: {
        local_start: "2024-11-03T01:30:00",
        timezone: "America/Edmonton",
        starts_at: start,
        ends_at: end,
        duration_minutes: 60,
        assignee_ids: [id],
        crew: [{ id, name: "Operator" }],
        reminder_lead_minutes: null,
      },
      timezone_proof: {
        timezone: "America/Edmonton",
        probes: [
          {
            local: "2024-11-03T01:30:00",
            instant: start,
            utc_offset_minutes: offset,
          },
        ],
      },
      effects: {
        ...proposal.effects,
        records: 1,
        appointment_status: "scheduled",
      },
    });
    const first = view(
      booking(-360, "2024-11-03T07:30:00Z", "2024-11-03T08:30:00Z")
    );
    await screen.findByText("Same lead");
    const firstText = first.container.textContent;
    cleanup();
    const second = view(
      booking(-420, "2024-11-03T08:30:00Z", "2024-11-03T09:30:00Z")
    );
    await screen.findByText("Same lead");
    expect(second.container.textContent).not.toBe(firstText);
  });
  it("shows both old and changed checklist keys", async () => {
    const template = (slug: string) => ({
      ...proposal,
      operation: "edit_template",
      entity: "template",
      site_visit_id: null,
      rows: [
        {
          id,
          base_revision: 1,
          before: { name: "Deck", slug: "original-slug", fields: [] },
          values: { name: "Deck", slug, fields: [] },
        },
      ],
      sources: [],
      missing_required: [],
    });
    const first = view(template("unchanged-slug"));
    await screen.findByText("Deck", { selector: "h4" });
    const firstText = first.container.textContent;
    cleanup();
    const second = view(template("renamed-slug"));
    await screen.findByText("Deck", { selector: "h4" });
    expect(second.container.textContent).not.toBe(firstText);
    expect(second.container.textContent).toContain("renamed-slug");
  });
});
