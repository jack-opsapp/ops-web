import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkAddVariantsDialog } from "@/components/catalog/modals/bulk-add-variants-dialog";
import { CatalogBulkVariantRpcError } from "@/lib/api/services/catalog-bulk-variant-service";
import type { BulkVariantFamilyRecord } from "@/lib/catalog/bulk-variant-expansion";

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const refetch = vi.fn();
const mutateAsync = vi.fn();

const safeFamily: BulkVariantFamilyRecord = {
  categoryName: "Railings",
  searchText: "Classic rail Railings Color Black White",
  issue: null,
  snapshot: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Classic rail",
    options: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Color",
        sortOrder: 0,
        values: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            value: "Black",
            sortOrder: 0,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            value: "White",
            sortOrder: 1,
          },
        ],
      },
    ],
    variants: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        sku: "RAIL-BLK",
        quantity: 9,
        isActive: true,
        optionValueIds: ["33333333-3333-4333-8333-333333333333"],
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        sku: "RAIL-WHT",
        quantity: 4,
        isActive: true,
        optionValueIds: ["44444444-4444-4444-8444-444444444444"],
      },
    ],
  },
};

const unsafeFamily: BulkVariantFamilyRecord = {
  ...safeFamily,
  searchText: "Unsafe rail Railings",
  snapshot: {
    ...safeFamily.snapshot,
    id: "77777777-7777-4777-8777-777777777777",
    name: "Unsafe rail",
  },
  issue: {
    code: "duplicate_variant_signature",
    familyId: "77777777-7777-4777-8777-777777777777",
    familyName: "Unsafe rail",
  },
};

const familyHook = {
  data: [safeFamily, unsafeFamily],
  isLoading: false,
  isError: false,
  refetch,
};

const mutationHook = {
  mutateAsync,
  isPending: false,
};

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: COMPANY_ID } }),
}));

vi.mock("@/lib/hooks/use-catalog-bulk-variants", () => ({
  useCatalogBulkVariantFamilies: () => familyHook,
  useExpandCatalogVariants: () => mutationHook,
}));

async function reachReview() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: /Classic rail/i }));
  await user.click(screen.getByRole("button", { name: "NEXT" }));
  await user.type(screen.getByLabelText("Option name"), "Top profile");
  await user.type(screen.getByLabelText("Existing value"), "Round top");
  await user.type(screen.getByLabelText("New value 1"), "Flat top");
  await user.click(screen.getByRole("button", { name: "REVIEW" }));
  return user;
}

describe("BulkAddVariantsDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({
      ok: true,
      replayed: false,
      family_count: 1,
      existing_variant_assignment_count: 2,
      new_variant_count: 2,
    });
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("keeps unsafe families visible, searches every family facet, and selects only safe visible rows", async () => {
    const user = userEvent.setup();
    render(<BulkAddVariantsDialog onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "FAMILIES" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Unsafe rail/i })
    ).toBeDisabled();
    expect(
      await screen.findByText("Duplicate variant combinations")
    ).toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: "Search families" }),
      "black"
    );
    expect(screen.getByText("Classic rail")).toBeInTheDocument();
    expect(screen.queryByText("Unsafe rail")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "SELECT ALL VISIBLE" })
    );
    expect(
      screen.getByRole("checkbox", { name: /Classic rail/i })
    ).toBeChecked();
  });

  it("builds an exact review, focuses each stage, and applies once", async () => {
    const onClose = vi.fn();
    render(<BulkAddVariantsDialog onClose={onClose} />);
    await reachReview();

    expect(screen.getByRole("heading", { name: "REVIEW" })).toHaveFocus();
    expect(screen.getByText("1 FAMILY")).toBeInTheDocument();
    expect(
      screen.getByText("2 EXISTING VARIANTS LABELLED")
    ).toBeInTheDocument();
    expect(screen.getByText("2 NEW VARIANTS")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Existing IDs, stock, SKU, history and joins stay unchanged/i
      )
    ).toBeInTheDocument();

    const familyReview = screen.getByRole("button", { name: /Classic rail/i });
    fireEvent.click(familyReview);
    const details = screen.getByTestId("bulk-variant-family-review");
    expect(within(details).getAllByText(/Color: Black/i)).not.toHaveLength(0);
    expect(
      within(details).getAllByText(/Top profile: Flat top/i)
    ).not.toHaveLength(0);

    const applyButton = screen.getByRole("button", { name: "APPLY" });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      companyId: COMPANY_ID,
      payload: {
        axis_name: "Top profile",
        existing_value: "Round top",
        new_values: ["Flat top"],
      },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("retains a company-scoped draft and blocks Apply while offline", async () => {
    const first = render(<BulkAddVariantsDialog onClose={vi.fn()} />);
    await reachReview();
    first.unmount();

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    render(<BulkAddVariantsDialog onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "REVIEW" })).toBeInTheDocument();
    expect(
      screen.getByText("OFFLINE — DRAFT SAVED ON THIS DEVICE")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "APPLY" })).toBeDisabled();
  });

  it("refreshes stale snapshots without losing the authored change", async () => {
    mutateAsync.mockRejectedValueOnce(
      new CatalogBulkVariantRpcError("stale_catalog", "Catalog changed.")
    );
    render(<BulkAddVariantsDialog onClose={vi.fn()} />);
    await reachReview();
    await userEvent.click(screen.getByRole("button", { name: "APPLY" }));

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(
        "Catalog changed. Review the latest combinations and apply again."
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Top profile · Flat top/i)).toBeInTheDocument();
  });
});
