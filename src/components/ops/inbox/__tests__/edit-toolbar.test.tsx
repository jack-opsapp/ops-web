import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EditToolbar } from "../composer/edit-toolbar";

describe("<EditToolbar>", () => {
  it("renders the 'edited from Claude's draft' label", () => {
    render(
      <EditToolbar
        added={3}
        removed={1}
        onSeeChanges={() => {}}
        onRevert={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(
      screen.getByText(/edited from Claude'?s draft/i),
    ).toBeInTheDocument();
  });

  it("renders +added in olive and -removed in rose", () => {
    render(
      <EditToolbar
        added={4}
        removed={2}
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
});
