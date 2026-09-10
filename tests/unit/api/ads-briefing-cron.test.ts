// @vitest-environment node
/**
 * The weekly OpenAI ads briefing was retired for the Google Ads engine
 * (2026-09-10). The route stays so a stray call answers 410 GONE without
 * touching OpenAI, the provider-health ledger or the workload lease.
 */
import { describe, expect, it, vi } from "vitest";

const forbidden = vi.hoisted(() => ({ generateBriefing: vi.fn(), runWithCronWorkloadControl: vi.fn() }));
vi.mock("@/lib/admin/briefing-agent", () => ({ generateBriefing: forbidden.generateBriefing }));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({ runWithCronWorkloadControl: forbidden.runWithCronWorkloadControl }));

import { GET } from "@/app/api/cron/ads-briefing/route";

describe("ads-briefing cron (retired)", () => {
  it("answers 410 with the replacement and never reaches OpenAI, even with the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET();
    expect(res.status).toBe(410);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toMatchObject({ code: "GONE", replacement: "/api/cron/ads-engine" });
    expect(forbidden.generateBriefing).not.toHaveBeenCalled();
    expect(forbidden.runWithCronWorkloadControl).not.toHaveBeenCalled();
  });
});
