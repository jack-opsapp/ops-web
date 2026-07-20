import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authStateReady: vi.fn(),
  getFirebaseAuth: vi.fn(),
  getIdToken: vi.fn(),
  onAuthStateChanged: vi.fn(),
  syncUser: vi.fn(),
  checkRedirectResult: vi.fn(),
  isRedirectPending: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  getIdToken: mocks.getIdToken,
  checkRedirectResult: mocks.checkRedirectResult,
  clearRedirectFlag: vi.fn(),
  isRedirectPending: mocks.isRedirectPending,
  clearRedirectContext: vi.fn(),
}));

vi.mock("@/lib/firebase/config", () => ({
  getFirebaseAuth: mocks.getFirebaseAuth,
}));

vi.mock("@/lib/firebase/dev-bypass", () => ({
  attemptDevBypass: vi.fn(async () => false),
  isDevBypassEnabled: vi.fn(() => false),
}));

vi.mock("@/lib/api/services/user-service", () => ({
  UserService: { syncUser: mocks.syncUser },
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn() },
}));

import { AuthProvider } from "@/components/providers/auth-provider";
import { Providers } from "@/app/providers";
import {
  getQueryClient,
  getQueryClientSecurityEpoch,
  redactAllQueryCacheData,
} from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { UserRole } from "@/lib/types/models";
import { useWindowStore } from "@/stores/window-store";
import { useUndoStore } from "@/stores/undo-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { useCommunicationDraftStore } from "@/stores/communication-draft-store";

const ACTOR_BINDING_STORAGE_KEY = "ops-firebase-actor-binding-v1";

type FirebaseUser = import("firebase/auth").User;
type AuthListener = (user: FirebaseUser | null) => void;

function firebaseUser(uid: string, email: string): FirebaseUser {
  return {
    uid,
    email,
    displayName: email.split("@")[0],
    photoURL: null,
  } as FirebaseUser;
}

function opsUser(id: string, companyId: string) {
  return {
    id,
    companyId,
    role: UserRole.Operator,
    firstName: id,
    lastName: "Operator",
    email: `${id}@example.com`,
  } as never;
}

function company(id: string) {
  return { id, name: id, adminIds: [] } as never;
}

function renderProvider(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function MutationBoundaryProbe({
  readValue,
  mutateValue,
}: {
  readValue: () => Promise<string>;
  mutateValue: () => Promise<string>;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["actor-boundary-value"],
    queryFn: readValue,
  });
  const mutation = useMutation({
    mutationFn: mutateValue,
    onSuccess: (value) =>
      queryClient.setQueryData(["actor-boundary-value"], value),
  });
  return (
    <div>
      <span data-testid="actor-boundary-value">{query.data ?? "EMPTY"}</span>
      <button type="button" onClick={() => mutation.mutate()}>
        Start actor A mutation
      </button>
    </div>
  );
}

