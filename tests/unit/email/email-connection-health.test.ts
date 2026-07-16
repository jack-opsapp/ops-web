import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { markEmailConnectionNeedsReconnect } from "@/lib/email/email-connection-health";

const CONNECTION_ID = "00000000-0000-4000-8000-000000000001";

describe("markEmailConnectionNeedsReconnect", () => {
  it("calls only the server-derived reconnect operation", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));

    await expect(
      markEmailConnectionNeedsReconnect({
        connectionId: CONNECTION_ID,
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).resolves.toBe(1);

    expect(rpc).toHaveBeenCalledWith(
      "mark_email_connection_needs_reconnect_as_system",
      { p_connection_id: CONNECTION_ID }
    );
  });

  it("rejects malformed connection identity before touching the database", async () => {
    const rpc = vi.fn();

    await expect(
      markEmailConnectionNeedsReconnect({
        connectionId: "legacy-connector",
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).rejects.toThrow("valid email connection id required");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces database failure without issuing another transition", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "database unavailable" },
    }));

    await expect(
      markEmailConnectionNeedsReconnect({
        connectionId: CONNECTION_ID,
        supabase: { rpc } as unknown as SupabaseClient,
      })
    ).rejects.toThrow(
      "email reconnect transition failed: database unavailable"
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
