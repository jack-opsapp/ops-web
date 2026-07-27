import { render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { describe, expect, it, vi } from "vitest";

import { PipelineDetailFilesTab } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-files-tab";
import type { OpportunityAssignedContextIntakeAttachment } from "@/lib/api/services/opportunity-assigned-context-service";

expect.extend(jestDomMatchers);

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
  useLocale: () => ({ locale: "en" }),
}));

const attachments: OpportunityAssignedContextIntakeAttachment[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    filename: "site-plan.pdf",
    kind: "document",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    occurredAt: new Date("2026-07-26T22:00:00.000Z"),
    previewUrl: null,
    downloadUrl:
      "/api/opportunities/22222222-2222-4222-8222-222222222222/intake-attachments/11111111-1111-4111-8111-111111111111?mode=download",
  },
];

describe("PipelineDetailFilesTab", () => {
  it("renders a compact trusted website-file register", () => {
    render(<PipelineDetailFilesTab attachments={attachments} />);

    expect(screen.getByText("site-plan.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Website/)).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download site-plan.pdf" })
    ).toHaveAttribute("href", attachments[0].downloadUrl);
    expect(document.body.textContent).not.toContain("accepted-original");
    expect(document.body.textContent).not.toContain("object_version");
  });
});
