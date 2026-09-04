import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
}));

vi.mock("firebase/auth", () => {
  class GoogleAuthProvider {
    setCustomParameters() {}
  }

  class OAuthProvider {
    addScope() {}
  }

  return {
    GoogleAuthProvider,
    OAuthProvider,
    EmailAuthProvider: { credential: vi.fn() },
    signInWithPopup: mocks.signInWithPopup,
    signInWithRedirect: mocks.signInWithRedirect,
    getRedirectResult: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    reauthenticateWithCredential: vi.fn(),
    updatePassword: vi.fn(),
    signOut: vi.fn(),
    onIdTokenChanged: vi.fn(),
  };
});

vi.mock("@/lib/firebase/config", () => ({ auth: {} }));

import { signInWithApple, signInWithGoogle } from "@/lib/firebase/auth";

describe("Firebase OAuth transport selection", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.signInWithPopup.mockReset().mockResolvedValue({});
    mocks.signInWithRedirect.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    ["Google", signInWithGoogle],
    ["Apple", signInWithApple],
  ])("keeps an MCP %s sign-in on the OPS page with a popup", async (_, signIn) => {
    await signIn({
      origin: "login",
      provider: _ === "Google" ? "google" : "apple",
      redirectTo:
        "/oauth/authorize?response_type=code&client_id=codex&state=opaque",
    });

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it("keeps ordinary production Google sign-in on the redirect transport", async () => {
    await signInWithGoogle({
      origin: "login",
      provider: "google",
      redirectTo: "/dashboard",
    });

    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
  });
});
