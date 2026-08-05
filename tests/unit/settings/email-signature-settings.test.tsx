import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  confirmImportedMutate,
  importMutate,
  saveMutate,
  signatureQuery,
  toastError,
  toastSuccess,
} = vi.hoisted(() => ({
  signatureQuery: vi.fn(),
  saveMutate: vi.fn(),
  confirmImportedMutate: vi.fn(),
  importMutate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/hooks/use-email-signature", () => ({
  useEmailSignature: (...args: unknown[]) => signatureQuery(...args),
  useSaveEmailSignature: () => ({
    mutateAsync: saveMutate,
    isPending: false,
  }),
  useConfirmImportedEmailSignature: () => ({
    mutateAsync: confirmImportedMutate,
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

vi.mock("@/components/ui/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { EmailSignatureSettings } from "@/components/settings/email-signature-settings";
import { renderSignatureTemplate } from "@/lib/email/signature-template";

const props = {
  companyId: "company-1",
  userId: "user-1",
  connectionId: "connection-1",
  mailbox: "jack@canprodeckandrail.com",
  canManage: true,
};

const scope = {
  companyId: props.companyId,
  userId: props.userId,
  connectionId: props.connectionId,
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
      effective: null,
      ops: null,
      providerSignature: null,
      providerImportSupported: true,
      missing: true,
      confirmedAt: null,
      outreachSubject: null,
      companyLogoUrl: "https://cdn.example.com/canpro.png",
      fields: {
        name: "Jackson Sweet",
        title: "",
        companyName: "Canpro Deck and Rail",
        phone: "(250) 538-8994",
        website: "canprodeckandrail.com",
        includeLogo: false,
        layout: "logo-left",
      },
      ...overrides,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  signatureQuery.mockReset();
  saveMutate.mockReset().mockResolvedValue({ confirmedAt: "now" });
  confirmImportedMutate.mockReset().mockResolvedValue({ confirmedAt: "now" });
  importMutate.mockReset().mockResolvedValue({ missing: false });
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("EmailSignatureSettings", () => {
  it("opens prefilled and says what is being held", () => {
    signatureQuery.mockReturnValue(loadedSignature());

    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(screen.getByText("Not confirmed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "New-lead replies stay held until you confirm how you sign off."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Jackson Sweet");
    expect(screen.getByLabelText("Company")).toHaveValue(
      "Canpro Deck and Rail"
    );
    expect(screen.getByLabelText("Phone")).toHaveValue("(250) 538-8994");
  });

  it("previews the signature the customer will receive", () => {
    signatureQuery.mockReturnValue(loadedSignature());

    renderWithQuery(<EmailSignatureSettings {...props} />);

    const sheet = screen.getByTestId("signature-sheet");
    expect(sheet.textContent).toContain("Jackson Sweet");
    expect(sheet.textContent).toContain("Canpro Deck and Rail");
    expect(sheet.querySelector("img")).toBeNull();
  });

  it("hides the logo control when the company has no logo", () => {
    signatureQuery.mockReturnValue(loadedSignature({ companyLogoUrl: null }));

    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(
      screen.queryByRole("switch", { name: "Show company logo" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("offers the two arrangements only once the logo is on", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show company logo" }));

    expect(screen.getByRole("radio", { name: "Logo left" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("radio", { name: "Logo below" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(
      screen.getByTestId("signature-sheet").querySelector("img")
    ).not.toBeNull();
  });

  it("confirms the signature and the subject in one action", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.type(screen.getByLabelText("Title"), "Owner");
    await user.click(screen.getByRole("switch", { name: "Show company logo" }));
    await user.click(screen.getByRole("radio", { name: "Logo below" }));
    await user.type(
      screen.getByLabelText("First reply subject"),
      "Canpro Deck and Rail estimate"
    );
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));

    expect(saveMutate).toHaveBeenCalledWith({
      ...scope,
      fields: {
        name: "Jackson Sweet",
        title: "Owner",
        companyName: "Canpro Deck and Rail",
        phone: "(250) 538-8994",
        website: "canprodeckandrail.com",
      },
      includeLogo: true,
      layout: "stacked",
      outreachSubject: "Canpro Deck and Rail estimate",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Identity confirmed");
  });

  it("will not confirm an identity with no name on it", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.clear(screen.getByLabelText("Name"));

    expect(
      screen.getByRole("button", { name: "Confirm identity" })
    ).toBeDisabled();
  });

  it("offers an imported Gmail signature for confirmation before anything else", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(
      loadedSignature({
        missing: false,
        providerSignature: {
          source: "gmail",
          html: "<div>Jack — Canpro</div>",
          text: "Jack — Canpro",
          fetchedAt: "2026-08-03T12:00:00.000Z",
        },
      })
    );
    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(screen.getByText("Jack — Canpro")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use this" }));

    expect(confirmImportedMutate).toHaveBeenCalledWith(scope);
    expect(toastSuccess).toHaveBeenCalledWith("Identity confirmed");
  });

  it("lets the operator build their own instead of the import", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(
      loadedSignature({
        missing: false,
        providerSignature: {
          source: "gmail",
          html: "<div>Jack — Canpro</div>",
          text: "Jack — Canpro",
          fetchedAt: "2026-08-03T12:00:00.000Z",
        },
      })
    );
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.click(screen.getByRole("button", { name: "Build one instead" }));

    expect(screen.getByLabelText("Name")).toHaveValue("Jackson Sweet");
  });

  it("collapses to the signature and the subject once confirmed", () => {
    const confirmedFields = {
      name: "Jackson Sweet",
      title: "Owner",
      companyName: "Canpro Deck and Rail",
      phone: "(250) 538-8994",
      website: "canprodeckandrail.com",
      includeLogo: true,
      layout: "logo-left" as const,
    };
    // The stored row is what the server rendered from these same fields — the
    // card only draws itself when the two agree byte for byte.
    const stored = renderSignatureTemplate({
      ...confirmedFields,
      logoUrl: "https://cdn.example.com/canpro.png",
    });
    signatureQuery.mockReturnValue(
      loadedSignature({
        missing: false,
        confirmedAt: "2026-08-03T10:00:00.000Z",
        outreachSubject: "Canpro Deck and Rail estimate",
        ops: stored,
        fields: confirmedFields,
      })
    );

    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("signature-sheet").textContent).toContain(
      "Jackson Sweet"
    );
    expect(
      screen.queryByText(
        "New-lead replies stay held until you confirm how you sign off."
      )
    ).not.toBeInTheDocument();
    expect(screen.getByText("Canpro Deck and Rail estimate")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit identity" })
    ).toBeInTheDocument();
  });

  it("shows a promoted import as it is stored, not as a rebuilt card", () => {
    signatureQuery.mockReturnValue(
      loadedSignature({
        missing: false,
        confirmedAt: "2026-08-03T10:00:00.000Z",
        ops: { html: "<div>Jack — Canpro</div>", text: "Jack — Canpro" },
      })
    );

    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(screen.getByText("Jack — Canpro")).toBeInTheDocument();
    expect(screen.queryByTestId("signature-sheet")).not.toBeInTheDocument();
  });

  it("reopens the builder from the confirmed state", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(
      loadedSignature({
        missing: false,
        confirmedAt: "2026-08-03T10:00:00.000Z",
        outreachSubject: "Canpro Deck and Rail estimate",
      })
    );
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.click(screen.getByRole("button", { name: "Edit identity" }));

    expect(screen.getByLabelText("Name")).toHaveValue("Jackson Sweet");
    expect(screen.getByLabelText("First reply subject")).toHaveValue(
      "Canpro Deck and Rail estimate"
    );
  });

  it("reports a completed Gmail check with no configured signature", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    importMutate.mockResolvedValue({
      missing: true,
      providerImportStatus: "not_configured",
    });
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.click(screen.getByRole("button", { name: "Import from Gmail" }));

    expect(toastError).toHaveBeenCalledWith("No Gmail signature found");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("offers no Gmail import on a mailbox that cannot supply one", () => {
    signatureQuery.mockReturnValue(
      loadedSignature({
        provider: "microsoft365",
        providerImportSupported: false,
      })
    );

    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(
      screen.queryByRole("button", { name: "Import from Gmail" })
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("shows the identity read-only to an operator who cannot manage it", () => {
    signatureQuery.mockReturnValue(loadedSignature());

    renderWithQuery(<EmailSignatureSettings {...props} canManage={false} />);

    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Confirm identity" })
    ).toBeDisabled();
  });
});
