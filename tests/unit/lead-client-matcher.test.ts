import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizedPhone,
  normalizedEmail,
  normalizedName,
  phonesMatch,
  matchLeadClient,
  resolveLeadClientId,
} from "@/lib/utils/lead-client-matcher";
import type { Client } from "@/lib/types/models";

function mkClient(overrides: Partial<Client> & { id: string }): Client {
  return {
    name: "",
    email: null,
    phoneNumber: null,
    address: null,
    latitude: null,
    longitude: null,
    profileImageURL: null,
    notes: null,
    companyId: "company-1",
    lastSyncedAt: null,
    needsSync: false,
    createdAt: null,
    deletedAt: null,
    ...overrides,
  };
}

// ─── Normalizers (mirror ops-ios LeadClientMatcher.swift) ─────────────────────

describe("normalizedPhone", () => {
  it("strips everything but digits", () => {
    expect(normalizedPhone("(604) 555-0142")).toBe("6045550142");
    expect(normalizedPhone("+1 604 555 0142")).toBe("16045550142");
  });

  it("returns null under 7 digits (too short to be a match key)", () => {
    expect(normalizedPhone("555-014")).toBeNull();
    expect(normalizedPhone("0142")).toBeNull();
    expect(normalizedPhone("")).toBeNull();
    expect(normalizedPhone(null)).toBeNull();
    expect(normalizedPhone(undefined)).toBeNull();
  });

  it("keeps exactly 7 digits", () => {
    expect(normalizedPhone("555-0142")).toBe("5550142");
  });
});

describe("normalizedEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizedEmail("  Bob@Site.COM ")).toBe("bob@site.com");
  });

  it("rejects strings that are not plausibly an email", () => {
    expect(normalizedEmail("not-an-email")).toBeNull();
    expect(normalizedEmail("a@")).toBeNull();
    expect(normalizedEmail("")).toBeNull();
    expect(normalizedEmail("   ")).toBeNull();
    expect(normalizedEmail(null)).toBeNull();
    expect(normalizedEmail(undefined)).toBeNull();
  });

  it("accepts the minimal plausible email", () => {
    expect(normalizedEmail("a@b")).toBe("a@b");
  });
});

describe("normalizedName", () => {
  it("trims and lowercases", () => {
    expect(normalizedName("  James Boss ")).toBe("james boss");
  });

  it("returns null when empty or whitespace", () => {
    expect(normalizedName("")).toBeNull();
    expect(normalizedName("   ")).toBeNull();
    expect(normalizedName(null)).toBeNull();
    expect(normalizedName(undefined)).toBeNull();
  });
});

describe("phonesMatch", () => {
  it("matches when either digits-string is a suffix of the other", () => {
    expect(phonesMatch("+1 (604) 555-0142", "604-555-0142")).toBe(true);
    expect(phonesMatch("6045550142", "5550142")).toBe(true);
    expect(phonesMatch("5550142", "6045550142")).toBe(true);
  });

  it("never matches when either side has fewer than 7 digits", () => {
    expect(phonesMatch("0142", "6045550142")).toBe(false);
    expect(phonesMatch("6045550142", "0142")).toBe(false);
    expect(phonesMatch(null, "6045550142")).toBe(false);
    expect(phonesMatch("6045550142", undefined)).toBe(false);
  });

  it("does not match different numbers", () => {
    expect(phonesMatch("604-555-0142", "604-555-9999")).toBe(false);
  });
});

// ─── Match priority: phone → email → name ─────────────────────────────────────

