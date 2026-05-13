import { describe, expect, it } from "vitest";
import { deriveStripContact } from "../derive-strip-contact";

const date = (iso: string) => new Date(iso);

describe("deriveStripContact", () => {
  it("returns client phone + address when both present", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: "(250) 555-0184", address: "123 Main St" },
        opportunities: [],
        projects: [],
      }),
    ).toEqual({ phone: "(250) 555-0184", address: "123 Main St" });
  });

  it("falls back to opportunity contact_phone when client phone is null", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [
          {
            contactPhone: "(250) 538-8994",
            address: null,
            createdAt: date("2026-04-01T00:00:00Z"),
          },
        ],
        projects: [],
      }),
    ).toEqual({ phone: "(250) 538-8994", address: null });
  });

  it("prefers the most-recent opportunity phone when multiple exist", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [
          {
            contactPhone: "(250) 111-1111",
            address: null,
            createdAt: date("2025-01-01T00:00:00Z"),
          },
          {
            contactPhone: "(250) 999-9999",
            address: null,
            createdAt: date("2026-04-01T00:00:00Z"),
          },
        ],
        projects: [],
      }).phone,
    ).toBe("(250) 999-9999");
  });

  it("skips opportunity entries with empty/null phone and uses the next one", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [
          {
            contactPhone: null,
            address: null,
            createdAt: date("2026-04-19T00:00:00Z"),
          },
          {
            contactPhone: "  ",
            address: null,
            createdAt: date("2026-04-15T00:00:00Z"),
          },
          {
            contactPhone: "(250) 538-8994",
            address: null,
            createdAt: date("2026-03-26T00:00:00Z"),
          },
        ],
        projects: [],
      }).phone,
    ).toBe("(250) 538-8994");
  });

  it("falls back to opportunity address when client address is null", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [
          {
            contactPhone: null,
            address: "1353 Grant St, Victoria, BC",
            createdAt: date("2026-04-01T00:00:00Z"),
          },
        ],
        projects: [],
      }).address,
    ).toBe("1353 Grant St, Victoria, BC");
  });

  it("falls back to project address when client and opportunities lack address", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [
          {
            contactPhone: "(250) 538-8994",
            address: null,
            createdAt: date("2026-04-01T00:00:00Z"),
          },
        ],
        projects: [
          { address: "4954 Highgate Rd, Victoria, BC", createdAt: date("2026-03-15T00:00:00Z") },
        ],
      }).address,
    ).toBe("4954 Highgate Rd, Victoria, BC");
  });

  it("prefers opportunity address over project address when both present", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [
          {
            contactPhone: null,
            address: "Opp address",
            createdAt: date("2026-04-01T00:00:00Z"),
          },
        ],
        projects: [{ address: "Project address", createdAt: date("2026-04-15T00:00:00Z") }],
      }).address,
    ).toBe("Opp address");
  });

  it("prefers most-recent project address when multiple projects have one", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [],
        projects: [
          { address: "Older project", createdAt: date("2025-01-01T00:00:00Z") },
          { address: "Newest project", createdAt: date("2026-05-01T00:00:00Z") },
        ],
      }).address,
    ).toBe("Newest project");
  });

  it("trims whitespace and treats whitespace-only values as missing", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: "   ", address: "  " },
        opportunities: [
          {
            contactPhone: " 250-555-0123 ",
            address: " 4954 Highgate Rd ",
            createdAt: date("2026-04-01T00:00:00Z"),
          },
        ],
        projects: [],
      }),
    ).toEqual({ phone: "250-555-0123", address: "4954 Highgate Rd" });
  });

  it("returns nulls when no source has data", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [],
        projects: [],
      }),
    ).toEqual({ phone: null, address: null });
  });

  it("handles a null/undefined client (unlinked thread fed into derivation)", () => {
    expect(
      deriveStripContact({
        client: null,
        opportunities: [
          {
            contactPhone: "(250) 538-8994",
            address: "123 Main St",
            createdAt: date("2026-04-01T00:00:00Z"),
          },
        ],
        projects: [],
      }),
    ).toEqual({ phone: "(250) 538-8994", address: "123 Main St" });
  });

  it("treats null createdAt as oldest so dated entries win", () => {
    expect(
      deriveStripContact({
        client: { phoneNumber: null, address: null },
        opportunities: [
          { contactPhone: "(250) 111-1111", address: null, createdAt: null as unknown as Date },
          {
            contactPhone: "(250) 222-2222",
            address: null,
            createdAt: date("2026-04-01T00:00:00Z"),
          },
        ],
        projects: [],
      }).phone,
    ).toBe("(250) 222-2222");
  });
});
