/**
 * OPS Web - Server-side Password Reset Email
 *
 * Sends password reset emails using the Firebase REST API.
 * Uses Firebase's built-in email template — no SendGrid needed.
 *
 * NEVER import this from client-side code.
 */

/**
 * Send a password reset email via Firebase REST API.
 * This works server-side without the client SDK.
 */
export async function sendServerPasswordReset(email: string): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing NEXT_PUBLIC_FIREBASE_API_KEY");
  }

  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
      }),
    }
  );

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(
      `Failed to send reset email: ${body?.error?.message || resp.statusText}`
    );
  }
}
