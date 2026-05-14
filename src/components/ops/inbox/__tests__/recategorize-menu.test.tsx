import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const recategorizeMutate = vi.fn();
const enqueueMock = vi.fn();

vi.mock("@/lib/hooks/use-inbox-threads", () => ({
  useThreadActions: () => ({
    recategorize: { mutate: recategorizeMutate },
  }),
}));

vi.mock("../undo-toast", () => ({
  enqueueUndoToast: (input: unknown) => enqueueMock(input),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { RecategorizeMenu } from "../recategorize-menu";

describe("<RecategorizeMenu>", () => {
  beforeEach(() => {
    recategorizeMutate.mockReset();
    enqueueMock.mockReset();
  });

  it("renders the // RECATEGORIZE slash title and instructional body", () => {
    render(
      <RecategorizeMenu
        threadId="t-1"
        currentCategory="OTHER"
        trigger={<button>Recategorize</button>}
        open={true}
      />
    );
    expect(screen.getByText("// RECATEGORIZE")).toBeInTheDocument();
    expect(
      screen.getByText(/move this thread to a different group/i)
    ).toBeInTheDocument();
  });

  it("renders each category as a plain JetBrains Mono uppercase label with its hotkey", () => {
    render(
      <RecategorizeMenu
        threadId="t-1"
        currentCategory="OTHER"
        trigger={<button>Recategorize</button>}
        open={true}
      />
    );
    // CUSTOMER label appears (not as a chip — as plain mono text)
    expect(screen.getByText("CUSTOMER")).toBeInTheDocument();
    // The hotkey hint for CUSTOMER is "C", rendered via inline KeyHint as [C]
    expect(screen.getByText("[C]")).toBeInTheDocument();
    // VENDOR + [V]
    expect(screen.getByText("VENDOR")).toBeInTheDocument();
    expect(screen.getByText("[V]")).toBeInTheDocument();
  });

  it("excludes the current category from the list", () => {
    render(
      <RecategorizeMenu
        threadId="t-1"
        currentCategory="VENDOR"
        trigger={<button>Recategorize</button>}
        open={true}
      />
    );
    // VENDOR is the current → excluded
    expect(screen.queryByText("VENDOR")).toBeNull();
    // Other categories present
    expect(screen.getByText("CUSTOMER")).toBeInTheDocument();
  });

  it("renders the // CLASSIFIER NOTE — OPTIONAL section with the note textarea", () => {
    render(
      <RecategorizeMenu
        threadId="t-1"
        currentCategory="OTHER"
        trigger={<button>Recategorize</button>}
        open={true}
      />
    );
    expect(
      screen.getByText("// CLASSIFIER NOTE — OPTIONAL")
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("uses dense token-backed category rows instead of inflated modal spacing", () => {
    render(
      <RecategorizeMenu
        threadId="t-1"
        currentCategory="OTHER"
        trigger={<button>Recategorize</button>}
        open={true}
      />
    );
    const customer = screen.getByRole("button", { name: /CUSTOMER/i });
    expect(customer.className).toContain("py-0.5");
    expect(customer.className).toContain("hover:bg-surface-hover");
  });

  it("clicking a category fires recategorize.mutate with the right args", () => {
    render(
      <RecategorizeMenu
        threadId="t-1"
        currentCategory="OTHER"
        trigger={<button>Recategorize</button>}
        open={true}
      />
    );
    fireEvent.click(screen.getByText("CUSTOMER"));
    expect(recategorizeMutate).toHaveBeenCalledTimes(1);
    const arg = recategorizeMutate.mock.calls[0][0] as {
      threadId: string;
      toCategory: string;
    };
    expect(arg.threadId).toBe("t-1");
    expect(arg.toCategory).toBe("CUSTOMER");
  });
});
