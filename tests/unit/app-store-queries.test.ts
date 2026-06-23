import { describe, it, expect } from "vitest";
import { ascCacheKey } from "@/lib/admin/app-store-queries";

describe("ascCacheKey", () => {
  it("includes every arg so dated/granularity variants never collide", () => {
    const a = ascCacheKey("kpis", "2026-06-01", "2026-06-30", "daily");
    const b = ascCacheKey("kpis", "2026-05-01", "2026-05-31", "daily");
    const c = ascCacheKey("kpis", "2026-06-01", "2026-06-30", "weekly");
    expect(a).toEqual(["asc", "kpis", "2026-06-01", "2026-06-30", "daily"]);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });
});
