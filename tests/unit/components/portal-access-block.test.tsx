/**
 * `PortalAccessBlock` — the client dossier's "Portal access" section
 * (PUBLIC API P1, design §5.4). One row per customer membership: masked
 * email, state tag, last seen. Actions (confirm access / revoke) live behind
 * the row and only for operators holding `clients.edit`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/dictionaries/en/clients.json";

const { authedFetch, toastSuccess, toastError } = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

let permissionMockCan: (key: string) => boolean = () => true;
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: <T,>(selector: (s: { can: (key: string) => boolean }) => T) =>
    selector({ can: (key: string) => permissionMockCan(key) }),
}));

vi.mock("@/lib/utils/authed-fetch", () => ({ authedFetch }));
vi.mock("@/components/ui/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// Real English copy so the assertions pin the shipped strings, not keys.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, params?: string | Record<string, unknown>) => {
      const value = (en as Record<string, string>)[key];
      if (typeof value !== "string") return key;
      if (params && typeof params === "object") {
        return value.replace(/\{(\w+)\}/g, (m, token) =>
          token in params ? String(params[token]) : m
        );
      }
      return value;
    },
  }),
}));

import { PortalAccessBlock } from "@/components/clients/portal-access-block";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_A = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP_B = "55555555-5555-4555-8555-555555555555";
const MEMBERSHIP_C = "66666666-6666-4666-8666-666666666666";

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

const MEMBERSHIPS = [
  {
    membershipId: MEMBERSHIP_A,
    state: "active_forward_only",
    evidenceKind: "guest_claim",
    maskedEmail: "j***@example.com",
    lastSeenAt: TWO_DAYS_AGO,
  },
  {
    membershipId: MEMBERSHIP_B,
    state: "active_full",
    evidenceKind: "staff_confirmed",
    maskedEmail: "m***@example.com",
    lastSeenAt: null,
  },
  {
    membershipId: MEMBERSHIP_C,
    state: "revoked",
    evidenceKind: "on_file_transacted",
    maskedEmail: "r***@example.com",
    lastSeenAt: null,
  },
];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function listResponses(memberships: unknown[]) {
  authedFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      if (url.endsWith("/confirm")) return jsonResponse(200, { state: "active_full" });
      if (url.endsWith("/revoke")) return jsonResponse(200, { revoked: true });
    }
    return jsonResponse(200, { memberships });
  });
}

function renderBlock(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalAccessBlock clientId={CLIENT_ID} />
    </QueryClientProvider>
  );
}

function rowFor(maskedEmail: string): HTMLElement {
  const row = screen.getByText(maskedEmail).closest("li");
  if (!row) throw new Error(`no row for ${maskedEmail}`);
  return row;
}

function postCalls() {
  return authedFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
}

beforeEach(() => {
  permissionMockCan = () => true;
  listResponses(MEMBERSHIPS);
});
afterEach(() => vi.clearAllMocks());

describe("PortalAccessBlock", () => {
  it("titles the section and fetches the client's portal access", async () => {
    renderBlock();
    expect(screen.getByText("Portal access")).toBeInTheDocument();
    await waitFor(() =>
      expect(authedFetch).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/portal-access`)
    );
  });

  it("shows a one-line em dash empty state when nobody has portal access", async () => {
    listResponses([]);
    renderBlock();
    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("renders one row per membership with masked email, state tag and last seen", async () => {
    renderBlock();
    const forwardOnly = await screen.findByText("j***@example.com");
    expect(forwardOnly).toHaveClass("font-mono");

    const rowA = rowFor("j***@example.com");
    expect(within(rowA).getByText("New work only")).toBeInTheDocument();
    const seen = within(rowA).getByText("Seen 2d ago");
    expect(seen).toHaveClass("font-mono");
    expect(seen).toHaveClass("tabular-nums");

    const rowB = rowFor("m***@example.com");
    expect(within(rowB).getByText("Full history")).toBeInTheDocument();
    expect(within(rowB).getByText("—")).toBeInTheDocument();

    const rowC = rowFor("r***@example.com");
    expect(within(rowC).getByText("Revoked")).toBeInTheDocument();
  });

  it("never renders the raw membership ids", async () => {
    const { container } = renderBlock();
    await screen.findByText("j***@example.com");
    expect(container.innerHTML).not.toContain(MEMBERSHIP_A);
    expect(container.innerHTML).not.toContain(MEMBERSHIP_B);
  });

  it("offers Confirm access only on forward-only rows and Revoke only on live rows", async () => {
    renderBlock();
    await screen.findByText("j***@example.com");

    const rowA = rowFor("j***@example.com");
    expect(within(rowA).getByRole("button", { name: "Confirm access" })).toBeInTheDocument();
    expect(within(rowA).getByRole("button", { name: "Revoke" })).toBeInTheDocument();

    const rowB = rowFor("m***@example.com");
    expect(within(rowB).queryByRole("button", { name: "Confirm access" })).not.toBeInTheDocument();
    expect(within(rowB).getByRole("button", { name: "Revoke" })).toBeInTheDocument();

    const rowC = rowFor("r***@example.com");
    expect(within(rowC).queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides every action from operators without clients.edit", async () => {
    permissionMockCan = (key) => key !== "clients.edit";
    renderBlock();
    await screen.findByText("j***@example.com");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("confirms access in two steps and posts to the confirm route", async () => {
    renderBlock();
    await screen.findByText("j***@example.com");
    const rowA = rowFor("j***@example.com");

    fireEvent.click(within(rowA).getByRole("button", { name: "Confirm access" }));
    expect(within(rowA).getByText("Grants full history")).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);

    fireEvent.click(within(rowA).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(authedFetch).toHaveBeenCalledWith(
        `/api/clients/${CLIENT_ID}/portal-access/${MEMBERSHIP_A}/confirm`,
        expect.objectContaining({ method: "POST" })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Access confirmed"));
    // The listing is re-read after the change, never patched locally.
    await waitFor(() =>
      expect(
        authedFetch.mock.calls.filter(([url]) => url === `/api/clients/${CLIENT_ID}/portal-access`)
      ).toHaveLength(2)
    );
  });

  it("cancels a pending confirm without sending anything", async () => {
    renderBlock();
    await screen.findByText("j***@example.com");
    const rowA = rowFor("j***@example.com");

    fireEvent.click(within(rowA).getByRole("button", { name: "Confirm access" }));
    fireEvent.click(within(rowA).getByRole("button", { name: "Cancel" }));

    expect(within(rowA).queryByText("Grants full history")).not.toBeInTheDocument();
    expect(within(rowA).getByRole("button", { name: "Confirm access" })).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);
  });

  it("revokes access in two steps and posts to the revoke route", async () => {
    renderBlock();
    await screen.findByText("m***@example.com");
    const rowB = rowFor("m***@example.com");

    fireEvent.click(within(rowB).getByRole("button", { name: "Revoke" }));
    expect(within(rowB).getByText("Cuts portal access")).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);

    fireEvent.click(within(rowB).getByRole("button", { name: "Revoke access" }));
    await waitFor(() =>
      expect(authedFetch).toHaveBeenCalledWith(
        `/api/clients/${CLIENT_ID}/portal-access/${MEMBERSHIP_B}/revoke`,
        expect.objectContaining({ method: "POST" })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Access revoked"));
  });

  it("reports a failed action and keeps the row intact", async () => {
    authedFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse(503, { error: "portal_access_unavailable" });
      return jsonResponse(200, { memberships: MEMBERSHIPS });
    });
    renderBlock();
    await screen.findByText("j***@example.com");
    const rowA = rowFor("j***@example.com");

    fireEvent.click(within(rowA).getByRole("button", { name: "Confirm access" }));
    fireEvent.click(within(rowA).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Update failed"));
    expect(screen.getByText("j***@example.com")).toBeInTheDocument();
  });

  it("does not retry a refused read even under the app's default retry policy", async () => {
    authedFetch.mockResolvedValue(jsonResponse(403, { error: "Forbidden" }));
    // A stock QueryClient retries failed queries three times with backoff; the
    // block must opt out for a refusal, which retrying can never change.
    renderBlock(new QueryClient());
    expect(
      await screen.findByText("SYS :: Portal access unavailable", undefined, { timeout: 1500 })
    ).toBeInTheDocument();
    expect(authedFetch).toHaveBeenCalledTimes(1);
  });

  it("states plainly when portal access cannot be read", async () => {
    authedFetch.mockResolvedValue(jsonResponse(503, { error: "portal_access_unavailable" }));
    renderBlock();
    // A store failure earns one retry (with backoff) before the block gives up.
    expect(
      await screen.findByText("SYS :: Portal access unavailable", undefined, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(authedFetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
