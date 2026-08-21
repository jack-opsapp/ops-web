import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The discard capture toast IS the undo toast: one surface that offers the
// ten reasons while the discard is still reversible. Its close callback is
// the "operator ignored it" signal, so it must fire exactly once no matter
// which way the toast leaves the screen — and never after a confirmed reason.

type CustomToastOptions = {
  id?: string | number;
  duration?: number;
  className?: string;
  title?: string;
  description?: string;
  onDismiss?: () => void;
  onAutoClose?: () => void;
};

const customToast = vi.fn(
  (_render: unknown, _options?: CustomToastOptions): string | number =>
    "toast-1"
);
const dismissToast = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: {
    custom: (...args: Parameters<typeof customToast>) => customToast(...args),
    dismiss: (id: string | number) => dismissToast(id),
  },
}));

const {
  DiscardFeedbackToastBody,
  DISCARD_REASON_ORDER,
  DISCARD_REASON_DICT_KEYS,
  showDiscardFeedbackToast,
  confirmDiscardFeedbackToast,
} = await import(
  "@/app/(dashboard)/pipeline/_components/discard-feedback-toast"
);

/** Mirrors the app's dictionary fallback behavior: key in, fallback out. */
const t = (key: string, fallback?: string) => fallback ?? key;

const baseBodyProps = {
  title: "Acme · $12,000",
  stateLine: "Negotiation → Discarded",
  t,
  onReason: () => {},
  onUndo: () => {},
  applying: false,
};

