import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
vi.mock("@/components/providers/auth-provider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: async () => "synthetic-session",
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (
    selector: (s: { isLoading: boolean; isAuthenticated: boolean }) => unknown
  ) => selector({ isLoading: false, isAuthenticated: true }),
}));
import { ConsentPanel } from "@/app/oauth/authorize/_components/consent-panel";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("consent authority copy", () => {
  it.each([false, true])(
    "describes only the displayed scope authority (prepare=%s)",
    async (prepare) => {
      const scope = prepare ? "ops.customers.prepare" : "ops.jobs.read";
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue({
            ok: true,
            json: async () => ({
              clientName: "Test connector",
              companyName: "Synthetic company",
              scopes: [
                {
                  scope,
                  label: prepare
                    ? "Prepare customer updates for approval"
                    : "See jobs",
                },
              ],
              consentCatalogRevision: "2026-09-04.mcp-consent-catalog.v9",
              exposureRevision: "2026-09-04.mcp-exposure.v14",
              consentPreview: "ops_mcp_cp_" + "a".repeat(43),
              expiresAt: "2099-09-05T01:00:00.000Z",
            }),
          })
      );
      render(
        <ConsentPanel
          clientId="synthetic"
          redirectUri="https://claude.ai/api/mcp/auth_callback"
          responseType="code"
          scope={scope}
          state={null}
          codeChallenge={null}
          codeChallengeMethod="S256"
          resource="https://app.opsapp.co/api/mcp"
        />
      );
      await screen.findByText("Synthetic company");
      if (prepare) {
        expect(
          screen.getByText(/each change needs your approval in OPS/i)
        ).toBeInTheDocument();
        expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument();
        expect(screen.getByText("ACCESS")).toBeInTheDocument();
      } else {
        expect(
          screen.getByText("Read-only. Nothing gets changed in OPS.")
        ).toBeInTheDocument();
        expect(screen.getByText("CAN VIEW")).toBeInTheDocument();
      }
    }
  );
});
