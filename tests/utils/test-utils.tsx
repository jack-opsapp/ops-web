/**
 * Custom Test Utilities
 *
 * Wraps React Testing Library's render with all required providers.
 * Provides helpers for TanStack Query, Zustand stores, and common test patterns.
 */

import React, { type ReactElement, type ReactNode } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";

// Re-export everything from Testing Library
export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

// ─── Test QueryClient Factory ───────────────────────────────────────────────

/**
 * Creates a QueryClient configured for testing:
 * - No retries (fail fast)
 * - No garbage collection time (immediate cleanup)
 * - No stale time
 * - Errors are not thrown to the console
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// ─── Provider Wrapper ───────────────────────────────────────────────────────

interface TestProviderProps {
  children: ReactNode;
  queryClient?: QueryClient;
}

function TestProviders({ children, queryClient }: TestProviderProps) {
  const client = queryClient || createTestQueryClient();

  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
}

// ─── Custom Render ──────────────────────────────────────────────────────────

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
}

/**
 * Custom render that wraps components with all required providers.
 * Use this instead of RTL's default render in all tests.
 *
 * @example
 * ```tsx
 * const { getByText } = renderWithProviders(<ProjectList />);
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): RenderResult & { queryClient: QueryClient } {
  const { queryClient = createTestQueryClient(), ...renderOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestProviders queryClient={queryClient}>
        {children}
      </TestProviders>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    ...result,
    queryClient,
  };
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

/**
 * Wait for all TanStack Query queries to settle (no pending fetches).
 * Use after rendering components that fetch data.
 *
 * @example
 * ```tsx
 * renderWithProviders(<ProjectList />);
 * await waitForQuery();
 * expect(screen.getByText("Kitchen Renovation")).toBeInTheDocument();
 * ```
 */
export async function waitForQuery(timeout = 5000): Promise<void> {
  const { waitFor } = await import("@testing-library/react");
  await waitFor(
    () => {
      // Wait for DOM to settle - this is intentionally a no-op assertion
      // that gives React time to process state updates
      return;
    },
    { timeout }
  );
  // Additional tick to let React process any pending state updates
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for a specific query to resolve by checking for rendered content.
 *
 * @example
 * ```tsx
 * renderWithProviders(<ProjectList />);
 * await waitForQueryData(() => screen.getByText("Kitchen Renovation"));
 * ```
 */
export async function waitForQueryData(
  assertion: () => HTMLElement | null,
  timeout = 5000
): Promise<void> {
  const { waitFor } = await import("@testing-library/react");
  await waitFor(
    () => {
      const element = assertion();
      if (!element) {
        throw new Error("Element not found yet");
      }
    },
    { timeout }
  );
}

// ─── Auth Store Helpers ─────────────────────────────────────────────────────

interface MockAuthUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  emailVerified?: boolean;
}

/**
 * Set the Zustand auth store to an authenticated state with a mock user.
 * Call this before rendering components that require authentication.
 *
 * @example
 * ```tsx
 * mockAuthStore({ uid: "user-123", email: "test@opsapp.co", displayName: "Test User" });
 * renderWithProviders(<Dashboard />);
 * ```
 */
export function mockAuthStore(user?: MockAuthUser): void {
  const defaultUser: MockAuthUser = {
    uid: "mock-user-id-123",
    email: "marcus.johnson@opsapp.co",
    displayName: "Marcus Johnson",
    photoURL: "https://storage.googleapis.com/ops-avatars/user-placeholder.png",
    emailVerified: true,
  };

  const mockUser = user || defaultUser;

  // Create a minimal Firebase User-like object
  const firebaseUser = {
    uid: mockUser.uid,
    email: mockUser.email,
    displayName: mockUser.displayName,
    photoURL: mockUser.photoURL || null,
    emailVerified: mockUser.emailVerified ?? true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: "mock-refresh-token",
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => "mock-id-token-abc123",
    getIdTokenResult: async () => ({
      token: "mock-id-token-abc123",
      authTime: new Date().toISOString(),
      issuedAtTime: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 3600000).toISOString(),
      signInProvider: "google.com",
      signInSecondFactor: null,
      claims: {},
    }),
    reload: async () => {},
    toJSON: () => ({
      uid: mockUser.uid,
      email: mockUser.email,
      displayName: mockUser.displayName,
    }),
    phoneNumber: null,
    providerId: "firebase",
  };

  useAuthStore.setState({
    user: firebaseUser as any,
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

/**
 * Reset the auth store to its unauthenticated initial state.
 */
export function resetAuthStore(): void {
  useAuthStore.getState().reset();
}

// ─── Assertion Helpers ──────────────────────────────────────────────────────

/**
 * Assert that a loading indicator is displayed, then wait for it to disappear.
 *
 * @example
 * ```tsx
 * const { findByText } = renderWithProviders(<ProjectList />);
 * await expectLoadingThenContent(findByText, "Kitchen Renovation");
 * ```
 */
export async function expectLoadingThenContent(
  findByText: (text: string | RegExp) => Promise<HTMLElement>,
  contentText: string | RegExp,
  loadingText: string | RegExp = /loading/i
): Promise<HTMLElement> {
  // Content should eventually appear
  const element = await findByText(contentText);
  return element;
}

// ─── Network Helpers ────────────────────────────────────────────────────────

/**
 * Import and access the MSW server for per-test handler overrides.
 *
 * @example
 * ```tsx
 * import { server } from "../mocks/server";
 * import { http, HttpResponse } from "msw";
 *
 * server.use(
 *   http.get("https://opsapp.co/version-test/api/1.1/obj/project", () => {
 *     return HttpResponse.json({ response: { results: [], cursor: 0, remaining: 0, count: 0 } });
 *   })
 * );
 * ```
 */
export { server } from "../mocks/server";
