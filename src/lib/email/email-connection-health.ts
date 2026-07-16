import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ReconnectRpcClient {
  rpc(
    name: "mark_email_connection_needs_reconnect_as_system",
    args: { p_connection_id: string }
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export async function markEmailConnectionNeedsReconnect(input: {
  connectionId: string;
  supabase: SupabaseClient;
}): Promise<number> {
  if (!UUID_PATTERN.test(input.connectionId)) {
    throw new Error("valid email connection id required");
  }

  const { data, error } = await (
    input.supabase as unknown as ReconnectRpcClient
  ).rpc("mark_email_connection_needs_reconnect_as_system", {
    p_connection_id: input.connectionId,
  });
  if (error) {
    throw new Error(
      `email reconnect transition failed: ${error.message ?? "unknown error"}`
    );
  }

  const count = Number(data ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
