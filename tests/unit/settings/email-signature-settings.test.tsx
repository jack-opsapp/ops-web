import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearLogoMutate,
  confirmImportedMutate,
  importMutate,
  removeBackground,
  saveMutate,
  signatureQuery,
  toastError,
  toastSuccess,
  uploadLogoMutate,
} = vi.hoisted(() => ({
  signatureQuery: vi.fn(),
  saveMutate: vi.fn(),
  confirmImportedMutate: vi.fn(),
  importMutate: vi.fn(),
  uploadLogoMutate: vi.fn(),
  clearLogoMutate: vi.fn(),
  removeBackground: vi.fn(),
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
  useUploadSignatureLogo: () => ({
    mutateAsync: uploadLogoMutate,
    isPending: false,
  }),
  useClearSignatureLogo: () => ({
    mutateAsync: clearLogoMutate,
    isPending: false,
  }),
}));

// jsdom has no canvas, and the cut itself is covered by its own unit tests.
vi.mock("@/lib/images/remove-solid-background", () => ({
  removeSolidBackground: removeBackground,
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
  const wrap = (node: ReactElement) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const view = render(wrap(ui));
  // Rerender through the same provider — swapping the root element type would
  // remount the card and quietly throw away the state under test.
  return {
    ...view,
    rerender: (node: ReactElement) => view.rerender(wrap(node)),
  };
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
      signatureLogoUrl: null,
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
  uploadLogoMutate.mockReset().mockResolvedValue({});
  clearLogoMutate.mockReset().mockResolvedValue({});
  removeBackground
    .mockReset()
    .mockImplementation(async (file: File) => ({ blob: file, applied: false }));
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

  it("offers a logo instead of a toggle when there is no mark yet", () => {
    signatureQuery.mockReturnValue(loadedSignature({ companyLogoUrl: null }));

    renderWithQuery(<EmailSignatureSettings {...props} />);

    // Nothing to show and nothing to arrange — just the way to supply one.
    expect(
      screen.queryByRole("switch", { name: "Show logo" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add a logo" })
    ).toBeInTheDocument();
  });

  it("offers the two arrangements only once the logo is on", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show logo" }));

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
    await user.click(screen.getByRole("switch", { name: "Show logo" }));
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

  it("stands out when the rail sent the operator to this exact mailbox", () => {
    signatureQuery.mockReturnValue(loadedSignature());

    const { rerender } = renderWithQuery(
      <EmailSignatureSettings {...props} />
    );
    expect(screen.getByTestId("email-signature-settings")).not.toHaveAttribute(
      "data-highlighted"
    );

    rerender(<EmailSignatureSettings {...props} highlighted />);
    expect(screen.getByTestId("email-signature-settings")).toHaveAttribute(
      "data-highlighted",
      "true"
    );
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

const CUSTOM_LOGO = "https://files.example.com/email-signatures/mark.png";

function logoFile(contents: string, type = "image/png"): File {
  return new File([contents], "logo.png", { type });
}

function uploadedBytes(call: number): string {
  const { data } = uploadLogoMutate.mock.calls[call][0] as { data: string };
  return Buffer.from(data, "base64").toString();
}

describe("EmailSignatureSettings custom logo", () => {
  it("sends the operator's own mark and turns it on", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature({ companyLogoUrl: null }));
    const { rerender } = renderWithQuery(
      <EmailSignatureSettings {...props} />
    );

    // The mark appears on the card because the server answered with it.
    uploadLogoMutate.mockImplementation(async () => {
      signatureQuery.mockReturnValue(
        loadedSignature({
          companyLogoUrl: null,
          signatureLogoUrl: CUSTOM_LOGO,
        })
      );
      return {};
    });

    await user.upload(
      screen.getByTestId("signature-logo-input"),
      logoFile("MARK-BYTES")
    );
    // Reading the file is asynchronous; nothing is sent until it finishes.
    await waitFor(() => expect(uploadLogoMutate).toHaveBeenCalledTimes(1));
    rerender(<EmailSignatureSettings {...props} />);

    expect(uploadLogoMutate).toHaveBeenCalledWith({
      ...scope,
      data: expect.any(String),
      contentType: "image/png",
    });
    expect(uploadedBytes(0)).toBe("MARK-BYTES");
    // Supplying a mark is asking for it to show — no second decision.
    expect(
      screen.getByRole("switch", { name: "Show logo" })
    ).toBeChecked();
  });

  it("cuts a solid background out unasked and leaves a way back", async () => {
    const user = userEvent.setup();
    removeBackground.mockResolvedValue({
      blob: logoFile("CUT-BYTES"),
      applied: true,
    });
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.upload(
      screen.getByTestId("signature-logo-input"),
      logoFile("ORIGINAL-BYTES")
    );

    expect(await screen.findByText("[background removed]")).toBeInTheDocument();
    expect(uploadedBytes(0)).toBe("CUT-BYTES");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(uploadLogoMutate).toHaveBeenCalledTimes(2));

    // The way back is the file the operator actually picked.
    expect(uploadedBytes(1)).toBe("ORIGINAL-BYTES");
    expect(screen.queryByText("[background removed]")).not.toBeInTheDocument();
  });

  it("says nothing when there was no background to remove", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.upload(
      screen.getByTestId("signature-logo-input"),
      logoFile("PHOTO-BYTES")
    );
    await waitFor(() => expect(uploadLogoMutate).toHaveBeenCalledTimes(1));

    expect(uploadedBytes(0)).toBe("PHOTO-BYTES");
    expect(screen.queryByText("[background removed]")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("signs with the uploaded mark over the company logo", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(
      loadedSignature({ signatureLogoUrl: CUSTOM_LOGO })
    );
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.click(screen.getByRole("switch", { name: "Show logo" }));

    const preview = screen.getByTestId("signature-sheet").querySelector("img");
    expect(preview?.getAttribute("src")).toBe(CUSTOM_LOGO);
  });

  it("offers the way back to the company logo, and only then", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(loadedSignature());
    const { rerender } = renderWithQuery(
      <EmailSignatureSettings {...props} />
    );

    await user.click(screen.getByRole("switch", { name: "Show logo" }));
    expect(
      screen.queryByRole("button", { name: "Use the company logo" })
    ).not.toBeInTheDocument();

    signatureQuery.mockReturnValue(
      loadedSignature({
        signatureLogoUrl: CUSTOM_LOGO,
        fields: { ...loadedSignature().data.fields, includeLogo: true },
      })
    );
    rerender(<EmailSignatureSettings {...props} />);

    await user.click(
      screen.getByRole("button", { name: "Use the company logo" })
    );
    expect(clearLogoMutate).toHaveBeenCalledWith(scope);
  });

  it("offers removal rather than a revert when there is no company logo", async () => {
    const user = userEvent.setup();
    signatureQuery.mockReturnValue(
      loadedSignature({
        companyLogoUrl: null,
        signatureLogoUrl: CUSTOM_LOGO,
      })
    );
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.click(screen.getByRole("switch", { name: "Show logo" }));

    // Nothing to revert to, so the honest verb is the one on the button.
    expect(
      screen.queryByRole("button", { name: "Use the company logo" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(clearLogoMutate).toHaveBeenCalledWith(scope);
  });

  it("reports a rejected logo instead of swallowing it", async () => {
    const user = userEvent.setup();
    uploadLogoMutate.mockRejectedValue(new Error("Keep the logo under 1 MB"));
    signatureQuery.mockReturnValue(loadedSignature());
    renderWithQuery(<EmailSignatureSettings {...props} />);

    await user.upload(
      screen.getByTestId("signature-logo-input"),
      logoFile("HUGE")
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Logo not saved", {
        description: "Keep the logo under 1 MB",
      })
    );
  });

  it("gives an operator who cannot manage the mailbox nothing to upload with", () => {
    signatureQuery.mockReturnValue(loadedSignature({ companyLogoUrl: null }));

    renderWithQuery(<EmailSignatureSettings {...props} canManage={false} />);

    expect(screen.getByRole("button", { name: "Add a logo" })).toBeDisabled();
  });
});
