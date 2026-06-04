import { describe, it, expect } from "vitest";
import {
  deriveStreetLine,
  deriveProjectNamePreview,
} from "@/lib/utils/derive-project-name";

// Mirrors the SQL `private.derive_project_name()` street-line behavior so the
// Won-dialog / create-form preview matches what the DB trigger will store.

describe("deriveStreetLine", () => {
  it("takes the substring before the first comma", () => {
    expect(deriveStreetLine("1240 W 6th Ave, Vancouver, BC")).toBe(
      "1240 W 6th Ave",
    );
  });

  it("falls back to the whole string when there is no comma", () => {
    expect(deriveStreetLine("1240 W 6th Ave")).toBe("1240 W 6th Ave");
  });

  it("trims surrounding whitespace", () => {
    expect(deriveStreetLine("  88 Elm St , Burnaby ")).toBe("88 Elm St");
  });

  it("returns null for empty / nullish input", () => {
    expect(deriveStreetLine("")).toBeNull();
    expect(deriveStreetLine("   ")).toBeNull();
    expect(deriveStreetLine(null)).toBeNull();
    expect(deriveStreetLine(undefined)).toBeNull();
  });
});

describe("deriveProjectNamePreview", () => {
  it("prefers the street line from the address", () => {
    expect(
      deriveProjectNamePreview({
        address: "1240 W 6th Ave, Vancouver",
        suggestedName: "Acme's Project",
        newProjectName: "New project",
      }),
    ).toBe("1240 W 6th Ave");
  });

  it("uses the server suggested name when there is no address", () => {
    expect(
      deriveProjectNamePreview({
        address: "",
        suggestedName: "Acme's Project",
        newProjectName: "New project",
      }),
    ).toBe("Acme's Project");
  });

  it("falls back to the localized placeholder when nothing is known", () => {
    expect(
      deriveProjectNamePreview({
        address: null,
        suggestedName: null,
        newProjectName: "New project",
      }),
    ).toBe("New project");
  });
});
