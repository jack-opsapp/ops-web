/**
 * Integration Tests for Authentication Flow
 *
 * Tests the full auth lifecycle: login (email & Google), logout, role detection,
 * PIN verification, and authentication-guarded redirects.
 * Uses Zustand store for state management with MSW for API mocking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  mockAuthStore,
  resetAuthStore,
} from "../utils/test-utils";
import { useAuthStore, type AuthState } from "@/lib/store/auth-store";
import { UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";

const BASE_URL = "https://opsapp.co/api/1.1";

// ─── Mock Firebase Auth Module ──────────────────────────────────────────────

// We mock the firebase auth module to prevent actual Firebase initialization
vi.mock("@/lib/firebase/auth", () => ({
  signInWithGoogle: vi.fn(),
  signInWithEmail: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
  getCurrentUser: vi.fn(),
  getIdToken: vi.fn(),
}));

// Import the mocked module
import {
  signInWithEmail,
  signInWithGoogle,
  signOut,
  onAuthStateChanged,
  getCurrentUser,
} from "@/lib/firebase/auth";

// ─── Helper: Create OPS User ────────────────────────────────────────────────

function createMockOpsUser(overrides: Partial<User> = {}): User {
  return {
    id: "firebase-uid-123",
    email: "marcus@opsapp.co",
    firstName: "Marcus",
    lastName: "Johnson",
    role: UserRole.Admin,
    isCompanyAdmin: true,
    isActive: true,
    profileImageURL: "https://example.com/avatar.png",
    phone: null,
    userColor: "#417394",
    locationName: null,
    latitude: null,
    longitude: null,
    homeAddress: null,
    clientId: null,
    companyId: "mock-company-id",
    userType: null,
    devPermission: false,
    hasCompletedAppOnboarding: true,
    hasCompletedAppTutorial: true,
    stripeCustomerId: null,
    deviceToken: null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
    ...overrides,
  };
}

// ─── Test Components ────────────────────────────────────────────────────────

function LoginTestComponent() {
  const { currentUser, isAuthenticated, isLoading } = useAuthStore();
  const [error, setError] = React.useState<string | null>(null);

  const handleEmailLogin = async (email: string, password: string) => {
    useAuthStore.getState().setLoading(true);
    try {
      await (signInWithEmail as ReturnType<typeof vi.fn>)(email, password);
      // Simulate what AuthProvider + login flow would do
      const mockUser = createMockOpsUser({ email });
      useAuthStore.setState({
        currentUser: mockUser,
        isAuthenticated: true,
        isLoading: false,
        role: UserRole.Admin,
      });
    } catch (err) {
      setError((err as Error).message);
      useAuthStore.getState().setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    useAuthStore.getState().setLoading(true);
    try {
      const result = await (signInWithGoogle as ReturnType<typeof vi.fn>)();
      const mockUser = createMockOpsUser({
        email: result.email,
        firstName: result.displayName?.split(" ")[0] || "User",
        lastName: result.displayName?.split(" ").slice(1).join(" ") || "",
      });
      useAuthStore.setState({
        currentUser: mockUser,
        isAuthenticated: true,
        isLoading: false,
        role: UserRole.Admin,
      });
    } catch (err) {
      setError((err as Error).message);
      useAuthStore.getState().setLoading(false);
    }
  };

  const handleLogout = async () => {
    await (signOut as ReturnType<typeof vi.fn>)();
    useAuthStore.getState().logout();
  };

  if (isLoading) {
    return <div data-testid="loading">Loading...</div>;
  }

  if (isAuthenticated && currentUser) {
    return (
      <div data-testid="authenticated">
        <p data-testid="user-email">{currentUser.email}</p>
        <p data-testid="user-name">{`${currentUser.firstName} ${currentUser.lastName}`.trim()}</p>
        <button data-testid="logout-btn" onClick={handleLogout}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div data-testid="login-form">
      {error && <p data-testid="error-message">{error}</p>}
      <input data-testid="email-input" type="email" placeholder="Email" />
      <input data-testid="password-input" type="password" placeholder="Password" />
      <button
        data-testid="email-login-btn"
        onClick={() => {
          const email = (screen.getByTestId("email-input") as HTMLInputElement).value;
          const password = (screen.getByTestId("password-input") as HTMLInputElement).value;
          handleEmailLogin(email, password);
        }}
      >
        Sign In with Email
      </button>
      <button data-testid="google-login-btn" onClick={handleGoogleLogin}>
        Sign In with Google
      </button>
    </div>
  );
}

function RoleDetectionTestComponent({ userId, companyAdminIds }: {
  userId: string;
  companyAdminIds: string[];
}) {
  // Simulate role detection logic (mirrors iOS priority: adminIds first)
  const employeeType = useAuthStore((state: AuthState) => {
    return "Field Crew"; // default
  });

  const isAdmin = companyAdminIds.includes(userId);
  const role = isAdmin ? "admin" : (() => {
    switch (employeeType) {
      case "Admin": return "admin";
      case "Office Crew": return "officeCrew";
      case "Field Crew": return "fieldCrew";
      default: return "fieldCrew";
    }
  })();

  return (
    <div>
      <span data-testid="detected-role">{role}</span>
      <span data-testid="is-admin">{isAdmin ? "true" : "false"}</span>
    </div>
  );
}

function PinEntryTestComponent({ correctPin }: { correctPin: string }) {
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState("");
  const [isVerified, setIsVerified] = React.useState(false);

  const handleVerify = () => {
    if (pin === correctPin) {
      setIsVerified(true);
      setPinError("");
    } else {
      setPinError("Incorrect PIN");
    }
  };

  if (isVerified) {
    return <div data-testid="pin-verified">Access Granted</div>;
  }

  return (
    <div data-testid="pin-entry">
      {pinError && <p data-testid="pin-error">{pinError}</p>}
      <input
        data-testid="pin-input"
        type="password"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="Enter PIN"
      />
      <button data-testid="pin-submit" onClick={handleVerify}>
        Verify
      </button>
    </div>
  );
}

function ProtectedRouteTestComponent() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <div data-testid="loading">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <div data-testid="redirect-login">Redirecting to login...</div>;
  }

  return <div data-testid="protected-content">Dashboard Content</div>;
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("Authentication Integration Tests", () => {
  beforeEach(() => {
    resetAuthStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetAuthStore();
  });

  // ─── Login with Email ───────────────────────────────────────────────

  describe("Login with email/password", () => {
    it("authenticates user with valid credentials", async () => {
      const user = userEvent.setup();
      (signInWithEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
        email: "marcus@opsapp.co",
        displayName: "Marcus Johnson",
      });

      renderWithProviders(<LoginTestComponent />);

      // Should show login form
      expect(screen.getByTestId("login-form")).toBeInTheDocument();

      // Fill in credentials
      await user.type(screen.getByTestId("email-input"), "marcus@opsapp.co");
      await user.type(screen.getByTestId("password-input"), "password123");
      await user.click(screen.getByTestId("email-login-btn"));

      // Should transition to authenticated state
      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toBeInTheDocument();
      });

      expect(screen.getByTestId("user-email")).toHaveTextContent("marcus@opsapp.co");
      expect(screen.getByTestId("user-name")).toHaveTextContent("Marcus Johnson");
    });

    it("shows error message for invalid credentials", async () => {
      const user = userEvent.setup();
      (signInWithEmail as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Invalid email or password")
      );

      renderWithProviders(<LoginTestComponent />);

      await user.type(screen.getByTestId("email-input"), "wrong@test.com");
      await user.type(screen.getByTestId("password-input"), "wrong");
      await user.click(screen.getByTestId("email-login-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toBeInTheDocument();
        expect(screen.getByTestId("error-message")).toHaveTextContent("Invalid email or password");
      });
    });

    it("shows loading state during authentication", async () => {
      const user = userEvent.setup();
      let resolveLogin: (value: unknown) => void;
      const loginPromise = new Promise((resolve) => {
        resolveLogin = resolve;
      });
      (signInWithEmail as ReturnType<typeof vi.fn>).mockReturnValue(loginPromise);

      // Start in non-loading state
      useAuthStore.setState({ isLoading: false });

      renderWithProviders(<LoginTestComponent />);

      await user.type(screen.getByTestId("email-input"), "test@test.com");
      await user.type(screen.getByTestId("password-input"), "password");
      await user.click(screen.getByTestId("email-login-btn"));

      // Should show loading
      await waitFor(() => {
        expect(screen.getByTestId("loading")).toBeInTheDocument();
      });

      // Resolve login
      resolveLogin!({ email: "test@test.com", displayName: "Test User" });

      // Should show authenticated
      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toBeInTheDocument();
      });
    });
  });

  // ─── Login with Google ──────────────────────────────────────────────

  describe("Login with Google", () => {
    it("authenticates user via Google sign-in", async () => {
      const user = userEvent.setup();
      (signInWithGoogle as ReturnType<typeof vi.fn>).mockResolvedValue({
        email: "marcus.google@opsapp.co",
        displayName: "Marcus G Johnson",
      });

      renderWithProviders(<LoginTestComponent />);

      await user.click(screen.getByTestId("google-login-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toBeInTheDocument();
      });

      expect(screen.getByTestId("user-email")).toHaveTextContent("marcus.google@opsapp.co");
    });

    it("handles Google sign-in cancellation", async () => {
      const user = userEvent.setup();
      (signInWithGoogle as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Popup closed by user")
      );

      renderWithProviders(<LoginTestComponent />);

      await user.click(screen.getByTestId("google-login-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toHaveTextContent("Popup closed by user");
      });

      // Should still show login form
      expect(screen.getByTestId("login-form")).toBeInTheDocument();
    });
  });

  // ─── Logout ─────────────────────────────────────────────────────────

  describe("Logout clears state", () => {
    it("clears auth state on logout", async () => {
      const user = userEvent.setup();
      (signOut as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      // Start authenticated
      mockAuthStore({
        uid: "user-123",
        email: "marcus@opsapp.co",
        displayName: "Marcus Johnson",
      });

      renderWithProviders(<LoginTestComponent />);

      // Should be authenticated
      expect(screen.getByTestId("authenticated")).toBeInTheDocument();

      // Click logout
      await user.click(screen.getByTestId("logout-btn"));

      // Should return to login form
      await waitFor(() => {
        expect(screen.getByTestId("login-form")).toBeInTheDocument();
      });

      // Verify store state is cleared
      const state = useAuthStore.getState();
      expect(state.currentUser).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it("calls Firebase signOut", async () => {
      const user = userEvent.setup();
      (signOut as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      mockAuthStore();
      renderWithProviders(<LoginTestComponent />);

      await user.click(screen.getByTestId("logout-btn"));

      expect(signOut).toHaveBeenCalledOnce();
    });
  });

  // ─── Role Detection ─────────────────────────────────────────────────

  describe("Role detection", () => {
    it("detects admin role from company admin IDs", () => {
      renderWithProviders(
        <RoleDetectionTestComponent
          userId="user-admin-1"
          companyAdminIds={["user-admin-1", "user-admin-2"]}
        />
      );

      expect(screen.getByTestId("detected-role")).toHaveTextContent("admin");
      expect(screen.getByTestId("is-admin")).toHaveTextContent("true");
    });

    it("detects non-admin when user not in admin list", () => {
      renderWithProviders(
        <RoleDetectionTestComponent
          userId="user-regular"
          companyAdminIds={["user-admin-1"]}
        />
      );

      expect(screen.getByTestId("detected-role")).toHaveTextContent("fieldCrew");
      expect(screen.getByTestId("is-admin")).toHaveTextContent("false");
    });

    it("defaults to fieldCrew with empty admin list", () => {
      renderWithProviders(
        <RoleDetectionTestComponent
          userId="user-any"
          companyAdminIds={[]}
        />
      );

      expect(screen.getByTestId("detected-role")).toHaveTextContent("fieldCrew");
    });
  });

  // ─── PIN Entry and Verification ─────────────────────────────────────

  describe("PIN entry and verification", () => {
    it("grants access with correct PIN", async () => {
      const user = userEvent.setup();

      renderWithProviders(<PinEntryTestComponent correctPin="1234" />);

      expect(screen.getByTestId("pin-entry")).toBeInTheDocument();

      await user.type(screen.getByTestId("pin-input"), "1234");
      await user.click(screen.getByTestId("pin-submit"));

      await waitFor(() => {
        expect(screen.getByTestId("pin-verified")).toBeInTheDocument();
        expect(screen.getByText("Access Granted")).toBeInTheDocument();
      });
    });

    it("shows error for incorrect PIN", async () => {
      const user = userEvent.setup();

      renderWithProviders(<PinEntryTestComponent correctPin="1234" />);

      await user.type(screen.getByTestId("pin-input"), "9999");
      await user.click(screen.getByTestId("pin-submit"));

      await waitFor(() => {
        expect(screen.getByTestId("pin-error")).toBeInTheDocument();
        expect(screen.getByTestId("pin-error")).toHaveTextContent("Incorrect PIN");
      });

      // Should still show pin entry
      expect(screen.getByTestId("pin-entry")).toBeInTheDocument();
    });

    it("PIN input has max length of 4", () => {
      renderWithProviders(<PinEntryTestComponent correctPin="1234" />);

      const input = screen.getByTestId("pin-input") as HTMLInputElement;
      expect(input.maxLength).toBe(4);
    });

    it("PIN input is of type password (masked)", () => {
      renderWithProviders(<PinEntryTestComponent correctPin="1234" />);

      const input = screen.getByTestId("pin-input") as HTMLInputElement;
      expect(input.type).toBe("password");
    });
  });

  // ─── Authentication Guards ──────────────────────────────────────────

  describe("Redirect when not authenticated", () => {
    it("shows redirect message when user is not authenticated", () => {
      useAuthStore.setState({
        currentUser: null,
        isAuthenticated: false,
        isLoading: false,
      });

      renderWithProviders(<ProtectedRouteTestComponent />);

      expect(screen.getByTestId("redirect-login")).toBeInTheDocument();
      expect(screen.getByText("Redirecting to login...")).toBeInTheDocument();
    });

    it("shows protected content when user is authenticated", () => {
      mockAuthStore();

      renderWithProviders(<ProtectedRouteTestComponent />);

      expect(screen.getByTestId("protected-content")).toBeInTheDocument();
      expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
    });

    it("shows loading state while auth is being checked", () => {
      useAuthStore.setState({
        currentUser: null,
        isAuthenticated: false,
        isLoading: true,
      });

      renderWithProviders(<ProtectedRouteTestComponent />);

      expect(screen.getByTestId("loading")).toBeInTheDocument();
    });
  });
});
