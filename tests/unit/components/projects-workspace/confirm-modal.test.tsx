import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ConfirmModal } from "@/components/ops/projects/workspace/confirm-modal";

// `<ConfirmModal>` — workspace destructive confirmation dialog.
// Verifies the public API: open/close, confirm/cancel callbacks, and
// the destructive visual signals (rose accent stripe + destructive Btn).
//
// We don't assert on motion.div internals — the framer-motion runtime is
// tested upstream. We do check that the rose stripe class lands on the
// content surface so the destructive signal can't quietly disappear.

describe("<ConfirmModal>", () => {
  it("does not render anything when closed", () => {
    render(
      <ConfirmModal
        open={false}
        onOpenChange={() => {}}
        title="// ARCHIVE PROJECT"
        body="Test body"
        confirmLabel="ARCHIVE"
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByTestId("confirm-modal")).toBeNull();
    expect(screen.queryByText("ARCHIVE")).toBeNull();
  });

  it("renders the title, body, and both action buttons when open", () => {
    render(
      <ConfirmModal
        open
        onOpenChange={() => {}}
        title="// ARCHIVE PROJECT"
        body="Archived projects move to the archive view."
        confirmLabel="ARCHIVE"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
    expect(screen.getByText("// ARCHIVE PROJECT")).toBeInTheDocument();
    expect(
      screen.getByText("Archived projects move to the archive view."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("confirm-modal-cancel")).toHaveTextContent(
      "CANCEL",
    );
    expect(screen.getByTestId("confirm-modal-confirm")).toHaveTextContent(
      "ARCHIVE",
    );
  });

  it("calls onConfirm when the destructive button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        open
        onOpenChange={() => {}}
        title="// ARCHIVE PROJECT"
        body="Test body"
        confirmLabel="ARCHIVE"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-modal-confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onOpenChange(false) when CANCEL is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmModal
        open
        onOpenChange={onOpenChange}
        title="// ARCHIVE PROJECT"
        body="Test body"
        confirmLabel="ARCHIVE"
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-modal-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables the confirm button while a mutation is pending", () => {
    render(
      <ConfirmModal
        open
        onOpenChange={() => {}}
        title="// ARCHIVE PROJECT"
        body="Test body"
        confirmLabel="ARCHIVE"
        onConfirm={() => {}}
        isConfirming
      />,
    );
    expect(screen.getByTestId("confirm-modal-confirm")).toBeDisabled();
  });

  it("uses the destructive Btn variant + rose accent stripe", () => {
    render(
      <ConfirmModal
        open
        onOpenChange={() => {}}
        title="// ARCHIVE PROJECT"
        body="Test body"
        confirmLabel="ARCHIVE"
        onConfirm={() => {}}
      />,
    );
    const surface = screen.getByTestId("confirm-modal");
    // Rose stripe lives on the top border via border-t-[var(--rose)].
    expect(surface.className).toContain("border-t-[var(--rose)]");
    // Glass-dense + 12px modal radius — the workspace's stacked-glass voice.
    expect(surface.className).toContain("glass-dense");
    expect(surface.className).toContain("rounded-modal");

    // Destructive Btn lands the rose tone via border + text class.
    const confirm = screen.getByTestId("confirm-modal-confirm");
    expect(confirm.className).toContain("text-[var(--rose)]");
  });

  it("supports a custom cancelLabel", () => {
    render(
      <ConfirmModal
        open
        onOpenChange={() => {}}
        title="// DELETE INVOICE"
        body="Test body"
        confirmLabel="DELETE"
        cancelLabel="KEEP"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("confirm-modal-cancel")).toHaveTextContent(
      "KEEP",
    );
  });
});
