import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({ select: vi.fn() })),
  })),
}));

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

describe("getAdminSupabase", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates a Supabase client with service role key", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { getAdminSupabase } = await import("../admin-client");

    getAdminSupabase();

    expect(createClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-service-role-key",
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false }),
      })
    );
  });

  it("returns the same instance on subsequent calls (singleton)", async () => {
    const { getAdminSupabase } = await import("../admin-client");
    const a = getAdminSupabase();
    const b = getAdminSupabase();
    expect(a).toBe(b);
  });
});
