import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fragment, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposeEmailForm } from "@/components/ops/compose-email-form";
import {
  communicationDraftKey,
  useCommunicationDraftStore,
} from "@/stores/communication-draft-store";

const { authedFetch, toastSuccess, toastError } = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
const onClose = vi.fn();

vi.mock("@/lib/utils/authed-fetch", () => ({ authedFetch }));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => key,
    dict: {},
  }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    currentUser: { id: "actor-1", firstName: "Alex" },
    company: { id: "company-1", name: "OPS Test" },
  }),
}));

vi.mock("@/lib/hooks/use-email-connections", () => ({
  useEmailConnections: () => ({
    data: [
      {
        id: "connection-1",
        companyId: "company-1",
        provider: "gmail",
        type: "company",
        userId: null,
        email: "ops@example.com",
        syncEnabled: true,
        lastSyncedAt: null,
        syncIntervalMinutes: 5,
        syncFilters: {},
        opsLabelId: null,
        aiReviewEnabled: false,
        aiMemoryEnabled: false,
        status: "active",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
  }),
}));

vi.mock("@/lib/hooks/use-email-templates", () => ({
  useEmailTemplates: () => ({ data: [] }),
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

function successfulResponse() {
  return {
    ok: true,
    json: async () => ({ delivered: true }),
  } as Response;
}

const DRAFT_KEY = communicationDraftKey({
  actorUserId: "actor-1",
  surface: "floating-email",
  opportunityId: "lead-1",
  instanceId: "compose-1",
});

function ComposeHarness() {
  const [epoch, setEpoch] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setEpoch((value) => value + 1)}>
        Rotate query authority
      </button>
      <Fragment key={epoch}>
        <ComposeEmailForm
          composeData={{
            mode: "new",
            to: "client@example.com",
            subject: "Deck rebuild",
            opportunityId: "lead-1",
          }}
          draftInstanceId="compose-1"
          onClose={onClose}
        />
      </Fragment>
    </>
  );
}

async function beginSend(body: string) {
  const user = userEvent.setup();
  render(<ComposeHarness />);
  const bodyInput = screen.getByPlaceholderText("body.placeholder");
  await user.type(bodyInput, body);
  await waitFor(() =>
    expect(useCommunicationDraftStore.getState().drafts[DRAFT_KEY]?.body).toBe(
      body
    )
  );
  await user.click(screen.getByRole("button", { name: "send" }));
  await waitFor(() =>
    expect(
      useCommunicationDraftStore.getState().drafts[DRAFT_KEY]?.state.sendPending
    ).toBe(true)
  );
  return user;
}

beforeEach(() => {
  authedFetch.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  onClose.mockReset();
  useCommunicationDraftStore.getState().clear();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "11111111-1111-4111-8111-111111111111"
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ComposeEmailForm communication draft continuity", () => {
  it("keeps human text, pending disable, and one idempotency attempt through an unrelated query remount", async () => {
    const firstRequest = deferred<Response>();
    authedFetch
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(successfulResponse());

    const user = await beginSend("Keep the hand-written scope intact.");
    const firstPayload = JSON.parse(
      (authedFetch.mock.calls[0]?.[1] as RequestInit).body as string
    ) as { idempotencyKey: string };

    act(() => {
      useCommunicationDraftStore
        .getState()
        .removeForOpportunity("unrelated-lead");
    });
    await user.click(
      screen.getByRole("button", { name: "Rotate query authority" })
    );

    expect(screen.getByPlaceholderText("body.placeholder")).toHaveValue(
      "Keep the hand-written scope intact."
    );
    expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
    expect(useCommunicationDraftStore.getState().drafts[DRAFT_KEY]).toEqual(
      expect.objectContaining({
        body: "Keep the hand-written scope intact.",
        state: expect.objectContaining({ sendPending: true }),
      })
    );

    await act(async () => {
      firstRequest.reject(new Error("temporary transport failure"));
      await firstRequest.promise.catch(() => undefined);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "send" })).toBeEnabled()
    );

    await user.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(authedFetch).toHaveBeenCalledTimes(2));
    const retryPayload = JSON.parse(
      (authedFetch.mock.calls[1]?.[1] as RequestInit).body as string
    ) as { idempotencyKey: string };

    expect(retryPayload.idempotencyKey).toBe(firstPayload.idempotencyKey);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it.each(["resolve", "reject"] as const)(
    "does not recreate or toast after a matching lead purge when the request later %ss",
    async (settlement) => {
      const request = deferred<Response>();
      authedFetch.mockReturnValueOnce(request.promise);
      await beginSend("This lead was handed off.");

      act(() => {
        useCommunicationDraftStore.getState().removeForOpportunity("lead-1");
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
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    }
  );

  it("fails closed on a full actor clear while preserving an unrelated lead during a scoped purge", async () => {
    const request = deferred<Response>();
    authedFetch.mockReturnValueOnce(request.promise);
    await beginSend("Actor-owned text");
    useCommunicationDraftStore.getState().save("other-draft", {
      actorUserId: "actor-1",
      surface: "floating-email",
      threadId: null,
      opportunityId: "lead-2",
      instanceId: "compose-2",
      body: "Other lead text",
      state: {},
      updatedAt: Date.now(),
    });

    act(() => {
      useCommunicationDraftStore.getState().removeForOpportunity("lead-2");
    });
    expect(useCommunicationDraftStore.getState().drafts[DRAFT_KEY]?.body).toBe(
      "Actor-owned text"
    );

    act(() => {
      useCommunicationDraftStore.getState().clear();
    });
    await act(async () => {
      request.reject(new Error("late actor-A failure"));
      await request.promise.catch(() => undefined);
    });

    expect(useCommunicationDraftStore.getState().drafts).toEqual({});
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("recomputes sender switching when the thread mailbox changes but the preserved sender stays the same", async () => {
    const threadDraftKey = communicationDraftKey({
      actorUserId: "actor-1",
      surface: "floating-email",
      threadId: "thread-1",
      opportunityId: "lead-1",
      instanceId: "compose-mailbox-change",
    });
    useCommunicationDraftStore.getState().save(threadDraftKey, {
      actorUserId: "actor-1",
      surface: "floating-email",
      threadId: "thread-1",
      opportunityId: "lead-1",
      instanceId: "compose-mailbox-change",
      body: "Keep this reply on the current thread.",
      state: { selectedConnectionId: "connection-1" },
      updatedAt: Date.now(),
    });
    authedFetch.mockResolvedValueOnce(successfulResponse());
    const user = userEvent.setup();
    const baseComposeData = {
      mode: "reply" as const,
      to: "client@example.com",
      subject: "Deck rebuild",
      threadId: "thread-1",
      opportunityId: "lead-1",
    };
    const { rerender } = render(
      <ComposeEmailForm
        composeData={{
          ...baseComposeData,
          connectionId: "previous-thread-connection",
        }}
        draftInstanceId="compose-mailbox-change"
        onClose={onClose}
      />
    );

    // The preserved sender remains connection-1, so effectiveConnectionId does
    // not change. Only the thread's canonical mailbox identity changes.
    rerender(
      <ComposeEmailForm
        composeData={{ ...baseComposeData, connectionId: "connection-1" }}
        draftInstanceId="compose-mailbox-change"
        onClose={onClose}
      />
    );
    await user.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(authedFetch).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(
      (authedFetch.mock.calls[0]?.[1] as RequestInit).body as string
    ) as { connectionId: string; senderSwitched: boolean };
    expect(payload.connectionId).toBe("connection-1");
    expect(payload.senderSwitched).toBe(false);
  });
});