describe("<DiscardFeedbackToastBody> — pending capture", () => {
  it("renders all ten reasons in the locked frequency order", () => {
    render(
      <DiscardFeedbackToastBody {...baseBodyProps} state={{ kind: "pending" }} />
    );

    expect(DISCARD_REASON_ORDER).toEqual([
      "spam",
      "vendor_sales",
      "job_applicant",
      "platform_notification",
      "internal",
      "test_traffic",
      "duplicate",
      "not_a_fit",
      "created_by_error",
      "other",
    ]);

    const group = screen.getByRole("group", { name: "Discard reason" });
    const chips = within(group).getAllByRole("button");
    expect(chips).toHaveLength(10);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Spam",
      "Sales pitch",
      "Applicant",
      "Platform mail",
      "Internal",
      "Test",
      "Duplicate",
      "Not a fit",
      "Created by error",
      "Other",
    ]);
  });

  it("shows the title, state line, reason heading and an undo affordance", () => {
    render(
      <DiscardFeedbackToastBody {...baseBodyProps} state={{ kind: "pending" }} />
    );

    expect(screen.getByText("Acme · $12,000")).toBeInTheDocument();
    expect(screen.getByText("Negotiation → Discarded")).toBeInTheDocument();
    expect(screen.getByText("Reason — trains the filter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("reports the tapped reason code exactly once", async () => {
    const onReason = vi.fn();
    render(
      <DiscardFeedbackToastBody
        {...baseBodyProps}
        onReason={onReason}
        state={{ kind: "pending" }}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Sales pitch" }));

    expect(onReason).toHaveBeenCalledTimes(1);
    expect(onReason).toHaveBeenCalledWith("vendor_sales");
  });

  it("locks the rack while the apply is in flight", async () => {
    const onReason = vi.fn();
    render(
      <DiscardFeedbackToastBody
        {...baseBodyProps}
        applying
        onReason={onReason}
        state={{ kind: "pending" }}
      />
    );

    const chip = screen.getByRole("button", { name: "Spam" });
    expect(chip).toBeDisabled();
    await userEvent.click(chip, { pointerEventsCheck: 0 });
    expect(onReason).not.toHaveBeenCalled();
  });

  it("keeps a dictionary key for every reason in the order", () => {
    for (const code of DISCARD_REASON_ORDER) {
      expect(DISCARD_REASON_DICT_KEYS[code]).toMatch(
        /^discardFeedback\.reason\./
      );
    }
  });
});

describe("<DiscardFeedbackToastBody> — confirmed", () => {
  it("swaps the rack for the logged reason tag and the outcome line", () => {
    render(
      <DiscardFeedbackToastBody
        {...baseBodyProps}
        stateLine="Duplicate review — stays on board"
        state={{ kind: "confirmed", reasonLabel: "Duplicate" }}
      />
    );

    expect(screen.getByText("Reason logged")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(
      screen.getByText("Duplicate review — stays on board")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Discard reason" })
    ).not.toBeInTheDocument();
    // Undo is still the only action — now backed by the undo RPC.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});

describe("showDiscardFeedbackToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customToast.mockReturnValue("toast-1");
  });

  it("opens a 10s custom toast and returns its handle", () => {
    const handle = showDiscardFeedbackToast({
      title: "Acme",
      stateLine: "Negotiation → Discarded",
      t,
      onReason: vi.fn(),
      onUndo: vi.fn(),
      onClosedWithoutReason: vi.fn(),
    });

    expect(handle.toastId).toBe("toast-1");
    expect(customToast).toHaveBeenCalledTimes(1);
    expect(customToast.mock.calls[0]![1]!.duration).toBe(10_000);
  });

  it("fires onClosedWithoutReason once even when dismiss and auto-close both land", () => {
    const onClosedWithoutReason = vi.fn();
    showDiscardFeedbackToast({
      title: "Acme",
      stateLine: "Negotiation → Discarded",
      t,
      onReason: vi.fn(),
      onUndo: vi.fn(),
      onClosedWithoutReason,
    });

    const options = customToast.mock.calls[0]![1]!;
    options.onDismiss!();
    options.onAutoClose!();

    expect(onClosedWithoutReason).toHaveBeenCalledTimes(1);
  });

  it("never fires onClosedWithoutReason after the toast is confirmed", () => {
    const onClosedWithoutReason = vi.fn();
    const handle = showDiscardFeedbackToast({
      title: "Acme",
      stateLine: "Negotiation → Discarded",
      t,
      onReason: vi.fn(),
      onUndo: vi.fn(),
      onClosedWithoutReason,
    });

    confirmDiscardFeedbackToast(handle, {
      title: "Acme",
      stateLine: "Marked lost — disqualified",
      reasonLabel: "Not a fit",
      t,
      onUndo: vi.fn(),
    });

    customToast.mock.calls[0]![1]!.onAutoClose!();

    expect(onClosedWithoutReason).not.toHaveBeenCalled();
  });

  it("re-renders the same toast id with a fresh window when confirming", () => {
    const handle = showDiscardFeedbackToast({
      title: "Acme",
      stateLine: "Negotiation → Discarded",
      t,
      onReason: vi.fn(),
      onUndo: vi.fn(),
      onClosedWithoutReason: vi.fn(),
    });

    confirmDiscardFeedbackToast(handle, {
      title: "Acme",
      stateLine: "Sent to review — stays on board",
      reasonLabel: "Other",
      t,
      onUndo: vi.fn(),
    });

    expect(customToast).toHaveBeenCalledTimes(2);
    const options = customToast.mock.calls[1]![1]!;
    expect(options.id).toBe("toast-1");
    expect(options.duration).toBe(10_000);
  });

  // Sonner re-measures a toast's height only when `title`/`description`
  // change — never on `jsx`. It must be `description`: sonner's update path
  // rebuilds the toast as `{...prev, ...data, title: data.message}`, so a
  // `title` we pass is clobbered to undefined on every update. Without a
  // surviving phase key the confirmed toast keeps the nine-chip rack's height
  // and hangs ~109px of empty glass under a one-line confirmation (measured
  // live at 258.8px locked vs 149.6px natural before this guard existed).
  it("varies the unrendered description per phase so sonner re-measures the height", () => {
    const handle = showDiscardFeedbackToast({
      title: "Acme",
      stateLine: "Negotiation → Discarded",
      t,
      onReason: vi.fn(),
      onUndo: vi.fn(),
      onClosedWithoutReason: vi.fn(),
    });

    confirmDiscardFeedbackToast(handle, {
      title: "Acme",
      stateLine: "Marked lost — disqualified",
      reasonLabel: "Not a fit",
      t,
      onUndo: vi.fn(),
    });

    const pendingKey = customToast.mock.calls[0]![1]!.description;
    const confirmedKey = customToast.mock.calls[1]![1]!.description;

    expect(pendingKey).toBeTruthy();
    expect(confirmedKey).toBeTruthy();
    expect(confirmedKey).not.toBe(pendingKey);

    // `title` would be silently dropped by sonner's update merge, so it must
    // not be the carrier for the phase key.
    expect(customToast.mock.calls[1]![1]!.title).toBeUndefined();
  });
});
