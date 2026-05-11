/**
 * Tests for user-service auth methods post-Bubble migration.
 * All Bubble calls replaced with Firebase + Supabase.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
}));

// Mock Firebase auth module
vi.mock("@/lib/firebase/auth", () => ({
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

import { requireSupabase } from "@/lib/supabase/helpers";
import { signInWithEmail, signUpWithEmail } from "@/lib/firebase/auth";
import { UserService } from "@/lib/api/services/user-service";

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabase).mockReturnValue(mockSupabase as never);
});

describe("UserService.loginWithGoogle (post-migration)", () => {
  it("looks up user by email in Supabase", async () => {
    const fakeUser = {
      id: "uuid-123",
      email: "test@example.com",
      first_name: "Jane",
      last_name: "Smith",
      role: "Admin",
      company_id: "company-uuid-456",
      is_active: true,
      is_company_admin: true,
    };
    const fakeCompany = {
      id: "company-uuid-456",
      name: "Acme Corp",
      subscription_status: "active",
    };

    // First call: users lookup
    mockSupabase.single
      .mockResolvedValueOnce({ data: fakeUser, error: null })
      // Second call: companies lookup
      .mockResolvedValueOnce({ data: fakeCompany, error: null });

    const result = await UserService.loginWithGoogle(
      "firebase-id-token",
      "test@example.com",
      "Jane Smith",
      "Jane",
      "Smith"
    );

    expect(result.user.email).toBe("test@example.com");
    expect(result.user.firstName).toBe("Jane");
    expect(result.company?.name).toBe("Acme Corp");
  });

  it("returns null company if user has no company_id", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "uuid-123", email: "solo@example.com", company_id: null },
      error: null,
    });

    const result = await UserService.loginWithGoogle(
      "token",
      "solo@example.com",
      "Solo User",
      "Solo",
      "User"
    );

    expect(result.company).toBeNull();
  });

  it("throws if user not found in Supabase", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "No rows found" },
    });

    await expect(
      UserService.loginWithGoogle("token", "missing@example.com", "", "", "")
    ).rejects.toThrow();
  });
});

describe("UserService.loginWithEmailPassword (post-migration)", () => {
  it("signs in via Firebase then fetches user from Supabase", async () => {
    vi.mocked(signInWithEmail).mockResolvedValue({
      uid: "firebase-uid-abc",
      email: "worker@example.com",
    } as never);

    mockSupabase.single.mockResolvedValueOnce({
      data: {
        id: "user-uuid",
        email: "worker@example.com",
        firebase_uid: "firebase-uid-abc",
        first_name: "Bob",
        last_name: "Builder",
        role: "Field Crew",
        company_id: "co-uuid",
      },
      error: null,
    });

    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "co-uuid", name: "Build Co", subscription_status: "active" },
      error: null,
    });

    const result = await UserService.loginWithEmailPassword(
      "worker@example.com",
      "securepass"
    );

    expect(signInWithEmail).toHaveBeenCalledWith("worker@example.com", "securepass");
    expect(result.user.firstName).toBe("Bob");
    expect(result.company?.name).toBe("Build Co");
  });
});

describe("UserService.signup (post-migration)", () => {
  it("creates Firebase user then inserts into Supabase", async () => {
    vi.mocked(signUpWithEmail).mockResolvedValue({
      uid: "new-firebase-uid",
      email: "new@example.com",
    } as never);

    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "new-user-uuid", email: "new@example.com" },
      error: null,
    });

    const result = await UserService.signup("new@example.com", "password123");

    expect(signUpWithEmail).toHaveBeenCalledWith("new@example.com", "password123");
    expect(result.userId).toBe("new-user-uuid");
  });
});

describe("UserService.resetPassword (post-migration)", () => {
  it("calls Firebase sendPasswordResetEmail", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/firebase/auth");
    vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined);

    await UserService.resetPassword("reset@example.com");

    expect(sendPasswordResetEmail).toHaveBeenCalledWith("reset@example.com");
  });
});
