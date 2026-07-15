import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signatureQuery = vi.fn();
const saveMutate = vi.fn();
const importMutate = vi.fn();

vi.mock("@/lib/hooks/use-email-signature", () => ({
  useEmailSignature: (...args: unknown[]) => signatureQuery(...args),
  useSaveEmailSignature: () => ({
    mutateAsync: saveMutate,
    isPending: false,
  }),
  useImportProviderEmailSignature: () => ({
    mutateAsync: importMutate,
    isPending: false,
  }),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { EmailSignatureSettings } from "@/components/settings/email-signature-settings";

const props = {
  companyId: "company-1",
  userId: "user-1",
  connectionId: "connection-1",
  mailbox: "jack@ops.test",
  canManage: true,
};

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

function loadedSignature(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      connectionId: props.connectionId,
      mailbox: props.mailbox,
      provider: "gmail",
      effective: {
        source: "gmail",
        html: "<div>Jack<br>OPS</div>",
        text: "Jack\nOPS",
        hash: "hash-1",
      },
      ops: null,
      providerSignature: {
        source: "gmail",
        html: "<div>Jack<br>OPS</div>",
        text: "Jack\nOPS",
        fetchedAt: "2026-07-14T12:00:00.000Z",
      },
      providerImportSupported: true,
      missing: false,
      ...overrides,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  signatureQuery.mockReset();
  saveMutate.mockReset().mockResolvedValue({ missing: false });
  importMutate.mockReset().mockResolvedValue({ missing: false });
});

describe("EmailSignatureSettings", () => {
  it("shows the effective signature and its source", () => {
    signatureQuery.mockReturnValue(loadedSignature());

    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(screen.getByText("EMAIL SIGNATURE")).toBeInTheDocument();
    expect(screen.getByText("GMAIL SIGNATURE")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "PRE" && element.textContent === "Jack\nOPS"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "EDIT SIGNATURE" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("saves an OPS override for the current mailbox", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.click(screen.getByRole("button", { name: "EDIT SIGNATURE" }));
    await user.type(
      screen.getByRole("textbox", { name: "OPS SIGNATURE" }),
      "Jackson Sweet\nOPS"
    );
    await user.click(screen.getByRole("button", { name: "SAVE SIGNATURE" }));

    expect(saveMutate).toHaveBeenCalledWith({
      companyId: props.companyId,
      userId: props.userId,
      connectionId: props.connectionId,
      opsText: "Jackson Sweet\nOPS",
    });
  });

  it("imports a Gmail signature only when the provider supports it", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.click(screen.getByRole("button", { name: "EDIT SIGNATURE" }));
    await user.click(screen.getByRole("button", { name: "IMPORT FROM GMAIL" }));

    expect(importMutate).toHaveBeenCalledWith({
      companyId: props.companyId,
      userId: props.userId,
      connectionId: props.connectionId,
    });
  });

  it("tells Microsoft 365 users to paste their signature and offers no import", () => {
    signatureQuery.mockReturnValue(
      loadedSignature({
        provider: "microsoft365",
        effective: null,
        providerSignature: null,
        providerImportSupported: false,
        missing: true,
      })
    );

    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(
      screen.getByText(
        "Outlook does not share signatures with OPS. Paste yours below."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /IMPORT/ })
    ).not.toBeInTheDocument();
    expect(screen.getByText("NO SIGNATURE")).toBeInTheDocument();
  });
});
