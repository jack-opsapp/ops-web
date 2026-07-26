import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
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
  conversation: [
    {
      id: "assistant:1:tax",
      role: "assistant",
      kind: "text",
      content: "Is GST added on top?",
      version: 1,
    },
  ],
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

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);

describe("GuidedCatalogSetup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      }),
    });
    mocks.getIdToken.mockResolvedValue("firebase-token");
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoView,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
    if (originalScrollTo) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollTo",
        originalScrollTo,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
    }
  });

  it("does not scroll an ancestor or move a short first-turn transcript", async () => {
    const scrollIntoView = vi.fn();
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "log" ? 160 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "log" ? 240 : 0;
      },
    );
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({
        session: {
          ...baseSession,
          unresolvedQuestions: [
            {
              id: "first-service-line",
              prompt: "What service do you want to set up first?",
              answerKind: "text",
              factKeys: ["customer_products.first_service_line"],
              help: "Describe the service, or upload a CSV or Excel price sheet.",
            },
          ],
          conversation: [
            {
              id: "assistant:1:first-service-line",
              role: "assistant",
              kind: "text",
              content: "What service do you want to set up first?",
              version: 1,
            },
          ],
        },
        agentAvailable: true,
      }),
    );

    renderSetup();

    await screen.findByText("What service do you want to set up first?");
    await waitFor(() => {
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });

  it("positions an overflowing transcript on the transcript element only", async () => {
    const scrollIntoView = vi.fn();
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "log" ? 640 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "log" ? 240 : 0;
      },
    );
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({ session: baseSession, agentAvailable: true }),
    );

    renderSetup();

    const transcript = await screen.findByRole("log", {
      name: "Catalog setup conversation",
    });
    await waitFor(() => {
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(scrollTo).toHaveBeenCalledWith({
        top: 640,
        behavior: "auto",
      });
    });
    expect(scrollTo.mock.instances).toContain(transcript);
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

  it("acknowledges a submitted answer immediately and exposes a true working state", async () => {
    let finishTurn:
      | ((value: Response | PromiseLike<Response>) => void)
      | undefined;
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishTurn = resolve;
          }),
      );

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.click(screen.getByRole("button", { name: "YES" }));

    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Phase C is working" }),
    ).toBeInTheDocument();
    const workingButton = screen.getByRole("button", { name: "WORKING…" });
    expect(workingButton).toBeDisabled();
    expect(workingButton).toHaveClass("pointer-events-none");

    await waitFor(() => expect(finishTurn).toBeDefined());
    await act(async () => {
      finishTurn!(
        new Response(
          JSON.stringify({
            session: {
              ...baseSession,
              version: 2,
              conversation: [
                ...baseSession.conversation,
                {
                  id: "operator:2:tax",
                  role: "operator",
                  kind: "text",
                  content: "Yes",
                  version: 2,
                },
                {
                  id: "assistant:2:minimum",
                  role: "assistant",
                  kind: "text",
                  content: "What is the minimum charge?",
                  version: 2,
                },
              ],
              unresolvedQuestions: [
                {
                  id: "minimum",
                  prompt: "What is the minimum charge?",
                  answerKind: "number",
                  factKeys: ["pricing.minimum"],
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      await Promise.resolve();
    });
    expect(
      await screen.findByText("What is the minimum charge?"),
    ).toBeInTheDocument();
  });

  it("restores the persisted transcript with readable conversational typography", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({
        session: {
          ...baseSession,
          version: 2,
          conversation: [
            ...baseSession.conversation,
            {
              id: "operator:2:tax",
              role: "operator",
              kind: "text",
              content: "Yes",
              version: 2,
            },
            {
              id: "assistant:2:minimum",
              role: "assistant",
              kind: "text",
              content: "What is the minimum charge?",
              version: 2,
            },
          ],
          unresolvedQuestions: [
            {
              id: "minimum",
              prompt: "What is the minimum charge?",
              answerKind: "number",
              factKeys: ["pricing.minimum"],
            },
          ],
        },
        agentAvailable: true,
      }),
    );

    renderSetup();

    expect(await screen.findByText("Yes")).toBeInTheDocument();
    const assistantMessage = screen
      .getByText("What is the minimum charge?")
      .closest('[data-message-role="assistant"]');
    expect(assistantMessage).toHaveClass("font-mohave");
    expect(assistantMessage).not.toHaveClass("uppercase");
    expect(assistantMessage).not.toHaveClass("font-cakemono");
  });

  it("keeps a failed answer visible and retries the exact answer without duplication", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            unresolvedQuestions: [
              {
                id: "service",
                prompt: "What service do you want to set up first?",
                answerKind: "text",
                factKeys: ["customer_products.first_service_line"],
              },
            ],
            conversation: [
              {
                id: "assistant:1:service",
                role: "assistant",
                kind: "text",
                content: "What service do you want to set up first?",
                version: 1,
              },
            ],
          },
          agentAvailable: true,
        }),
      )
      .mockImplementationOnce(() =>
        response({ error: "Setup could not continue" }, 500),
      )
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          answer: "Vinyl membrane installation",
          expectedVersion: 1,
        });
        return response({
          session: {
            ...baseSession,
            version: 2,
            conversation: [
              {
                id: "assistant:1:service",
                role: "assistant",
                kind: "text",
                content: "What service do you want to set up first?",
                version: 1,
              },
              {
                id: "operator:2:service",
                role: "operator",
                kind: "text",
                content: "Vinyl membrane installation",
                version: 2,
              },
              {
                id: "assistant:2:supplier",
                role: "assistant",
                kind: "text",
                content: "Which supplier do you use?",
                version: 2,
              },
            ],
            unresolvedQuestions: [
              {
                id: "supplier",
                prompt: "Which supplier do you use?",
                answerKind: "text",
                factKeys: ["suppliers.primary"],
              },
            ],
          },
        });
      });

    renderSetup();
    await screen.findByText("What service do you want to set up first?");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Vinyl membrane installation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));

    expect(
      await screen.findByText("Setup could not continue"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Vinyl membrane installation"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "[ try again ]" }));

    expect(await screen.findByText("Which supplier do you use?")).toBeInTheDocument();
    expect(
      screen.getAllByText("Vinyl membrane installation"),
    ).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the shared tokenized field and counts only operator-confirmed decisions", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({
        session: {
          ...baseSession,
          facts: [
            {
              id: "live-products",
              classification: "customer_product",
              key: "live_ops.active_customer_products",
              value: [],
              source: { kind: "live_ops" },
              confidence: 1,
              status: "confirmed",
              contradicts: [],
            },
            {
              id: "live-task-types",
              classification: "task_type_behavior",
              key: "live_ops.active_task_types_available",
              value: ["Vinyl Install"],
              source: { kind: "live_ops" },
              confidence: 1,
              status: "confirmed",
              contradicts: [],
            },
            {
              id: "operator-service",
              classification: "customer_product",
              key: "customer_products.first_service_line",
              value: "Vinyl membrane installation",
              source: { kind: "operator" },
              confidence: 1,
              status: "confirmed",
              contradicts: [],
            },
          ],
          unresolvedQuestions: [
            {
              id: "service-description",
              prompt: "What do you install?",
              answerKind: "text",
              factKeys: ["customer_products.description"],
            },
          ],
        },
        agentAvailable: true,
      }),
    );

    renderSetup();

    expect(
      await screen.findByText("Confirmed decisions · 1"),
    ).toBeInTheDocument();
    const field = screen.getByRole("textbox");
    expect(field).toHaveClass("bg-surface-input");
    expect(field).not.toHaveClass("bg-glass-fill");
  });

  it("feeds an optional CSV price sheet into the current guided turn", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            unresolvedQuestions: [
              {
                id: "first-service-line",
                prompt: "What service do you want to set up first?",
                answerKind: "text",
                factKeys: ["customer_products.first_service_line"],
                help: "Describe the service, or upload a CSV or Excel price sheet.",
              },
            ],
          },
          agentAvailable: true,
        }),
      )
      .mockImplementationOnce((_input, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.expectedVersion).toBe(1);
        expect(body.answer).toEqual({
          kind: "catalog_source_document",
          filename: "vinyl.csv",
          format: "csv",
          headers: ["Product", "Price"],
          rows: [
            {
              Product: "Vinyl membrane installation",
              Price: "11.73",
            },
          ],
          rowCount: 1,
        });
        return response({
          session: {
            ...baseSession,
            version: 2,
            facts: [],
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
    await screen.findByText("What service do you want to set up first?");
    fireEvent.change(screen.getByLabelText("Upload price sheet"), {
      target: {
        files: [
          new File(
            ["Product,Price\nVinyl membrane installation,11.73"],
            "vinyl.csv",
            { type: "text/csv" },
          ),
        ],
      },
    });

    expect(
      await screen.findByText("What is the minimum charge?"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retires the current setup and opens a clean session after confirmation", async () => {
    const freshSession = {
      ...baseSession,
      id: "92b13861-51ad-4cb9-8771-a8066a0930b2",
      version: 0,
      facts: [],
      unresolvedQuestions: [
        {
          id: "first-service-line",
          prompt: "What service do you want to set up first?",
          answerKind: "text",
          factKeys: ["customer_products.first_service_line"],
        },
      ],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true }),
      )
      .mockImplementationOnce((input, init) => {
        expect(String(input)).toContain(
          "/api/catalog/setup/sessions/54ce9e88-5688-4e73-ae4e-a62f85044b77/abandon",
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          expectedVersion: 1,
        });
        return response({
          session: { ...baseSession, status: "abandoned", version: 2 },
        });
      })
      .mockImplementationOnce((input) => {
        expect(input).toBe("/api/catalog/setup/sessions");
        return response({
          session: freshSession,
          agentAvailable: true,
          resumed: false,
        });
      });

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.click(
      screen.getByRole("button", { name: "[ start over ]" }),
    );
    expect(
      screen.getByText("START THIS SETUP AGAIN?"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "START OVER" }),
    );

    expect(
      await screen.findByText("What service do you want to set up first?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirmed decisions · 0")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