describe("AuthProvider Firebase actor binding", () => {
  let listener: AuthListener;
  let fetchPermissions: ReturnType<typeof vi.fn>;
  let fetchFlags: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.cookie = "ops-auth-token=; path=/; max-age=0";
    document.cookie = "__session=; path=/; max-age=0";
    listener = () => {};
    mocks.authStateReady.mockReturnValue(new Promise<void>(() => {}));
    mocks.checkRedirectResult.mockResolvedValue(null);
    mocks.isRedirectPending.mockReturnValue(false);
    mocks.getFirebaseAuth.mockReturnValue({
      authStateReady: mocks.authStateReady,
      currentUser: null,
    });
    mocks.onAuthStateChanged.mockImplementation((callback: AuthListener) => {
      listener = callback;
      return vi.fn();
    });

    fetchPermissions = vi.fn(async () => {});
    fetchFlags = vi.fn(async () => {});
    usePermissionStore.setState({
      permissions: new Map(),
      configuredPermissions: new Set(),
      initialized: false,
      loading: false,
      fetchPermissions,
    });
    useFeatureFlagsStore.setState({
      flags: new Map(),
      initialized: false,
      fetchFlags,
    });
    useAuthStore.setState({
      currentUser: null,
      company: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      role: UserRole.Unassigned,
    });
    useWindowStore.getState().clearWindows();
    useUndoStore.getState().clear();
    useSelectionStore.getState().clearSelection();
    useBreadcrumbStore.getState().clearEntityName();
    useBreadcrumbStore.getState().clearParentCrumbs();
    usePipelineModeStore.getState().closeDetailPanel();
    useCommunicationDraftStore.getState().clear();
  });

  it("synchronously revokes a persisted OPS actor before awaiting a different Firebase actor", async () => {
    const queryClient = new QueryClient();
    const secretKey = ["activities", "company-feed", "company-a"];
    queryClient.setQueryData(secretKey, [{ body: "actor A private data" }]);
    useAuthStore.setState({
      currentUser: opsUser("ops-a", "company-a"),
      company: company("company-a"),
      isAuthenticated: true,
      role: UserRole.Admin,
    });
    usePermissionStore.setState({
      permissions: new Map([["pipeline.view", "all"]]),
      configuredPermissions: new Set(["pipeline.view"]),
      initialized: true,
    });
    localStorage.setItem(
      ACTOR_BINDING_STORAGE_KEY,
      JSON.stringify({ firebaseUid: "firebase-a", opsUserId: "ops-a" })
    );
    document.cookie = "ops-auth-token=actor-a-token; path=/";
    document.cookie = "__session=actor-a-session; path=/";
    useWindowStore.setState({
      windows: [
        {
          id: "pipeline-detail:lead-a",
          title: "Actor A lead",
          type: "pipeline-detail",
          isMinimized: false,
          position: { x: 0, y: 0 },
          size: { width: 780, height: 680 },
          zIndex: 2000,
          metadata: { opportunityId: "lead-a" },
        },
      ],
      nextZIndex: 2001,
    });
    useUndoStore.setState({
      stack: [
        {
          id: "undo-a",
          label: "Undo actor A edit",
          inverseFn: vi.fn(async () => {}),
          timestamp: Date.now(),
        },
      ],
      isUndoing: false,
    });
    useSelectionStore.getState().selectAll(["lead-a"]);
    useBreadcrumbStore.getState().setEntityName("Actor A client");
    useBreadcrumbStore
      .getState()
      .setParentCrumbs([{ label: "Actor A project", href: "/projects/a" }]);
    usePipelineModeStore.getState().openDetailPanel("lead-a");
    useCommunicationDraftStore.getState().save("actor-a-draft", {
      actorUserId: "ops-a",
      surface: "inbox-reply",
      threadId: "thread-a",
      opportunityId: "lead-a",
      instanceId: null,
      body: "actor A unsent text",
      state: {},
      updatedAt: Date.now(),
    });
    useCommunicationDraftStore.getState().save("actor-a-compose", {
      actorUserId: "ops-a",
      surface: "floating-email",
      threadId: null,
      opportunityId: "lead-a",
      instanceId: "compose-a",
      body: "actor A floating compose",
      state: { sendPending: true },
      updatedAt: Date.now(),
    });
    useCommunicationDraftStore.getState().save("actor-a-follow-up", {
      actorUserId: "ops-a",
      surface: "pipeline-follow-up",
      threadId: null,
      opportunityId: "lead-a",
      instanceId: null,
      body: "actor A quick follow-up",
      state: { sendPending: true },
      updatedAt: Date.now(),
    });
    // Hold token resolution open: revocation must happen before this await.
    mocks.getIdToken.mockReturnValue(new Promise<string | null>(() => {}));

    renderProvider(queryClient);
    await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalled());

    act(() => listener(firebaseUser("firebase-b", "b@example.com")));

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().company).toBeNull();
    expect(usePermissionStore.getState().permissions.size).toBe(0);
    expect(useFeatureFlagsStore.getState().initialized).toBe(false);
    expect(queryClient.getQueryData(secretKey)).toBeUndefined();
    expect(document.cookie).not.toContain("ops-auth-token=");
    expect(document.cookie).not.toContain("__session=");
    expect(useWindowStore.getState().windows).toEqual([]);
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    expect(useBreadcrumbStore.getState().entityName).toBeNull();
    expect(useBreadcrumbStore.getState().parentCrumbs).toBeNull();
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
    expect(useCommunicationDraftStore.getState().drafts).toEqual({});
  });

  it("lets a newer Firebase actor finish while an older actor sync is still in flight", async () => {
    const queryClient = new QueryClient();
    mocks.getIdToken.mockResolvedValue("token");
    let resolveActorA!: (value: unknown) => void;
    const actorASync = new Promise((resolve) => {
      resolveActorA = resolve;
    });
    let resolveActorB!: (value: unknown) => void;
    const actorBSync = new Promise((resolve) => {
      resolveActorB = resolve;
    });
    mocks.syncUser
      .mockReturnValueOnce(actorASync)
      .mockReturnValueOnce(actorBSync);

    renderProvider(queryClient);
    await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalled());

    act(() => listener(firebaseUser("firebase-a", "a@example.com")));
    await waitFor(() => expect(mocks.syncUser).toHaveBeenCalledTimes(1));

    act(() => listener(firebaseUser("firebase-b", "b@example.com")));
    await waitFor(() => expect(mocks.syncUser).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveActorB({
        user: opsUser("ops-b", "company-b"),
        company: company("company-b"),
      });
      await actorBSync;
    });
    expect(useAuthStore.getState().currentUser?.id).toBe("ops-b");
    expect(fetchPermissions).toHaveBeenCalledWith("ops-b");
    expect(fetchPermissions).not.toHaveBeenCalledWith("ops-a");
    expect(
      JSON.parse(localStorage.getItem(ACTOR_BINDING_STORAGE_KEY) ?? "null")
    ).toEqual({ firebaseUid: "firebase-b", opsUserId: "ops-b" });

    await act(async () => {
      resolveActorA({
        user: opsUser("ops-a", "company-a"),
        company: company("company-a"),
      });
      await actorASync;
    });
    expect(useAuthStore.getState().currentUser?.id).toBe("ops-b");
  });

  it("starts a fresh sync when an actor returns during its stale earlier generation", async () => {
    const queryClient = new QueryClient();
    mocks.getIdToken.mockResolvedValue("token");
    const pendingResolvers: Array<(value: unknown) => void> = [];
    for (let index = 0; index < 3; index += 1) {
      mocks.syncUser.mockReturnValueOnce(
        new Promise((resolve) => pendingResolvers.push(resolve))
      );
    }

    renderProvider(queryClient);
    await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalled());

    act(() => listener(firebaseUser("firebase-a", "a@example.com")));
    await waitFor(() => expect(mocks.syncUser).toHaveBeenCalledTimes(1));
    act(() => listener(firebaseUser("firebase-b", "b@example.com")));
    await waitFor(() => expect(mocks.syncUser).toHaveBeenCalledTimes(2));
    act(() => listener(firebaseUser("firebase-a", "a@example.com")));

    await waitFor(() => expect(mocks.syncUser).toHaveBeenCalledTimes(3));

    await act(async () => {
      pendingResolvers[2]({
        user: opsUser("ops-a-current", "company-a"),
        company: company("company-a"),
      });
      await Promise.resolve();
    });
    expect(useAuthStore.getState().currentUser?.id).toBe("ops-a-current");

    await act(async () => {
      pendingResolvers[0]({
        user: opsUser("ops-a-stale", "company-a"),
        company: company("company-a"),
      });
      pendingResolvers[1]({
        user: opsUser("ops-b-stale", "company-b"),
        company: company("company-b"),
      });
      await Promise.resolve();
    });
    expect(useAuthStore.getState().currentUser?.id).toBe("ops-a-current");
  });

  it("fails closed when Firebase token resolution rejects", async () => {
    const queryClient = new QueryClient();
    mocks.getIdToken.mockRejectedValue(new Error("token unavailable"));

    const view = renderProvider(queryClient);
    await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalled());
    act(() => listener(firebaseUser("firebase-a", "a@example.com")));

    await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(false));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(mocks.syncUser).not.toHaveBeenCalled();
    view.unmount();
  });

  it("fails closed when Firebase returns no ID token", async () => {
    const queryClient = new QueryClient();
    mocks.getIdToken.mockResolvedValue(null);

    const view = renderProvider(queryClient);
    await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalled());
    act(() => listener(firebaseUser("firebase-a", "a@example.com")));

    await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(false));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(mocks.syncUser).not.toHaveBeenCalled();
    view.unmount();
  });

  it("fails closed when the canonical OPS user sync rejects", async () => {
    const queryClient = new QueryClient();
    mocks.getIdToken.mockResolvedValue("token");
    mocks.syncUser.mockRejectedValue(new Error("sync unavailable"));

    const view = renderProvider(queryClient);
    await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalled());
    act(() => listener(firebaseUser("firebase-a", "a@example.com")));

    await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(false));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(mocks.syncUser).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("fails closed after ten seconds when Firebase token resolution hangs", async () => {
    vi.useFakeTimers();
    try {
      const queryClient = new QueryClient();
      mocks.getIdToken.mockReturnValue(new Promise<string | null>(() => {}));
      const view = renderProvider(queryClient);
      await act(async () => Promise.resolve());

      act(() => listener(firebaseUser("firebase-a", "a@example.com")));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().currentUser).toBeNull();
      expect(mocks.syncUser).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the original deadline when a duplicate actor signal arrives during a hung sync", async () => {
    vi.useFakeTimers();
    try {
      const queryClient = new QueryClient();
      mocks.getIdToken.mockResolvedValue("token");
      mocks.syncUser.mockReturnValue(new Promise(() => {}));
      const view = renderProvider(queryClient);
      await act(async () => Promise.resolve());

      act(() => listener(firebaseUser("firebase-a", "a@example.com")));
      await act(async () => Promise.resolve());
      expect(mocks.syncUser).toHaveBeenCalledTimes(1);

      act(() => listener(firebaseUser("firebase-a", "a@example.com")));
      await act(async () => Promise.resolve());
      expect(mocks.syncUser).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().currentUser).toBeNull();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when a pending redirect never yields an auth signal", async () => {
    vi.useFakeTimers();
    try {
      const queryClient = new QueryClient();
      mocks.isRedirectPending.mockReturnValue(true);
      mocks.checkRedirectResult.mockReturnValue(new Promise(() => {}));
      const view = renderProvider(queryClient);
      await act(async () => Promise.resolve());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().currentUser).toBeNull();
      expect(mocks.syncUser).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when redirect-result processing rejects", async () => {
    const queryClient = new QueryClient();
    mocks.isRedirectPending.mockReturnValue(true);
    mocks.checkRedirectResult.mockRejectedValue(
      new Error("redirect processing failed")
    );

    const view = renderProvider(queryClient);
    await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalled());
    act(() => listener(null));

    await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(false));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().currentUser).toBeNull();
    view.unmount();
  });

  it("cold-boots an authenticated actor with one quarantine and one canonical sync", async () => {
    const actor = firebaseUser("firebase-a", "a@example.com");
    mocks.authStateReady.mockResolvedValue(undefined);
    mocks.getFirebaseAuth.mockReturnValue({
      authStateReady: mocks.authStateReady,
      currentUser: actor,
    });
    mocks.getIdToken.mockResolvedValue("actor-a-token");
    let resolveSync!: (value: unknown) => void;
    mocks.syncUser.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      })
    );
    const epochBefore = getQueryClientSecurityEpoch();

    const view = render(
      <Providers locale="en">
        <AuthProvider>
          <div>child</div>
        </AuthProvider>
      </Providers>
    );

    await waitFor(() => expect(mocks.syncUser).toHaveBeenCalledTimes(1));
    expect(getQueryClientSecurityEpoch()).toBe(epochBefore + 1);
    await act(async () => {
      resolveSync({
        user: opsUser("ops-a", "company-a"),
        company: company("company-a"),
      });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(useAuthStore.getState().currentUser?.id).toBe("ops-a")
    );
    await act(async () => Promise.resolve());

    expect(mocks.syncUser).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("remounts mounted observers so a late actor mutation cannot reappear", async () => {
    const readValue = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("ACTOR_A_VISIBLE")
      .mockResolvedValueOnce("ACTOR_B_ALLOWED");
    let resolveActorAMutation!: (value: string) => void;
    const mutateValue = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveActorAMutation = resolve;
        })
    );

    const view = render(
      <Providers locale="en">
        <AuthProvider>
          <MutationBoundaryProbe
            readValue={readValue}
            mutateValue={mutateValue}
          />
        </AuthProvider>
      </Providers>
    );
    await waitFor(() =>
      expect(screen.getByTestId("actor-boundary-value")).toHaveTextContent(
        "ACTOR_A_VISIBLE"
      )
    );
    act(() =>
      screen.getByRole("button", { name: "Start actor A mutation" }).click()
    );
    await waitFor(() => expect(mutateValue).toHaveBeenCalledOnce());

    act(() => {
      redactAllQueryCacheData(getQueryClient());
    });
    await waitFor(() =>
      expect(screen.getByTestId("actor-boundary-value")).toHaveTextContent(
        "ACTOR_B_ALLOWED"
      )
    );

    await act(async () => {
      resolveActorAMutation("ACTOR_A_LATE_SECRET");
      await Promise.resolve();
    });
    expect(screen.getByTestId("actor-boundary-value")).toHaveTextContent(
      "ACTOR_B_ALLOWED"
    );
    expect(screen.queryByText("ACTOR_A_LATE_SECRET")).not.toBeInTheDocument();
    view.unmount();
  });
});
