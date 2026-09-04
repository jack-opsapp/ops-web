import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  query: {
    data: undefined as
      | {
          businesses: Array<{ id: string; name: string }>;
          providerEnvironment: "production" | "sandbox";
        }
      | undefined,
    error: null as Error | null,
    isLoading: false,
  },
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/hooks/use-accounting", () => ({
  useSageBusinessSelectionSession: () => h.query,
  useSelectSageBusiness: () => ({ mutate: h.mutate, isPending: h.isPending }),
}));

import { SageBusinessSelectionModal } from "@/components/books/sync/sage-business-selection-modal";

function renderModal(
  props: Partial<React.ComponentProps<typeof SageBusinessSelectionModal>> = {}
) {
  const onClose = vi.fn();
  const onConnected = vi.fn();
  render(
    <SageBusinessSelectionModal
      open
      companyId="company-1"
      sessionId="session-1"
      onClose={onClose}
      onConnected={onConnected}
      {...props}
    />
  );
  return { onClose, onConnected };
}

afterEach(() => {
  h.query.data = undefined;
  h.query.error = null;
  h.query.isLoading = false;
  h.isPending = false;
  h.mutate.mockReset();
});

describe("SageBusinessSelectionModal", () => {
  it("reserves the modal body while eligible businesses load", () => {
    h.query.isLoading = true;
    renderModal();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("sync.sageBusiness.loading")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sync.sageBusiness.connect" })
    ).toBeDisabled();
  });

  it("reports an expired selection without exposing a dead submit action", () => {
    h.query.error = Object.assign(new Error("expired"), { status: 410 });
    renderModal();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "sync.sageBusiness.expired"
    );
    expect(
      screen.getByRole("button", { name: "sync.sageBusiness.connect" })
    ).toBeDisabled();
  });

  it("reports zero eligible businesses and keeps CONNECT disabled", () => {
    h.query.data = { businesses: [], providerEnvironment: "production" };
    renderModal();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "sync.sageBusiness.empty"
    );
    expect(
      screen.getByRole("button", { name: "sync.sageBusiness.connect" })
    ).toBeDisabled();
  });

  it("preselects the sole defensive choice and identifies a sandbox", () => {
    h.query.data = {
      businesses: [{ id: "biz-a", name: "OPS Test Ledger" }],
      providerEnvironment: "sandbox",
    };
    renderModal();

    expect(
      screen.getByRole("radio", { name: "OPS Test Ledger" })
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("sync.sageBusiness.sandbox")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sync.sageBusiness.connect" })
    ).toBeEnabled();
  });

  it("requires a deliberate choice when Sage returns multiple businesses", async () => {
    const user = userEvent.setup();
    h.query.data = {
      businesses: [
        { id: "biz-a", name: "North Ledger" },
        { id: "biz-b", name: "South Ledger" },
      ],
      providerEnvironment: "production",
    };
    renderModal();

    const connect = screen.getByRole("button", {
      name: "sync.sageBusiness.connect",
    });
    expect(connect).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "South Ledger" }));
    expect(connect).toBeEnabled();
  });

  it("supports radio arrow navigation and submits the exact selected business once", async () => {
    const user = userEvent.setup();
    h.query.data = {
      businesses: [
        { id: "biz-a", name: "North Ledger" },
        { id: "biz-b", name: "South Ledger" },
      ],
      providerEnvironment: "production",
    };
    const { onConnected } = renderModal();
    const first = screen.getByRole("radio", { name: "North Ledger" });
    const second = screen.getByRole("radio", { name: "South Ledger" });

    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-checked", "true");

    h.mutate.mockImplementation((_variables, callbacks) => {
      callbacks.onSuccess({
        success: true,
        providerEnvironment: "production",
        businessName: "South Ledger",
      });
    });
    await user.click(
      screen.getByRole("button", { name: "sync.sageBusiness.connect" })
    );

    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate).toHaveBeenCalledWith(
      {
        companyId: "company-1",
        sessionId: "session-1",
        businessId: "biz-b",
      },
      expect.any(Object)
    );
    expect(onConnected).toHaveBeenCalledWith({
      businessName: "South Ledger",
      providerEnvironment: "production",
    });
  });

  it("blocks duplicate submission while a connection is pending", async () => {
    const user = userEvent.setup();
    h.query.data = {
      businesses: [{ id: "biz-a", name: "OPS Test Ledger" }],
      providerEnvironment: "production",
    };
    h.isPending = true;
    renderModal();

    await user.click(
      screen.getByRole("button", { name: /sync\.sageBusiness\.connect/ })
    );
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection beside the selection", async () => {
    const user = userEvent.setup();
    h.query.data = {
      businesses: [{ id: "biz-a", name: "OPS Test Ledger" }],
      providerEnvironment: "production",
    };
    h.mutate.mockImplementation((_variables, callbacks) => {
      callbacks.onError(new Error("rejected"));
    });
    renderModal();
    await user.click(
      screen.getByRole("button", { name: "sync.sageBusiness.connect" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "sync.sageBusiness.saveFailed"
    );
  });

  it("returns focus to the opener after cancel", async () => {
    const user = userEvent.setup();
    h.query.data = {
      businesses: [
        { id: "biz-a", name: "North Ledger" },
        { id: "biz-b", name: "South Ledger" },
      ],
      providerEnvironment: "production",
    };

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open selector
          </button>
          <SageBusinessSelectionModal
            open={open}
            companyId="company-1"
            sessionId="session-1"
            onClose={() => setOpen(false)}
            onConnected={() => setOpen(false)}
          />
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open selector" });
    await user.click(opener);
    await user.click(
      screen.getByRole("button", { name: "sync.sageBusiness.cancel" })
    );

    await waitFor(() => expect(opener).toHaveFocus());
  });
});
