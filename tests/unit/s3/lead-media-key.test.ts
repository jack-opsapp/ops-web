import { describe, expect, it } from "vitest";
import { leadMediaFolder } from "@/lib/s3/lead-media-key";

describe("leadMediaFolder", () => {
  it("uses the publicly readable project-media lead namespace", () => {
    expect(
      leadMediaFolder(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222"
      )
    ).toBe(
      "projects/11111111-1111-4111-8111-111111111111/leads/22222222-2222-4222-8222-222222222222"
    );
  });
});
