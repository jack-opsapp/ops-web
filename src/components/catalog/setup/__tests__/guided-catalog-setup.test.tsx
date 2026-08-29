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
  reducedMotion: false,
}));

vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: mocks.getIdToken,
}));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => mocks.reducedMotion,
  };
});

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

const baseSession = {
  id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
  status: "interviewing",
  version: 1,
  inputRevision: 0,
  processedInputRevision: 0,
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
  props: Partial<React.ComponentProps<typeof GuidedCatalogSetup>> = {}
) {
  return render(
    <GuidedCatalogSetup
      onUseAnotherMethod={vi.fn()}
      onExit={vi.fn()}
      onAddInventoryList={vi.fn()}
      {...props}
    />
  );
}

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView"
);
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo"
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
    mocks.reducedMotion = false;
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoView
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
    if (originalScrollTo) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollTo",
        originalScrollTo
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
      }
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "log" ? 240 : 0;
      }
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
      })
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
      }
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "log" ? 240 : 0;
      }
    );
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({ session: baseSession, agentAvailable: true })
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

  it("persists an answer before generating from its input revision", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce((input, init) => {
        expect(String(input)).toContain("/messages");
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          operation: "append",
          answer: true,
          expectedVersion: 1,
          expectedInputId: undefined,
        });
        return response({
          session: {
            ...baseSession,
            version: 2,
            inputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Yes",
                version: 2,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        });
      })
      .mockImplementationOnce((input, init) => {
        expect(String(input)).toContain("/turn");
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          expectedVersion: 2,
          expectedInputRevision: 1,
        });
        return response({
          session: {
            ...baseSession,
            version: 3,
            inputRevision: 1,
            processedInputRevision: 1,
            facts: [{ key: "tax.gst", value: true }],
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "accepted",
                role: "operator",
                kind: "text",
                content: "Yes",
                version: 2,
              },
              {
                id: "assistant:3:minimum",
                role: "assistant",
                kind: "text",
                content: "What is the minimum charge?",
                version: 3,
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
          superseded: false,
        });
      });

    renderSetup();
    expect(await screen.findByText("Is GST added on top?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "YES" }));
    expect(
      await screen.findByText("What is the minimum charge?")
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the compact composer available for a quick follow-up while Phase C works", async () => {
    let finishTurn:
      ((value: Response | PromiseLike<Response>) => void) | undefined;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            version: 2,
            inputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Yes",
                version: 2,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishTurn = resolve;
          })
      )
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          operation: "append",
          answer: "Actually, only for installed work",
          expectedVersion: 2,
          expectedInputId: undefined,
        });
        return response({
          session: {
            ...baseSession,
            version: 3,
            inputRevision: 2,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Yes",
                version: 2,
              },
              {
                id: "operator-input:input-2",
                inputId: "input-2",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Actually, only for installed work",
                version: 3,
              },
            ],
          },
          input: { id: "input-2", state: "queued" },
        });
      })
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          expectedVersion: 3,
          expectedInputRevision: 2,
        });
        return response({
          session: {
            ...baseSession,
            version: 4,
            inputRevision: 2,
            processedInputRevision: 2,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "accepted",
                role: "operator",
                kind: "text",
                content: "Yes",
                version: 2,
              },
              {
                id: "operator-input:input-2",
                inputId: "input-2",
                state: "accepted",
                role: "operator",
                kind: "text",
                content: "Actually, only for installed work",
                version: 3,
              },
              {
                id: "assistant:4:minimum",
                role: "assistant",
                kind: "text",
                content: "What is the minimum charge?",
                version: 4,
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
          superseded: false,
        });
      });

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.click(screen.getByRole("button", { name: "YES" }));

    const firstAnswer = await screen.findByText("Yes");
    expect(
      firstAnswer.closest('[data-message-role="operator"]')
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("phase-c-processing-sweep")).toBeInTheDocument();
    expect(
      screen.queryByText(/phase c is checking your (answer|message)/i)
    ).not.toBeInTheDocument();
    const composer = screen.getByRole("textbox");
    expect(composer).toBeEnabled();
    fireEvent.change(composer, {
      target: { value: "Actually, only for installed work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SEND" }));
    expect(
      await screen.findByText("Actually, only for installed work")
    ).toBeInTheDocument();

    await waitFor(() => expect(finishTurn).toBeDefined());
    await act(async () => {
      finishTurn!(
        new Response(
          JSON.stringify({
            session: {
              ...baseSession,
              version: 3,
              inputRevision: 2,
              conversation: [
                ...baseSession.conversation,
                {
                  id: "operator-input:input-1",
                  inputId: "input-1",
                  state: "queued",
                  role: "operator",
                  kind: "text",
                  content: "Yes",
                  version: 2,
                },
                {
                  id: "operator-input:input-2",
                  inputId: "input-2",
                  state: "queued",
                  role: "operator",
                  kind: "text",
                  content: "Actually, only for installed work",
                  version: 3,
                },
              ],
            },
            turn: null,
            superseded: true,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
  });

  it("removes a queued answer without leaving a loader or surfacing its stale turn error", async () => {
    let finishTurn:
      ((value: Response | PromiseLike<Response>) => void) | undefined;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            version: 2,
            inputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Yes",
                version: 2,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishTurn = resolve;
          })
      )
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          operation: "remove",
          expectedVersion: 2,
          expectedInputId: "input-1",
        });
        return response({
          session: {
            ...baseSession,
            version: 3,
            inputRevision: 2,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "removed",
                role: "operator",
                kind: "text",
                content: "Yes",
                version: 2,
              },
            ],
          },
          input: null,
        });
      });

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.click(screen.getByRole("button", { name: "YES" }));

    const queuedAnswer = await screen.findByText("Yes");
    expect(
      queuedAnswer.closest('[data-message-role="operator"]')
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("phase-c-processing-sweep")).toBeInTheDocument();
    expect(
      screen.queryByText(/phase c is checking your (answer|message)/i)
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "[ remove ]" }));
    await waitFor(() => {
      expect(screen.queryByText("Yes")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("phase-c-processing-sweep")
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "YES" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "NO" })).toBeEnabled();
    });

    await waitFor(() => expect(finishTurn).toBeDefined());
    await act(async () => {
      finishTurn!(
        new Response(JSON.stringify({ error: "Internal error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        })
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("uses a static agent-token processing state when reduced motion is enabled", async () => {
    mocks.reducedMotion = true;
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            version: 2,
            inputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Yes",
                version: 2,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        })
      )
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.click(screen.getByRole("button", { name: "YES" }));

    const sweep = await screen.findByTestId("phase-c-processing-sweep");
    expect(sweep).toHaveClass("bg-agent-bg");
    expect(sweep.querySelector(".will-change-transform")).toBeNull();
    expect(
      screen.getByText("Yes").closest('[data-message-role="operator"]')
    ).toHaveAttribute("aria-busy", "true");
  });

  it("types only the newly generated Phase C response", async () => {
    const nextQuestion =
      "Tell me which vinyl decking service you want customers to see first, including the name they would recognize.";
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            version: 2,
            inputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Vinyl decking",
                version: 2,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        })
      )
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            version: 3,
            inputRevision: 1,
            processedInputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "accepted",
                role: "operator",
                kind: "text",
                content: "Vinyl decking",
                version: 2,
              },
              {
                id: "assistant:3:service-name",
                role: "assistant",
                kind: "text",
                content: nextQuestion,
                version: 3,
              },
            ],
            unresolvedQuestions: [
              {
                id: "service-name",
                prompt: nextQuestion,
                answerKind: "text",
                factKeys: ["customer_products.display_name"],
              },
            ],
          },
          superseded: false,
        })
      );

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Vinyl decking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SEND" }));

    const typewriter = await screen.findByTestId("phase-c-typewriter");
    expect(typewriter.textContent?.length).toBeLessThan(nextQuestion.length);
    expect(screen.getByText("Is GST added on top?")).not.toHaveAttribute(
      "data-testid",
      "phase-c-typewriter"
    );
    await waitFor(
      () => {
        expect(
          screen.queryByTestId("phase-c-typewriter")
        ).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    expect(screen.getByText(nextQuestion)).toBeInTheDocument();
  });

  it("shows a generated Phase C response immediately with reduced motion", async () => {
    mocks.reducedMotion = true;
    const nextQuestion = "Which vinyl decking supplier do you use?";
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            version: 2,
            inputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Vinyl decking",
                version: 2,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        })
      )
      .mockImplementationOnce(() =>
        response({
          session: {
            ...baseSession,
            version: 3,
            inputRevision: 1,
            processedInputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "accepted",
                role: "operator",
                kind: "text",
                content: "Vinyl decking",
                version: 2,
              },
              {
                id: "assistant:3:supplier",
                role: "assistant",
                kind: "text",
                content: nextQuestion,
                version: 3,
              },
            ],
            unresolvedQuestions: [
              {
                id: "supplier",
                prompt: nextQuestion,
                answerKind: "text",
                factKeys: ["suppliers.primary"],
              },
            ],
          },
          superseded: false,
        })
      );

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Vinyl decking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SEND" }));

    expect(await screen.findByText(nextQuestion)).toBeInTheDocument();
    expect(screen.queryByTestId("phase-c-typewriter")).not.toBeInTheDocument();
  });

  it("uses a paper-airplane SEND action and keeps upload inside the composer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({ session: baseSession, agentAvailable: true })
    );

    renderSetup();
    await screen.findByText("Is GST added on top?");

    const composer = screen.getByTestId("guided-catalog-composer");
    const send = screen.getByRole("button", { name: "SEND" });
    const upload = screen.getByRole("button", {
      name: "UPLOAD PRICE SHEET",
    });
    expect(composer).toContainElement(send);
    expect(composer).toContainElement(upload);
    expect(send.querySelector("svg")).not.toBeNull();
    expect(send).toHaveTextContent("SEND");
  });

  it("keeps long quick answers in a collapsible transcript panel instead of the composer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({
        session: {
          ...baseSession,
          version: 17,
          conversation: [
            {
              id: "assistant:17:membrane-inventory",
              role: "assistant",
              kind: "text",
              content:
                "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?",
              version: 17,
            },
          ],
          unresolvedQuestions: [
            {
              id: "membrane-inventory",
              prompt:
                "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?",
              answerKind: "multi_choice",
              factKeys: ["materials.deksmart.inventory_method"],
              options: [
                "Do not track membrane inventory yet; staff purchase/order manually per job, and the product quote price is enough for now.",
                "Track membrane as inventory by sq ft; calculate needed material from quoted deck sq ft plus a staff-adjusted waste allowance.",
                "Track membrane as rolls/sheets; purchasing and inventory need roll/sheet dimensions, coverage, and cost details before setup can be ready.",
              ],
            },
          ],
        },
        agentAvailable: true,
      })
    );

    renderSetup();

    const question = await screen.findByText(
      "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?"
    );
    const message = question.closest('[data-message-role="assistant"]');
    const composer = screen.getByTestId("guided-catalog-composer");
    const quickAnswers = screen.getByRole("group", {
      name: "Quick answers",
    });
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "Pick an option above, or type something else"
    );
    expect(screen.getByRole("textbox")).toHaveClass(
      "text-body-sm",
      "!min-h-control-32"
    );
    expect(message).toContainElement(quickAnswers);
    expect(composer).not.toContainElement(quickAnswers);
    expect(composer).toHaveClass(
      "rounded",
      "border-line",
      "bg-glass-dense",
      "focus-within:border-line-hi"
    );
    expect(composer).not.toHaveClass("glass-surface");

    const choices = screen.getAllByRole("button", {
      name: /track membrane/i,
    });
    expect(choices).toHaveLength(3);
    for (const choice of choices) {
      expect(choice).toHaveClass("font-mohave", "text-body-sm", "text-left");
      expect(choice).not.toHaveClass("font-cakemono", "uppercase");
    }
    fireEvent.click(choices[0]);
    expect(choices[0]).toHaveAttribute("aria-pressed", "true");
    const send = screen.getByRole("button", { name: "SEND" });
    expect(send).toBeEnabled();
    expect(send.closest("form")).toHaveClass("pb-0.5");

    const toggle = screen.getByRole("button", { name: /options/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // DESIGN.md §9: Cake Mono uppercase is reserved for the compact
    // disclosure label; §4: the count is a number, so it stays mono.
    expect(toggle).toHaveClass("font-cakemono", "text-cake-badge", "uppercase");
    expect(toggle).not.toHaveClass("font-mono", "text-micro");
    const optionCount = toggle.querySelector(".font-mono");
    expect(optionCount).not.toBeNull();
    expect(optionCount).toHaveClass("tabular-nums");
    expect(optionCount?.textContent).toContain("3");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(
        screen.queryByRole("group", { name: "Quick answers" })
      ).not.toBeInTheDocument();
    });
    expect(question).toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(
        screen.getByRole("group", { name: "Quick answers" })
      ).toBeVisible();
    });
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
      })
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

  it("shows a selected quick answer after the question it answered and removes the synthetic repeat", async () => {
    const inventoryQuestion =
      "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?";
    const selectedAnswer =
      "Track membrane as rolls/sheets; purchasing and inventory need roll/sheet dimensions, coverage, and cost details before setup can be ready.";
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({
        session: {
          ...baseSession,
          version: 12,
          conversation: [
            {
              id: "assistant:10:membrane-inventory",
              role: "assistant",
              kind: "text",
              content: inventoryQuestion,
              version: 10,
            },
            {
              id: "operator-input:input-1",
              inputId: "input-1",
              state: "accepted",
              role: "operator",
              kind: "text",
              content: selectedAnswer,
              version: 11,
            },
            {
              id: "assistant:11:membrane-inventory",
              role: "assistant",
              kind: "text",
              content: inventoryQuestion,
              version: 11,
            },
            {
              id: "assistant:12:material-tracking-scope",
              role: "assistant",
              kind: "text",
              content:
                "OPS does not track roll or sheet inventory yet. How should 68mil Deksmart PVC Membrane be handled for now?",
              version: 12,
            },
          ],
          unresolvedQuestions: [
            {
              id: "material-tracking-scope",
              intent: "material_tracking_scope",
              capabilityRef: "static-product-materials/v1",
              prompt:
                "OPS does not track roll or sheet inventory yet. How should 68mil Deksmart PVC Membrane be handled for now?",
              answerKind: "single_choice",
              factKeys: ["materials.vinyl.inventory_policy"],
              options: [
                "Keep purchasing and inventory staff-managed",
                "Add a fixed material quantity per product unit",
              ],
            },
          ],
        },
        agentAvailable: true,
      })
    );

    renderSetup();

    const question = await screen.findByText(inventoryQuestion);
    const answer = screen.getByText(selectedAnswer);
    const nextQuestion = screen.getByText(
      "OPS does not track roll or sheet inventory yet. How should 68mil Deksmart PVC Membrane be handled for now?"
    );
    expect(screen.getAllByText(inventoryQuestion)).toHaveLength(1);
    expect(
      question.compareDocumentPosition(answer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      answer.compareDocumentPosition(nextQuestion) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
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
        })
      )
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          operation: "append",
          answer: "Vinyl membrane installation",
          expectedVersion: 1,
          expectedInputId: undefined,
        });
        return response({
          session: {
            ...baseSession,
            version: 2,
            inputRevision: 1,
            conversation: [
              {
                id: "assistant:1:service",
                role: "assistant",
                kind: "text",
                content: "What service do you want to set up first?",
                version: 1,
              },
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Vinyl membrane installation",
                version: 2,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        });
      })
      .mockImplementationOnce(() =>
        response({ error: "Setup could not continue" }, 500)
      )
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          expectedVersion: 2,
          expectedInputRevision: 1,
        });
        return response({
          session: {
            ...baseSession,
            version: 3,
            inputRevision: 1,
            processedInputRevision: 1,
            conversation: [
              {
                id: "assistant:1:service",
                role: "assistant",
                kind: "text",
                content: "What service do you want to set up first?",
                version: 1,
              },
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "accepted",
                role: "operator",
                kind: "text",
                content: "Vinyl membrane installation",
                version: 2,
              },
              {
                id: "assistant:3:supplier",
                role: "assistant",
                kind: "text",
                content: "Which supplier do you use?",
                version: 3,
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
          superseded: false,
        });
      });

    renderSetup();
    await screen.findByText("What service do you want to set up first?");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Vinyl membrane installation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SEND" }));

    expect(
      await screen.findByText("Setup could not continue")
    ).toBeInTheDocument();
    expect(screen.getAllByText("Vinyl membrane installation")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "[ try again ]" }));

    expect(
      await screen.findByText("Which supplier do you use?")
    ).toBeInTheDocument();
    expect(screen.getAllByText("Vinyl membrane installation")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("refreshes and safely persists a follow-up that races a completed turn", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          operation: "append",
          answer: "Vinyl decking",
          expectedVersion: 1,
          expectedInputId: undefined,
        });
        return response(
          { error: "Guided setup changed", code: "input_conflict" },
          409
        );
      })
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
        });
        return response({
          session: {
            ...baseSession,
            version: 2,
          },
          agentAvailable: true,
        });
      })
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          operation: "append",
          answer: "Vinyl decking",
          expectedVersion: 2,
          expectedInputId: undefined,
        });
        return response({
          session: {
            ...baseSession,
            version: 3,
            inputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "text",
                content: "Vinyl decking",
                version: 3,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        });
      })
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          expectedVersion: 3,
          expectedInputRevision: 1,
        });
        return response({
          session: {
            ...baseSession,
            version: 4,
            inputRevision: 1,
            processedInputRevision: 1,
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "accepted",
                role: "operator",
                kind: "text",
                content: "Vinyl decking",
                version: 3,
              },
              {
                id: "assistant:4:supplier",
                role: "assistant",
                kind: "text",
                content: "Which supplier do you use?",
                version: 4,
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
          superseded: false,
        });
      });

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Vinyl decking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SEND" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByText("Vinyl decking")).toBeInTheDocument();
    expect(
      await screen.findByText("Which supplier do you use?")
    ).toBeInTheDocument();
  });

  it("keeps an unsaved typed message in the composer after a save failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce(() =>
        response({ error: "Message could not be saved" }, 503)
      );

    renderSetup();
    await screen.findByText("Is GST added on top?");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Vinyl decking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SEND" }));

    expect(
      await screen.findByText("Message could not be saved")
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Vinyl decking");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      })
    );

    renderSetup();

    expect(
      await screen.findByText("Confirmed decisions · 1")
    ).toBeInTheDocument();
    const field = screen.getByRole("textbox");
    expect(field).toHaveClass(
      "bg-transparent",
      "text-body-sm",
      "!min-h-control-32"
    );
    expect(field).not.toHaveClass("bg-glass-fill");
    // DESIGN.md §9: the entry field is a 32px one-line dock. OPS overrides
    // Tailwind's numeric spacing scale (8 = 64px), so the height cap must
    // come from the control token, never a numeric utility.
    expect(field).toHaveClass("max-h-control-32");
    expect(field).not.toHaveClass("max-h-8");
    expect(field).toHaveAttribute("placeholder", "Type your answer");
    expect(screen.getByTestId("guided-catalog-composer")).toHaveClass(
      "rounded",
      "border-line",
      "bg-glass-dense",
      "focus-within:border-line-hi"
    );
    expect(screen.getByTestId("guided-catalog-composer")).not.toHaveClass(
      "glass-surface"
    );
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
        })
      )
      .mockImplementationOnce((_input, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.expectedVersion).toBe(1);
        expect(body.operation).toBe("append");
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
            inputRevision: 1,
            facts: [],
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "queued",
                role: "operator",
                kind: "source_document",
                content: "vinyl.csv",
                version: 2,
              },
            ],
          },
          input: { id: "input-1", state: "queued" },
        });
      })
      .mockImplementationOnce((_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: "firebase-token",
          expectedVersion: 2,
          expectedInputRevision: 1,
        });
        return response({
          session: {
            ...baseSession,
            version: 3,
            inputRevision: 1,
            processedInputRevision: 1,
            facts: [],
            conversation: [
              ...baseSession.conversation,
              {
                id: "operator-input:input-1",
                inputId: "input-1",
                state: "accepted",
                role: "operator",
                kind: "source_document",
                content: "vinyl.csv",
                version: 2,
              },
              {
                id: "assistant:3:minimum",
                role: "assistant",
                kind: "text",
                content: "What is the minimum charge?",
                version: 3,
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
          superseded: false,
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
            { type: "text/csv" }
          ),
        ],
      },
    });

    expect(
      await screen.findByText("What is the minimum charge?")
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
        response({ session: baseSession, agentAvailable: true })
      )
      .mockImplementationOnce((input, init) => {
        expect(String(input)).toContain(
          "/api/catalog/setup/sessions/54ce9e88-5688-4e73-ae4e-a62f85044b77/abandon"
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
    fireEvent.click(screen.getByRole("button", { name: "[ start over ]" }));
    expect(screen.getByText("START THIS SETUP AGAIN?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "START OVER" }));

    expect(
      await screen.findByText("What service do you want to set up first?")
    ).toBeInTheDocument();
    expect(screen.getByText("Confirmed decisions · 0")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("commits only the reviewed plan hash and offers the separate inventory handoff", async () => {
    const addInventory = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: reviewSession, agentAvailable: true })
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
      await screen.findByText("Vinyl membrane installation")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vinyl membrane installation — 60mil")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "BUILD CATALOG" }));
    expect(
      await screen.findByText(
        "Do you have a current inventory list you want me to add?"
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ADD INVENTORY LIST" }));
    await waitFor(() =>
      expect(addInventory).toHaveBeenCalledWith(
        "54ce9e88-5688-4e73-ae4e-a62f85044b77",
        undefined
      )
    );
  });

  it("shows the recoverable attention state returned by a guarded commit", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        response({ session: reviewSession, agentAvailable: true })
      )
      .mockImplementationOnce(() =>
        response(
          {
            ok: false,
            status: "attention",
            readback: {
              status: "attention",
              verificationIssues: [{ code: "product_readback_mismatch" }],
            },
            blockers: [
              {
                code: "readback_verification_failed",
                message: "One live record did not match the approved plan.",
              },
            ],
          },
          422
        )
      );

    renderSetup();
    await screen.findByText("Vinyl membrane installation");
    fireEvent.click(screen.getByRole("button", { name: "BUILD CATALOG" }));

    expect(
      await screen.findByTestId("guided-catalog-attention")
    ).toBeInTheDocument();
    expect(
      screen.getByText("MOST OF YOUR CATALOG IS READY")
    ).toBeInTheDocument();
  });

  it("shows deterministic setup methods when the agent is unavailable", async () => {
    const useAnother = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      response({ session: null, agentAvailable: false })
    );

    renderSetup({ onUseAnotherMethod: useAnother });
    expect(
      await screen.findByText("GUIDED SETUP IS OFFLINE")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "USE ANOTHER METHOD" }));
    expect(useAnother).toHaveBeenCalledOnce();
  });
});
