/**
 * Tests for `CreateEstimateForm` (`create-estimate-modal.tsx`).
 *
 * `CreateEstimateForm` is the single estimate-creation surface in OPS-Web
 * (mounted globally in `dashboard-layout`, opened by the FAB or — now — the
 * pipeline lead-detail Overview tab). These tests pin the opportunity-scoping
 * contract: when opened from a deal it accepts `{ opportunityId, clientId }`
 * defaults, pre-fills the client, and stamps `opportunity_id` onto the created
 * estimate so it links back to the deal (surfacing in `useEstimates({ opportunityId })`).
 *
 * Every network boundary is stubbed so the form is exercised without TanStack
 * Query / Supabase — we assert on the `useCreateEstimate` payload, not the DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

// Echo-key dictionary: `t(key, fallback)` returns the English fallback when
// present, else the key — deterministic labels without the real dictionary.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
    dict: {},
  }),
}));

// Permission gate: default allow `estimates.create`; per-test overrides
// reassign `permissionMockCan`.
let permissionMockCan: (key: string) => boolean = () => true;
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: <T,>(
    selector: (s: { can: (key: string) => boolean }) => T,
  ) => selector({ can: (key: string) => permissionMockCan(key) }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co-1" } }),
}));

// Setup gate complete by default → the form is interactive (no interception
// modal over it).
vi.mock("@/hooks/useSetupGate", () => ({
  useSetupGate: () => ({ isComplete: true, missingSteps: [] }),
}));
vi.mock("@/components/setup/SetupInterceptionModal", () => ({
  SetupInterceptionModal: () => null,
}));

// Line-item editor is irrelevant to the scoping contract — stub it to a quiet
// row + zeroed totals so submit fires deterministically.
vi.mock("@/components/ops/line-item-editor", () => ({
  LineItemEditor: () => null,
  createEmptyLineItem: () => ({
    id: "li-1",
    name: "",
    quantity: 1,
    unitPrice: 0,
    discountPercent: 0,
    productId: null,
    isTaxable: false,
    unit: "each",
    isOptional: false,
    isSelected: true,
  }),
  computeAmount: () => ({ lineTotal: 0, tax: 0 }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Data-hook barrel (`@/lib/hooks`) — the network boundary.
const createEstimateMutate = vi.fn();
let clientsData: { clients: { id: string; name: string }[] } = { clients: [] };
vi.mock("@/lib/hooks", () => ({
  useCreateEstimate: () => ({ mutate: createEstimateMutate, isPending: false }),
  useClients: () => ({ data: clientsData }),
  useProjects: () => ({ data: { projects: [] } }),
  useProducts: () => ({ data: [] }),
}));

const { CreateEstimateForm, createEstimateDefaultsFromMeta } = await import(
  "@/components/ops/create-estimate-modal"
);

beforeEach(() => {
  vi.clearAllMocks();
  permissionMockCan = () => true;
  clientsData = { clients: [] };
});

describe("CreateEstimateForm — opportunity scoping", () => {
  it("stamps the opportunityId onto the created estimate when scoped to a deal", async () => {
    render(<CreateEstimateForm opportunityId="opp-9" clientId="client-7" />);

    await userEvent.click(
      screen.getByRole("button", { name: /create estimate/i }),
    );

    expect(createEstimateMutate).toHaveBeenCalledTimes(1);
    const [payload] = createEstimateMutate.mock.calls[0];
    expect(payload.data.opportunityId).toBe("opp-9");
  });

  it("pre-fills the client select from the clientId default", () => {
    clientsData = { clients: [{ id: "client-7", name: "Greenway" }] };
    render(<CreateEstimateForm clientId="client-7" />);

    // The client select is the first combobox in the form.
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveValue("client-7");
  });

  it("links nothing (opportunityId null) when opened unscoped — the FAB path", async () => {
    render(<CreateEstimateForm />);

    await userEvent.click(
      screen.getByRole("button", { name: /create estimate/i }),
    );

    expect(createEstimateMutate).toHaveBeenCalledTimes(1);
    const [payload] = createEstimateMutate.mock.calls[0];
    expect(payload.data.opportunityId).toBeNull();
  });
});

describe("createEstimateDefaultsFromMeta", () => {
  it("extracts opportunityId + clientId from a deal-scoped window metadata bag", () => {
    expect(
      createEstimateDefaultsFromMeta({
        opportunityId: "opp-9",
        clientId: "client-7",
        // unrelated keys are ignored
        title: "New estimate",
      }),
    ).toEqual({ opportunityId: "opp-9", clientId: "client-7" });
  });

  it("returns undefined fields for a bare (FAB) open with no metadata", () => {
    expect(createEstimateDefaultsFromMeta(undefined)).toEqual({
      opportunityId: undefined,
      clientId: undefined,
    });
  });

  it("string-guards malformed metadata → degrades to an unscoped estimate", () => {
    expect(
      createEstimateDefaultsFromMeta({ opportunityId: 5, clientId: null }),
    ).toEqual({ opportunityId: undefined, clientId: undefined });
  });
});
