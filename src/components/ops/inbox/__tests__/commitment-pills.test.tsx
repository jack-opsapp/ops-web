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
});
