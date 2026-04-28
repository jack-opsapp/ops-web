import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CampaignSankeyChart } from "@/components/admin/email/campaign-sankey-chart";

describe("CampaignSankeyChart", () => {
  it("renders empty state when fewer than 2 stages", () => {
    const { getByText } = render(<CampaignSankeyChart stages={[]} />);
    expect(getByText(/NO FUNNEL DATA YET/)).toBeTruthy();
  });

  it("renders empty state with one stage", () => {
    const { getByText } = render(
      <CampaignSankeyChart stages={[{ stage: "enqueued", value: 5 }]} />
    );
    expect(getByText(/NO FUNNEL DATA YET/)).toBeTruthy();
  });
});
