/**
 * Admin bug-report detail — ELEMENTS section (bug 1f2bf7e9).
 *
 * Drives the real `FeedbackContent` and expands a row, so the assertions
 * cover the path an admin actually takes. Crop thumbnails are presigned
 * through the existing admin screenshot route; `fetch` is the only mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { FeedbackContent } from "@/app/admin/feedback/_components/feedback-content";
import type { BugReportRow } from "@/lib/admin/types";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const REPORT_ID = "report-row-id";

function reference(overrides: Record<string, unknown> = {}) {
  return {
    id: "ref-1",
    label: "Save",
    role: "button",
    tag: "button",
    selector: 'button[data-testid="save-btn"]',
    classes: "px-2 py-1 rounded-chip",
    testId: "save-btn",
    text: "Save",
    rect: { x: 120.4, y: 240.6, width: 96, height: 32 },
    page: { x: 160, y: 540 },
    viewport: { width: 1440, height: 900 },
    componentChain: ["SaveButton", "SettingsPanel"],
    capturedAt: "2026-08-31T12:00:00.000Z",
    attachmentIndex: 0,
    ...overrides,
  };
}

function makeReport(overrides: Partial<BugReportRow> = {}): BugReportRow {
  return {
    id: REPORT_ID,
    company_id: COMPANY,
    reporter_id: "user-1",
    description: "The save button is misaligned",
    category: "ui_issue",
    platform: "web",
    status: "new",
    priority: "low",
    screen_name: "Settings",
    url: "https://app.opsapp.co/settings",
    browser: "Chrome",
    browser_version: "140",
    os_name: "macOS",
    os_version: "15",
    device_model: null,
    app_version: null,
    viewport_width: 1440,
    viewport_height: 900,
    network_type: "wifi",
    reporter_name: "Jackson Sweet",
    reporter_email: "j@example.com",
    screenshot_url: null,
    console_logs: null,
    breadcrumbs: null,
    state_snapshot: null,
    custom_metadata: null,
    additional_attachments: null,
    resolution_notes: null,
    resolved_at: null,
    created_at: "2026-08-31T12:00:00.000Z",
    company_name: "Canpro",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ url: `https://signed.example/${encodeURIComponent(url)}` }),
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function renderExpanded(report: BugReportRow) {
  render(<FeedbackContent featureRequests={[]} promoCodes={[]} bugReports={[report]} />);
  fireEvent.click(screen.getByRole("button", { name: report.description }));
}

describe("admin bug report detail — ELEMENTS", () => {
  it("renders every picked element with its identity, geometry and crop", async () => {
    const refs = [
      reference(),
      reference({
        id: "ref-2",
        label: "Industries",
        role: "generic",
        tag: "div",
        selector: "#settings-panel > div:nth-of-type(2)",
        classes: "grid grid-cols-3",
        testId: null,
        text: "Roofing Plumbing Electrical",
        rect: { x: 10, y: 20, width: 300, height: 120 },
        componentChain: [],
        attachmentIndex: 1,
      }),
    ];

    renderExpanded(
      makeReport({
        custom_metadata: { elementReferences: refs },
        additional_attachments: [
          `s3:bug-reports/${COMPANY}/${REPORT_ID}/element-0.png`,
          `s3:bug-reports/${COMPANY}/${REPORT_ID}/element-1.png`,
        ],
      })
    );

    expect(screen.getByText("ELEMENTS (2)")).toBeInTheDocument();

    // Identity
    expect(screen.getByText("button · Save")).toBeInTheDocument();
    expect(screen.getByText("generic · Industries")).toBeInTheDocument();
    expect(screen.getByText('button[data-testid="save-btn"]')).toBeInTheDocument();
    expect(
      screen.getByText("#settings-panel > div:nth-of-type(2)")
    ).toBeInTheDocument();
    expect(screen.getByText("px-2 py-1 rounded-chip")).toBeInTheDocument();
    expect(screen.getByText("Roofing Plumbing Electrical")).toBeInTheDocument();

    // Geometry, formatted
    expect(screen.getByText("120,241 · 96×32")).toBeInTheDocument();
    expect(screen.getByText("10,20 · 300×120")).toBeInTheDocument();

    // Component chain, joined — and the empty state is an em dash, not "N/A"
    expect(screen.getByText("SaveButton › SettingsPanel")).toBeInTheDocument();

    // Crops presigned through the admin screenshot route
    await waitFor(() => {
      const thumbs = document.querySelectorAll<HTMLImageElement>(
        "[data-element-crop-thumb]"
      );
      expect(thumbs).toHaveLength(2);
    });

    const requested = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(requested).toContain(
      `/api/admin/bug-reports/screenshot?path=${encodeURIComponent(
        `s3:bug-reports/${COMPANY}/${REPORT_ID}/element-0.png`
      )}`
    );
    expect(requested).toContain(
      `/api/admin/bug-reports/screenshot?path=${encodeURIComponent(
        `s3:bug-reports/${COMPANY}/${REPORT_ID}/element-1.png`
      )}`
    );
  });

  it("shows a placeholder when a reference produced no crop", async () => {
    renderExpanded(
      makeReport({
        custom_metadata: {
          elementReferences: [reference({ attachmentIndex: null, componentChain: [] })],
        },
        additional_attachments: null,
      })
    );

    expect(screen.getByText("ELEMENTS (1)")).toBeInTheDocument();
    expect(screen.getByText("[NO CROP]")).toBeInTheDocument();
    expect(document.querySelector("[data-element-crop-thumb]")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("omits the section entirely when no element was picked, leaving METADATA intact", () => {
    renderExpanded(
      makeReport({ custom_metadata: { submittedFrom: "bug-report-drawer" } })
    );

    expect(screen.queryByText(/^ELEMENTS/)).toBeNull();
    expect(screen.getByText("METADATA")).toBeInTheDocument();
    expect(screen.getByText(/"submittedFrom": "bug-report-drawer"/)).toBeInTheDocument();
  });

  it("ignores a malformed elementReferences payload", () => {
    renderExpanded(
      makeReport({
        custom_metadata: { elementReferences: ["not-an-object", 42, null] },
      })
    );

    expect(screen.queryByText(/^ELEMENTS/)).toBeNull();
  });
});
