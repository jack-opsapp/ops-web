import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { GuidedCatalogSetup } from "../guided-catalog-setup";

const mocks = vi.hoisted(() => ({
  getIdToken: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: mocks.getIdToken,
}));

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const baseSession = {
  id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
  status: "interviewing",
  version: 1,
  facts: [],
  unresolvedQuestions: [
    {
      id: "tax",
      prompt: "Is GST added on top?",
      answerKind: "boolean",
      factKeys: ["tax.gst"],
    },
  ],
  proposedPlan: null,
  proposedPlanHash: null,
  readback: null,
};

const reviewSession = {
  ...baseSession,
  status: "review",
  version: 9,
  unresolvedQuestions: [],
  proposedPlanHash: "sha256:reviewed-plan",
  proposedPlan: {
    version: 1,
    summary: "2 products",
    ready: true,
    issues: [],
    actions: [
      {
        actionKey: "create:product:vinyl-install-68",
        group: "CREATE",
        actionType: "upsert_product",
        targetKind: "product",
        clientId: "vinyl-install-68",
        dependsOn: [],
        payload: {
          name: "Vinyl membrane installation",
          basePrice: 11.73,
          minimumCharge: 1500,
          pricingUnit: "sqft",
          showInStorefront: true,
        },
      },
      {
        actionKey: "create:product:vinyl-install-60",
        group: "CREATE",
        actionType: "upsert_product",
        targetKind: "product",
        clientId: "vinyl-install-60",
        dependsOn: [],
        payload: {
          name: "Vinyl membrane installation — 60mil",
          basePrice: 12.73,
          minimumCharge: 1500,
          pricingUnit: "sqft",
          showInStorefront: false,
        },
      },
    ],
  },
};

function renderSetup(
  props: Partial<React.ComponentProps<typeof GuidedCatalogSetup>> = {},
) {
  return render(
    <GuidedCatalogSetup
      onUseAnotherMethod={vi.fn()}
      onExit={vi.fn()}
      onAddInventoryList={vi.fn()}
      {...props}
    />,
  );
}

describe("GuidedCatalogSetup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getIdToken.mockResolvedValue("firebase-token");
  });

  it("opens the durable guided session and sends one answer at a time", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true }),
      )
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          answer: true,
          expectedVersion: 1,
        });
        return response({
          session: {
            ...baseSession,
            version: 2,
            facts: [{ key: "tax.gst", value: true }],
            unresolvedQuestions: [
              {
                id: "minimum",
                prompt: "What is the minimum charge?",
                answerKind: "number",
                factKeys: ["pricing.minimum"],
              },
            ],
          },
        });
      });

    renderSetup();
    expect(
      await screen.findByText("Is GST added on top?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "YES" }));
    expect(
      await screen.findByText("What is the minimum charge?"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("commits only the reviewed plan hash and offers the separate inventory handoff", async () => {
    const addInventory = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: reviewSession, agentAvailable: true }),
      )
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          approvalHash: "sha256:reviewed-plan",
        });
        return response({
          ok: true,
          status: "complete",
          readback: { products: 2, status: "verified" },
          blockers: [],
        });
      });

    renderSetup({ onAddInventoryList: addInventory });
    expect(
      await screen.findByText("Vinyl membrane installation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vinyl membrane installation — 60mil"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "BUILD CATALOG" }),
    );
    expect(
      await screen.findByText(
        "Do you have a current inventory list you want me to add?",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "ADD INVENTORY LIST" }),
    );
    await waitFor(() =>
      expect(addInventory).toHaveBeenCalledWith(
        "54ce9e88-5688-4e73-ae4e-a62f85044b77",
        undefined,
      ),
    );
  });

  it("shows the recoverable attention state returned by a guarded commit", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: reviewSession, agentAvailable: true }),
      )
      .mockImplementationOnce(() =>
        response(
          {
            ok: false,
            status: "attention",
            readback: {
              status: "attention",
              verificationIssues: [
                { code: "product_readback_mismatch" },
              ],
            },
            blockers: [
              {
                code: "readback_verification_failed",
                message: "One live record did not match the approved plan.",
              },
            ],
          },
          422,
        ),
      );

    renderSetup();
    await screen.findByText("Vinyl membrane installation");
    fireEvent.click(
      screen.getByRole("button", { name: "BUILD CATALOG" }),
    );

    expect(
      await screen.findByTestId("guided-catalog-attention"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("MOST OF YOUR CATALOG IS READY"),
    ).toBeInTheDocument();
  });

  it("shows deterministic setup methods when the agent is unavailable", async () => {
    const useAnother = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({ session: null, agentAvailable: false }),
    );

    renderSetup({ onUseAnotherMethod: useAnother });
    expect(
      await screen.findByText("GUIDED SETUP IS OFFLINE"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "USE ANOTHER METHOD" }),
    );
    expect(useAnother).toHaveBeenCalledOnce();
  });
});