describe("matchLeadClient", () => {
  const byPhone = mkClient({ id: "c-phone", name: "Alpha", phoneNumber: "(604) 555-0142" });
  const byEmail = mkClient({ id: "c-email", name: "Bravo", email: "james@site.com" });
  const byName = mkClient({ id: "c-name", name: "James Boss" });

  it("phone beats email and name regardless of list order", () => {
    const hit = matchLeadClient([byName, byEmail, byPhone], {
      name: "James Boss",
      email: "james@site.com",
      phone: "+1 604 555 0142",
    });
    expect(hit?.id).toBe("c-phone");
  });

  it("email beats name when no phone match exists", () => {
    const hit = matchLeadClient([byName, byEmail], {
      name: "James Boss",
      email: "JAMES@SITE.COM",
      phone: "999",
    });
    expect(hit?.id).toBe("c-email");
  });

  it("falls back to case- and whitespace-insensitive name match", () => {
    const hit = matchLeadClient([byName], {
      name: "  james boss ",
      email: null,
      phone: null,
    });
    expect(hit?.id).toBe("c-name");
  });

  it("soft-deleted clients never match, even on exact phone", () => {
    const deleted = mkClient({
      id: "c-deleted",
      name: "James Boss",
      phoneNumber: "604-555-0142",
      deletedAt: new Date("2026-01-01"),
    });
    const hit = matchLeadClient([deleted, byEmail], {
      name: "James Boss",
      email: "james@site.com",
      phone: "604-555-0142",
    });
    expect(hit?.id).toBe("c-email");
  });

  it("a sub-7-digit phone never enters the phone branch", () => {
    const shortPhone = mkClient({ id: "c-short", name: "Short", phoneNumber: "0142" });
    expect(
      matchLeadClient([shortPhone], { name: "x", email: null, phone: "0142" })
    ).toBeNull();
  });

  it("returns null when no signal matches", () => {
    expect(
      matchLeadClient([byPhone, byEmail, byName], {
        name: "Nobody",
        email: "nobody@nowhere.com",
        phone: "778-000-1111",
      })
    ).toBeNull();
  });

  it("returns null when contact has no usable signals", () => {
    expect(matchLeadClient([byName], { name: "  ", email: "", phone: "" })).toBeNull();
  });
});

// ─── Resolve orchestration: match first, create on miss, never throw ──────────

describe("resolveLeadClientId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const existing = mkClient({ id: "c-1", name: "James Boss", phoneNumber: "(604) 555-0142" });

  it("returns the matched client id without creating", async () => {
    const createClient = vi.fn();
    const id = await resolveLeadClientId(
      { name: "James Boss", email: null, phone: "+1 604 555 0142", address: null },
      { fetchClients: async () => [existing], createClient }
    );
    expect(id).toBe("c-1");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("creates a client from the typed contact fields on no match", async () => {
    const createClient = vi
      .fn()
      .mockResolvedValue(mkClient({ id: "c-new", name: "New Caller" }));
    const id = await resolveLeadClientId(
      {
        name: " New Caller ",
        email: "new@caller.com",
        phone: "(778) 222-3333",
        address: "123 Site Rd",
        latitude: 49.2827,
        longitude: -123.1207,
      },
      { fetchClients: async () => [existing], createClient }
    );
    expect(id).toBe("c-new");
    expect(createClient).toHaveBeenCalledWith({
      name: "New Caller",
      email: "new@caller.com",
      phoneNumber: "(778) 222-3333",
      address: "123 Site Rd",
      latitude: 49.2827,
      longitude: -123.1207,
    });
  });

  it("passes null for empty optional fields on create", async () => {
    const createClient = vi.fn().mockResolvedValue(mkClient({ id: "c-new" }));
    await resolveLeadClientId(
      { name: "Solo Name", email: "", phone: "", address: "" },
      { fetchClients: async () => [], createClient }
    );
    expect(createClient).toHaveBeenCalledWith({
      name: "Solo Name",
      email: null,
      phoneNumber: null,
      address: null,
      latitude: null,
      longitude: null,
    });
  });

  it("falls back to cached clients when the fresh fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const createClient = vi.fn();
    const id = await resolveLeadClientId(
      { name: "James Boss", email: null, phone: "604-555-0142", address: null },
      {
        fetchClients: async () => {
          throw new Error("network down");
        },
        createClient,
        cachedClients: [existing],
      }
    );
    expect(id).toBe("c-1");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("still creates when the fetch fails and no cache is available", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const createClient = vi.fn().mockResolvedValue(mkClient({ id: "c-new" }));
    const id = await resolveLeadClientId(
      { name: "New Caller", email: null, phone: null, address: null },
      {
        fetchClients: async () => {
          throw new Error("network down");
        },
        createClient,
      }
    );
    expect(id).toBe("c-new");
  });

  it("returns null when create fails — the lead is never blocked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const createClient = vi.fn().mockRejectedValue(new Error("rls denied"));
    const id = await resolveLeadClientId(
      { name: "New Caller", email: null, phone: null, address: null },
      { fetchClients: async () => [], createClient }
    );
    expect(id).toBeNull();
  });

  it("returns null instead of creating a nameless client", async () => {
    const createClient = vi.fn();
    const id = await resolveLeadClientId(
      { name: "   ", email: "typed@email.com", phone: null, address: null },
      { fetchClients: async () => [], createClient }
    );
    expect(id).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});
