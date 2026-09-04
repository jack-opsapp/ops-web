import { fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { describe, expect, it, vi } from "vitest";

import { PipelineDetailPhotosTab } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-photos-tab";
import type { OpportunityAssignedContextIntakeAttachment } from "@/lib/api/services/opportunity-assigned-context-service";
import type { Opportunity } from "@/lib/types/pipeline";

expect.extend(jestDomMatchers);

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
  useLocale: () => ({ locale: "en" }),
}));

vi.mock("@/lib/hooks", () => ({
  useOpportunityActivities: () => ({ data: [] }),
  useSiteVisits: () => ({ data: [] }),
  useAddOpportunityImages: () => ({ mutateAsync: vi.fn() }),
  useRemoveOpportunityImage: () => ({ mutate: vi.fn() }),
}));

const websitePhoto: OpportunityAssignedContextIntakeAttachment = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "jobsite.jpg",
  kind: "image",
  mimeType: "image/jpeg",
  sizeBytes: 1024,
  occurredAt: new Date("2026-07-26T22:00:00.000Z"),
  previewUrl:
    "/api/opportunities/22222222-2222-4222-8222-222222222222/intake-attachments/11111111-1111-4111-8111-111111111111?mode=preview",
  downloadUrl:
    "/api/opportunities/22222222-2222-4222-8222-222222222222/intake-attachments/11111111-1111-4111-8111-111111111111?mode=download",
};

describe("PipelineDetailPhotosTab website evidence", () => {
  it("uses the safe derivative in chronology with Website provenance", () => {
    const { container } = render(
      <PipelineDetailPhotosTab
        opportunity={
          {
            id: "22222222-2222-4222-8222-222222222222",
            companyId: "33333333-3333-4333-8333-333333333333",
            images: [],
          } as unknown as Opportunity
        }
        canManage={false}
        intakeAttachments={[websitePhoto]}
      />
    );

    expect(screen.getByText(/Website/)).toBeInTheDocument();
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", websitePhoto.previewUrl);
    expect(container.innerHTML).not.toContain("mode=download");
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();

    const photoTrigger = screen.getByRole("button", {
      name: /Open photo.*Website/,
    });
    photoTrigger.focus();
    fireEvent.click(photoTrigger);
    expect(
      screen.getByRole("dialog", { name: "Photo viewer" })
    ).toBeInTheDocument();
    const closeButton = screen.getByRole("button", { name: "Close photo" });
    expect(closeButton).toHaveClass("h-11", "w-11");
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Photo viewer" })
    ).not.toBeInTheDocument();
    expect(photoTrigger).toHaveFocus();
  });
});
