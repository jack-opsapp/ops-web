import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fragment, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineListWidget } from "@/components/dashboard/widgets/pipeline-list-widget";
import { OpportunityStage, type Opportunity } from "@/lib/types/pipeline";
import {
  communicationDraftKey,
  useCommunicationDraftStore,
} from "@/stores/communication-draft-store";

const mocks = vi.hoisted(() => ({
  auth: {
    currentUser: {
      id: "actor-1",
      companyId: "company-1",
      firstName: "Alex",
      lastName: "Operator",
      email: "alex@example.com",
      role: "operator",
    },
    company: {
      id: "company-1",
      name: "OPS Test",
      adminIds: [],
    },
  },
  authedFetch: vi.fn(),
  createActivity: vi.fn(),
  moveStage: vi.fn(),
  navigate: vi.fn(),
  openEntity: vi.fn(),
  opportunities: [] as unknown[],
  showWidgetActionToast: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.navigate }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => mocks.auth,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "pipelineList.activePipeline": "Active pipeline",
        "pipelineList.advance": "Advance",
        "pipelineList.composePlaceholder": "Quick follow-up message...",
        "pipelineList.empty": "No leads",
        "pipelineList.filterActivePipeline": "Active pipeline",
        "pipelineList.followUp": "Follow Up",
        "pipelineList.followUpSubjectPrefix": "Follow up",
        "pipelineList.mergeHint": "Use merge fields",
        "pipelineList.send": "Send",
        "pipelineList.unknown": "Unknown",
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock("@/lib/hooks", () => ({
  useClientMap: () => new Map(),
  useCreateActivity: () => ({ mutate: mocks.createActivity }),
  useMoveOpportunityStage: () => ({ mutate: mocks.moveStage }),
  useOpportunities: () => ({
    data: mocks.opportunities,
    isLoading: false,
  }),
}));

vi.mock("@/lib/hooks/use-email-connections", () => ({
  useEmailConnections: () => ({
    data: [
      {
        id: "connection-1",
        status: "active",
      },
    ],
  }),
}));

vi.mock("@/lib/hooks/use-email-templates", () => ({
  useEmailTemplates: () => ({ data: [] }),
}));

vi.mock(
  "@/components/dashboard/widgets/shared/use-widget-intersection",
  () => ({ useWidgetIntersection: () => true })
);

vi.mock("@/components/dashboard/widgets/shared/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

vi.mock("@/components/dashboard/widgets/shared/use-widget-entity-open", () => ({
  useWidgetEntityOpen: () => mocks.openEntity,
}));

vi.mock("@/components/dashboard/widgets/shared/widget-action-toast", () => ({
  showWidgetActionToast: mocks.showWidgetActionToast,
}));

vi.mock("@/lib/utils/authed-fetch", () => ({
  authedFetch: mocks.authedFetch,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: Object.assign(mocks.toast, {
    error: mocks.toastError,
  }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function successfulResponse(): Response {
  return {
    ok: true,
    json: async () => ({ delivered: true }),
  } as Response;
}

const OPPORTUNITY = {
  id: "lead-1",
  companyId: "company-1",
  clientId: null,
  title: "Deck rebuild",
  contactName: "Morgan Lee",
  contactEmail: "morgan@example.com",
  stage: OpportunityStage.Qualifying,
  stageEnteredAt: new Date("2026-07-01T00:00:00.000Z"),
  estimatedValue: 12_500,
  deletedAt: null,
} as Opportunity;

const DRAFT_KEY = communicationDraftKey({
  actorUserId: "actor-1",
  surface: "pipeline-follow-up",
  opportunityId: OPPORTUNITY.id,
});

function WidgetHarness() {
  const [epoch, setEpoch] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setEpoch((value) => value + 1)}>
        Rotate query authority
      </button>
      <Fragment key={epoch}>
        <PipelineListWidget size="lg" config={{}} />
      </Fragment>
    </>
  );
}

async function openComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Follow Up" }));
  return screen.getByPlaceholderText("Quick follow-up message...");
}

async function beginSend(body: string) {
  const user = userEvent.setup();
  render(<WidgetHarness />);
  const input = await openComposer(user);
  await user.type(input, body);
  await waitFor(() =>
    expect(useCommunicationDraftStore.getState().drafts[DRAFT_KEY]?.body).toBe(
      body
    )
  );
  const sendButton = screen.getByRole("button", { name: "Send" });
  await user.click(sendButton);
  await waitFor(() =>
    expect(
      useCommunicationDraftStore.getState().drafts[DRAFT_KEY]?.state.sendPending
    ).toBe(true)
  );
  return { sendButton, user };
}

beforeEach(() => {
  mocks.authedFetch.mockReset();
  mocks.createActivity.mockReset();
  mocks.moveStage.mockReset();
  mocks.navigate.mockReset();
  mocks.openEntity.mockReset();
  mocks.showWidgetActionToast.mockReset();
  mocks.toast.mockReset();
  mocks.toastError.mockReset();
  mocks.opportunities = [OPPORTUNITY];
  useCommunicationDraftStore.getState().clear();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "11111111-1111-4111-8111-111111111111"
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useCommunicationDraftStore.getState().clear();
});

describe("PipelineListWidget quick follow-up draft continuity", () => {
  it("keeps the human-authored body through a query-security Fragment remount", async () => {
    const user = userEvent.setup();
    render(<WidgetHarness />);
    const input = await openComposer(user);
    await user.type(input, "Keep the hand-written scope intact.");
    await waitFor(() =>
      expect(
        useCommunicationDraftStore.getState().drafts[DRAFT_KEY]?.body
      ).toBe("Keep the hand-written scope intact.")
    );

    await user.click(
      screen.getByRole("button", { name: "Rotate query authority" })
    );
    const remountedInput = await openComposer(user);

    expect(remountedInput).toHaveValue("Keep the hand-written scope intact.");
  });

  it("keeps an unrelated-remount send disabled and reuses the exact idempotency key after a late rejection", async () => {
    const firstRequest = deferred<Response>();
    const retryRequest = deferred<Response>();
    mocks.authedFetch
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(retryRequest.promise);

    const { sendButton, user } = await beginSend("Checking in on the deck.");
    expect(sendButton).toBeDisabled();
    expect(mocks.authedFetch).toHaveBeenCalledTimes(1);
    const firstPayload = JSON.parse(
      (mocks.authedFetch.mock.calls[0]?.[1] as RequestInit).body as string
    ) as { idempotencyKey: string };

    act(() => {
      useCommunicationDraftStore
        .getState()
        .removeForOpportunity("unrelated-lead");
    });
    await user.click(
      screen.getByRole("button", { name: "Rotate query authority" })
    );
    const remountedInput = await openComposer(user);

    expect(remountedInput).toHaveValue("Checking in on the deck.");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await act(async () => {
      firstRequest.reject(new Error("temporary transport failure"));
      await firstRequest.promise.catch(() => undefined);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled()
    );

    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.authedFetch).toHaveBeenCalledTimes(2));
    const retryPayload = JSON.parse(
      (mocks.authedFetch.mock.calls[1]?.[1] as RequestInit).body as string
    ) as { idempotencyKey: string };

    expect(retryPayload.idempotencyKey).toBe(firstPayload.idempotencyKey);
    expect(screen.getByText("...").closest("button")).toBeDisabled();
  });

  it("removes the matching opportunity draft while preserving unrelated opportunity drafts", async () => {
    const user = userEvent.setup();
    render(<WidgetHarness />);
    const input = await openComposer(user);
    await user.type(input, "Lead one draft");
    const otherKey = communicationDraftKey({
      actorUserId: "actor-1",
      surface: "pipeline-follow-up",
      opportunityId: "lead-2",
    });
    act(() => {
      useCommunicationDraftStore.getState().save(otherKey, {
        actorUserId: "actor-1",
        surface: "pipeline-follow-up",
        threadId: null,
        opportunityId: "lead-2",
        instanceId: null,
        body: "Lead two draft",
        state: {},
        updatedAt: Date.now(),
      });
      useCommunicationDraftStore
        .getState()
        .removeForOpportunity(OPPORTUNITY.id);
    });

    expect(useCommunicationDraftStore.getState().drafts[DRAFT_KEY]).toBe(
      undefined
    );
    expect(useCommunicationDraftStore.getState().drafts[otherKey]?.body).toBe(
      "Lead two draft"
    );
  });

  it("preserves the quick follow-up draft when an unrelated opportunity is purged", async () => {
    const user = userEvent.setup();
    render(<WidgetHarness />);
    const input = await openComposer(user);
    await user.type(input, "Do not lose this draft");

    act(() => {
      useCommunicationDraftStore
        .getState()
        .removeForOpportunity("unrelated-lead");
    });

    expect(useCommunicationDraftStore.getState().drafts[DRAFT_KEY]?.body).toBe(
      "Do not lose this draft"
    );
  });

  it("removes every pipeline follow-up draft on a full actor clear", async () => {
    const user = userEvent.setup();
    render(<WidgetHarness />);
    const input = await openComposer(user);
    await user.type(input, "Actor-owned draft");

    act(() => {
      useCommunicationDraftStore.getState().clear();
    });

    expect(useCommunicationDraftStore.getState().drafts).toEqual({});
  });

  it.each(["resolve", "reject"] as const)(
    "does not recreate the purged draft or emit a toast when a request later %ss",
    async (settlement) => {
      const request = deferred<Response>();
      mocks.authedFetch.mockReturnValueOnce(request.promise);
      await beginSend("This lead was handed off.");

      act(() => {
        useCommunicationDraftStore
          .getState()
          .removeForOpportunity(OPPORTUNITY.id);
      });
      expect(useCommunicationDraftStore.getState().drafts[DRAFT_KEY]).toBe(
        undefined
      );

      await act(async () => {
        if (settlement === "resolve") request.resolve(successfulResponse());
        else request.reject(new Error("late failure"));
        await request.promise.catch(() => undefined);
      });

      expect(useCommunicationDraftStore.getState().drafts[DRAFT_KEY]).toBe(
        undefined
      );
      expect(mocks.showWidgetActionToast).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(mocks.createActivity).not.toHaveBeenCalled();
    }
  );
});
