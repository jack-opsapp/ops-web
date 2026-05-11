import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const setPreferenceMutateAsync = vi.fn();

vi.mock("@/lib/hooks/use-inbox-threads", () => ({
  useThreadActions: () => ({
    setWritebackPreference: { mutateAsync: setPreferenceMutateAsync },
  }),
}));

import { WritebackPreferenceModal } from "../writeback-preference-modal";

const noop = () => {};

describe("<WritebackPreferenceModal>", () => {
  beforeEach(() => {
    setPreferenceMutateAsync.mockReset();
    setPreferenceMutateAsync.mockResolvedValue(undefined);
  });

  it("renders the // WRITEBACK PREFERENCE slash title and instructional body", () => {
    render(
      <WritebackPreferenceModal
        open={true}
        onOpenChange={noop}
        connectionId="conn-1"
        onConfirmed={noop}
      />,
    );
    expect(screen.getByText("// WRITEBACK PREFERENCE")).toBeInTheDocument();
    expect(
      screen.getByText(
        /when you archive, what should happen in your connected inbox\?/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders all three options with tactical labels and bracketed body lines", () => {
    render(
      <WritebackPreferenceModal
        open={true}
        onOpenChange={noop}
        connectionId="conn-1"
        onConfirmed={noop}
      />,
    );
    expect(screen.getByText("ARCHIVE IN GMAIL/OUTLOOK")).toBeInTheDocument();
    expect(
      screen.getByText(/mark as read AND move to archive/i),
    ).toBeInTheDocument();
    expect(screen.getByText("MARK AS READ ONLY")).toBeInTheDocument();
    expect(screen.getByText(/mark as read, leave in inbox/i)).toBeInTheDocument();
    expect(screen.getByText("OPS-ONLY")).toBeInTheDocument();
    expect(
      screen.getByText(/no change to your connected inbox/i),
    ).toBeInTheDocument();
  });

  it("does not render captions like 'Recommended' / 'Safer for starters' / 'Maximum control'", () => {
    render(
      <WritebackPreferenceModal
        open={true}
        onOpenChange={noop}
        connectionId="conn-1"
        onConfirmed={noop}
      />,
    );
    expect(screen.queryByText(/Recommended/i)).toBeNull();
    expect(screen.queryByText(/Safer for starters/i)).toBeNull();
    expect(screen.queryByText(/Maximum control/i)).toBeNull();
  });

  it("renders NOT NOW + SAVE & ARCHIVE bare uppercase buttons", () => {
    render(
      <WritebackPreferenceModal
        open={true}
        onOpenChange={noop}
        connectionId="conn-1"
        onConfirmed={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /NOT NOW/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /SAVE & ARCHIVE/i }),
    ).toBeInTheDocument();
  });

  it("renders the 'learn more about writeback →' footer link", () => {
    render(
      <WritebackPreferenceModal
        open={true}
        onOpenChange={noop}
        connectionId="conn-1"
        onConfirmed={noop}
      />,
    );
    const link = screen.getByText(/learn more about writeback/i);
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe("A");
  });

  it("defaults to archive_in_gmail and persists that choice when SAVE & ARCHIVE clicked", async () => {
    const onConfirmed = vi.fn();
    render(
      <WritebackPreferenceModal
        open={true}
        onOpenChange={noop}
        connectionId="conn-1"
        onConfirmed={onConfirmed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /SAVE & ARCHIVE/i }));
    // wait microtask
    await Promise.resolve();
    await Promise.resolve();
    expect(setPreferenceMutateAsync).toHaveBeenCalledWith({
      connectionId: "conn-1",
      preference: "archive_in_gmail",
    });
  });

  it("clicking MARK AS READ ONLY updates selection and saves that preference", async () => {
    render(
      <WritebackPreferenceModal
        open={true}
        onOpenChange={noop}
        connectionId="conn-1"
        onConfirmed={noop}
      />,
    );
    fireEvent.click(screen.getByText("MARK AS READ ONLY"));
    fireEvent.click(screen.getByRole("button", { name: /SAVE & ARCHIVE/i }));
    await Promise.resolve();
    await Promise.resolve();
    expect(setPreferenceMutateAsync).toHaveBeenCalledWith({
      connectionId: "conn-1",
      preference: "mark_read_only",
    });
  });
});
