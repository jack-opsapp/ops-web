export async function hashMicrosoft365ClientState(
  clientState: string
): Promise<string> {
  const normalized = clientState.trim();
  if (!normalized) {
    throw new Error("Microsoft 365 webhook clientState is blank");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function matchesMicrosoft365ClientState(
  clientState: string,
  expectedHash: string | null | undefined
): Promise<boolean> {
  if (!clientState.trim() || !expectedHash) return false;
  return (await hashMicrosoft365ClientState(clientState)) === expectedHash;
}
