import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CommitmentPills } from "../commitment-pills";

describe("<CommitmentPills>", () => {
  it("renders nothing when there are no commitments", () => {
    const { container } = render(
      <CommitmentPills commitments={[]} onResolve={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one pill per commitment with its content + due meta", () => {
    render(
      <CommitmentPills
        commitments={[
          {
            id: "m-1",
            content: "Confirm revised price by Friday",
            due: "FRI MAY 9",
            urgent: false,
          },
          {
            id: "m-2",
            content: "Send revised quote",
            due: "TODAY 17:00",
            urgent: true,
          },
        ]}
        onResolve={() => {}}
      />,
    );
    expect(screen.getAllByTestId("commitment-pill")).toHaveLength(2);
    expect(
      screen.getByText(/Confirm revised price by Friday/),
    ).toBeInTheDocument();
    expect(screen.getByText(/TODAY 17:00/)).toBeInTheDocument();
  });

  it("calls onResolve with the commitment id when ✓ is clicked", () => {
    const onResolve = vi.fn();
    render(
      <CommitmentPills
        commitments={[
          { id: "m-42", content: "X", due: "TODAY", urgent: false },
        ]}
        onResolve={onResolve}
      />,
    );
    screen.getByTestId("commitment-pill-resolve").click();
    expect(onResolve).toHaveBeenCalledWith("m-42");
  });

  it("disables the ✓ button when the id is in pendingResolveIds", () => {
    render(
      <CommitmentPills
        commitments={[{ id: "m-1", content: "X", due: "TODAY", urgent: false }]}
        onResolve={() => {}}
        pendingResolveIds={new Set(["m-1"])}
      />,
    );
    const btn = screen.getByTestId("commitment-pill-resolve") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("exposes the full commitment text via the pill's title attribute for hover-reveal when truncated", () => {
    const longContent =
      "Confirm Friday's roof inspection at 1234 Main Street Drive, " +
      "Suite 200, before EOD Tuesday with the updated scope and pricing";
    render(
      <CommitmentPills
        commitments={[
          { id: "m-long", content: longContent, due: "TUE", urgent: false },
        ]}
        onResolve={() => {}}
      />,
    );
    const pill = screen.getByTestId("commitment-pill");
    expect(pill.getAttribute("title")).toBe(longContent);
    const content = screen.getByTestId("commitment-pill-content");
    expect(content.className).toMatch(/\btruncate\b/);
    expect(content.textContent).toBe(longContent);
  });

  it("inner content span uses flex-1 + min-w-0 so it shrinks before the due-meta and ✓ button", () => {
    render(
      <CommitmentPills
        commitments={[
          { id: "m-1", content: "Short", due: "FRI", urgent: false },
        ]}
        onResolve={() => {}}
      />,
    );
    const content = screen.getByTestId("commitment-pill-content");
    expect(content.className).toMatch(/\bflex-1\b/);
    expect(content.className).toMatch(/\bmin-w-0\b/);
  });
});
