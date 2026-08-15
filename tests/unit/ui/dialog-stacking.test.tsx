import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

describe("Dialog stacking", () => {
  it("keeps the scrim and content above the navigation layer", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Release check</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    const content = screen.getByRole("dialog", { name: "Release check" });
    const scrim = document.querySelector("[data-state='open'].fixed.inset-0");

    expect(scrim).not.toBeNull();
    expect(scrim).toHaveClass("z-modal");
    expect(content).toHaveClass("z-modal");
    expect(scrim).not.toHaveClass("z-50");
    expect(content).not.toHaveClass("z-50");
  });
});
