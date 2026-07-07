import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyAuthTokenMock,
  generateEmailVerificationLinkMock,
  sendEmailVerificationMock,
} = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  generateEmailVerificationLinkMock: vi.fn(),
  sendEmailVerificationMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyAuthTokenMock,
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({
    generateEmailVerificationLink: generateEmailVerificationLinkMock,
  }),
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendEmailVerification: sendEmailVerificationMock,
}));

import { POST } from "@/app/api/auth/send-verification/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/send-verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  const res = await POST(
    makeRequest(body) as unknown as Parameters<typeof POST>[0]
  );
  return { status: res.status, body: await res.json() };
}

describe("POST /api/auth/send-verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("400s when token is missing", async () => {
    const result = await post({});
    expect(result.status).toBe(400);
    expect(sendEmailVerificationMock).not.toHaveBeenCalled();
  });

  it("does not send when the email is already verified", async () => {
    verifyAuthTokenMock.mockResolvedValue({
      uid: "fb-1",
      email: "owner@example.com",
      claims: { email_verified: true },
    });

    const result = await post({ token: "valid" });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: false, alreadyVerified: true });
    expect(generateEmailVerificationLinkMock).not.toHaveBeenCalled();
    expect(sendEmailVerificationMock).not.toHaveBeenCalled();
  });

  it("generates a link, rebuilds it through /auth/action, and sends via the branded template", async () => {
    verifyAuthTokenMock.mockResolvedValue({
      uid: "fb-2",
      email: "newuser@example.com",
      claims: { email_verified: false },
    });
    // Firebase returns a link on ITS OWN action domain; the route must extract
    // the oobCode and rebuild the URL through our handler.
    generateEmailVerificationLinkMock.mockResolvedValue(
      "https://ops-ios-app.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=OOB_ABC123&apiKey=x"
    );
    sendEmailVerificationMock.mockResolvedValue(undefined);

    const result = await post({ token: "valid" });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: true });

    expect(generateEmailVerificationLinkMock).toHaveBeenCalledWith(
      "newuser@example.com",
      { url: "https://app.opsapp.co/auth/action" }
    );
    expect(sendEmailVerificationMock).toHaveBeenCalledTimes(1);
    const arg = sendEmailVerificationMock.mock.calls[0][0];
    expect(arg.email).toBe("newuser@example.com");
    expect(arg.verifyLink).toBe(
      "https://app.opsapp.co/auth/action?mode=verifyEmail&oobCode=OOB_ABC123"
    );
  });

  it("400s when the verified token has no email claim", async () => {
    verifyAuthTokenMock.mockResolvedValue({
      uid: "fb-3",
      email: null,
      claims: { email_verified: false },
    });

    const result = await post({ token: "valid" });

    expect(result.status).toBe(400);
    expect(sendEmailVerificationMock).not.toHaveBeenCalled();
  });
});
