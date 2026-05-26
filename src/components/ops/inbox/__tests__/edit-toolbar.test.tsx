import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EditToolbar } from "../composer/edit-toolbar";

describe("<EditToolbar>", () => {
  it("renders 'edited from {Phase C}'s draft' with the source name in lavender", () => {
    render(
      <EditToolbar
        added={3}
        removed={1}
        source="claude"
        onSeeChanges={() => {}}
        onRevert={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByText(/edited from/i)).toBeInTheDocument();
    const phaseC = screen.getByText("Phase C");
    expect(phaseC.className).toMatch(/text-agent-hi/);
  });

  it("renders +added in olive and -removed in rose", () => {
    render(
      <EditToolbar
        added={4}
        removed={2}
        source="claude"
        onSeeChanges={() => {}}
        onRevert={() => {}}
        onRegenerate={() => {}}
      />,
    );
    const plus = screen.getByText(/^\+4$/);
    const minus = screen.getByText(/^−2$/);
    expect(plus.className).toMatch(/text-olive/);
    expect(minus.className).toMatch(/text-rose/);
  });

  it("fires onSeeChanges / onRevert / onRegenerate when their buttons click", () => {
    const onSeeChanges = vi.fn();
    const onRevert = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <EditToolbar
        added={1}
        removed={0}
        source="claude"
        onSeeChanges={onSeeChanges}
        onRevert={onRevert}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /See changes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Revert/i }));
    fireEvent.click(screen.getByRole("button", { name: /Regenerate/i }));
    expect(onSeeChanges).toHaveBeenCalled();
    expect(onRevert).toHaveBeenCalled();
    expect(onRegenerate).toHaveBeenCalled();
  });

  it("shows the source name as text-2 (neutral) for non-Phase-C sources", () => {
    render(
      <EditToolbar
        added={1}
        removed={0}
        source="gmail"
        onSeeChanges={() => {}}
        onRevert={() => {}}
        onRegenerate={() => {}}
      />,
    );
    const gmail = screen.getByText("Gmail");
    expect(gmail.className).toMatch(/text-text-2/);
  });
});
