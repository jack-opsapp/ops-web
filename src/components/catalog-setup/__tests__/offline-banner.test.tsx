import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfflineBanner } from "../offline-banner";

describe("OfflineBanner", () => {
  it("renders nothing when online", () => {
    const { container } = render(<OfflineBanner online />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states the offline hold (nothing lost) when offline", () => {
    render(<OfflineBanner online={false} />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/nothing's lost/i)).toBeInTheDocument();
  });

  it("uses tan (attention), never the accent", () => {
    render(<OfflineBanner online={false} />);
    const banner = screen.getByTestId("catalog-setup-offline-banner");
    expect(banner.className).toMatch(/border-tan/);
    expect(banner.className).not.toMatch(/ops-accent/);
  });
});
