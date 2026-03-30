import { describe, it, expect, vi } from "vitest";

// Mock supabase helpers to prevent Firebase initialization during tests
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

const {
  _scanClients,
  _scanOpportunities,
  _scanProjects,
  _scanTasks,
  _datesOverlap,
  _backfillFields,
} = DuplicateDetectionService;

// ─── Client Scanning ─────────────────────────────────────────────────────────

describe("scanClients", () => {
  it("detects same email as high confidence", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "john@smith.com", phone_number: null, address: null },
      { id: "bbb", name: "Smith Roofing Inc", email: "john@smith.com", phone_number: null, address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
    expect(pairs[0].signals[0].type).toBe("same_email");
  });

  it("detects same phone as high confidence", () => {
    const clients = [
      { id: "aaa", name: "A Corp", email: null, phone_number: "(555) 123-4567", address: null },
      { id: "bbb", name: "B Corp", email: null, phone_number: "555-123-4567", address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
    expect(pairs[0].signals[0].type).toBe("same_phone");
  });

  it("detects fuzzy name match as medium confidence", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "a@gmail.com", phone_number: null, address: null },
      { id: "bbb", name: "Smith Roofing Ltd", email: "b@gmail.com", phone_number: null, address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("medium");
    expect(pairs[0].signals[0].type).toBe("fuzzy_name");
  });

  it("upgrades to high when fuzzy name + same non-public domain", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "john@smithroof.com", phone_number: null, address: null },
      { id: "bbb", name: "Smith Roofing Ltd", email: "jane@smithroof.com", phone_number: null, address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
    expect(pairs[0].signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "fuzzy_name" }),
        expect.objectContaining({ type: "same_domain" }),
      ])
    );
  });

  it("does not flag unrelated clients", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "smith@gmail.com", phone_number: "555-111-1111", address: null },
      { id: "bbb", name: "Jones Plumbing", email: "jones@gmail.com", phone_number: "555-222-2222", address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs).toHaveLength(0);
  });

  it("enforces ordered pair (a < b)", () => {
    const clients = [
      { id: "zzz", name: "Test", email: "same@test.com", phone_number: null, address: null },
      { id: "aaa", name: "Test 2", email: "same@test.com", phone_number: null, address: null },
    ];
    const pairs = _scanClients(clients);
    expect(pairs[0].entityAId).toBe("aaa");
    expect(pairs[0].entityBId).toBe("zzz");
  });

  it("does not create duplicate pairs from multiple indexes", () => {
    const clients = [
      { id: "aaa", name: "Smith Roofing", email: "john@smith.com", phone_number: "555-123-4567", address: null },
      { id: "bbb", name: "Smith Roofing Inc", email: "john@smith.com", phone_number: "555-123-4567", address: null },
    ];
    const pairs = _scanClients(clients);
    // Same email already caught it — phone and name shouldn't create additional pairs
    expect(pairs).toHaveLength(1);
  });
});

// ─── Opportunity Scanning ────────────────────────────────────────────────────

describe("scanOpportunities", () => {
  it("detects same contactEmail as high confidence", () => {
    const opps = [
      { id: "aaa", contact_name: "John", contact_email: "john@test.com", contact_phone: null, title: "Deck", address: null },
      { id: "bbb", contact_name: "Johnny", contact_email: "john@test.com", contact_phone: null, title: "Roof", address: null },
    ];
    const pairs = _scanOpportunities(opps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
  });

  it("detects fuzzy name + same title as medium", () => {
    const opps = [
      { id: "aaa", contact_name: "Smith Construction", contact_email: null, contact_phone: null, title: "Deck Renovation", address: null },
      { id: "bbb", contact_name: "Smith Construction Inc", contact_email: null, contact_phone: null, title: "Deck Renovation", address: null },
    ];
    const pairs = _scanOpportunities(opps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("medium");
  });

  it("requires 2+ signals for name-based matches", () => {
    const opps = [
      { id: "aaa", contact_name: "Smith", contact_email: null, contact_phone: null, title: "Deck", address: null },
      { id: "bbb", contact_name: "Smith Inc", contact_email: null, contact_phone: null, title: "Roof", address: null },
    ];
    const pairs = _scanOpportunities(opps);
    expect(pairs).toHaveLength(0);
  });
});

// ─── Project Scanning ────────────────────────────────────────────────────────

describe("scanProjects", () => {
  it("detects same client + fuzzy title as high", () => {
    const projects = [
      { id: "aaa", title: "Deck Renovation", client_id: "client1", address: null },
      { id: "bbb", title: "Deck Renovation", client_id: "client1", address: null },
    ];
    const pairs = _scanProjects(projects);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
  });

  it("detects same client + same address as high", () => {
    const projects = [
      { id: "aaa", title: "Phase 1", client_id: "client1", address: "123 Main St" },
      { id: "bbb", title: "Phase 2", client_id: "client1", address: "123 Main St." },
    ];
    const pairs = _scanProjects(projects);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
    expect(pairs[0].signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "same_client" }),
        expect.objectContaining({ type: "same_address" }),
      ])
    );
  });

  it("detects same address + same title as medium (no client)", () => {
    const projects = [
      { id: "aaa", title: "Deck Build", client_id: null, address: "456 Oak Ave" },
      { id: "bbb", title: "Deck Build", client_id: null, address: "456 Oak Ave" },
    ];
    const pairs = _scanProjects(projects);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("medium");
  });

  it("does not flag projects with different clients and addresses", () => {
    const projects = [
      { id: "aaa", title: "Deck", client_id: "c1", address: "123 Main St" },
      { id: "bbb", title: "Deck", client_id: "c2", address: "456 Oak Ave" },
    ];
    const pairs = _scanProjects(projects);
    expect(pairs).toHaveLength(0);
  });
});

// ─── Task Scanning ───────────────────────────────────────────────────────────

describe("scanTasks", () => {
  it("detects same taskType + overlapping dates as high", () => {
    const tasks = [
      { id: "aaa", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-01", end_date: "2026-04-03" },
      { id: "bbb", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-02", end_date: "2026-04-04" },
    ];
    const pairs = _scanTasks(tasks);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
  });

  it("does not flag tasks on different projects", () => {
    const tasks = [
      { id: "aaa", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-01", end_date: "2026-04-03" },
      { id: "bbb", project_id: "p2", task_type_id: "tt1", custom_title: null, start_date: "2026-04-01", end_date: "2026-04-03" },
    ];
    const pairs = _scanTasks(tasks);
    expect(pairs).toHaveLength(0);
  });

  it("does not flag non-overlapping dates", () => {
    const tasks = [
      { id: "aaa", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-01", end_date: "2026-04-02" },
      { id: "bbb", project_id: "p1", task_type_id: "tt1", custom_title: null, start_date: "2026-04-03", end_date: "2026-04-04" },
    ];
    const pairs = _scanTasks(tasks);
    expect(pairs).toHaveLength(0);
  });

  it("detects same custom title + overlapping dates", () => {
    const tasks = [
      { id: "aaa", project_id: "p1", task_type_id: "tt1", custom_title: "Install Railing", start_date: "2026-04-01", end_date: "2026-04-03" },
      { id: "bbb", project_id: "p1", task_type_id: "tt2", custom_title: "Install Railing", start_date: "2026-04-02", end_date: "2026-04-04" },
    ];
    const pairs = _scanTasks(tasks);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("high");
  });
});

// ─── Date Overlap ────────────────────────────────────────────────────────────

describe("datesOverlap", () => {
  it("returns true for overlapping ranges", () => {
    expect(_datesOverlap("2026-04-01", "2026-04-05", "2026-04-03", "2026-04-07")).toBe(true);
  });
  it("returns true for contained ranges", () => {
    expect(_datesOverlap("2026-04-01", "2026-04-10", "2026-04-03", "2026-04-05")).toBe(true);
  });
  it("returns true for same-day overlap", () => {
    expect(_datesOverlap("2026-04-01", "2026-04-01", "2026-04-01", "2026-04-01")).toBe(true);
  });
  it("returns false for non-overlapping", () => {
    expect(_datesOverlap("2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04")).toBe(false);
  });
  it("returns false when start is null", () => {
    expect(_datesOverlap(null, "2026-04-02", "2026-04-01", "2026-04-04")).toBe(false);
  });
});

// ─── Backfill Fields ─────────────────────────────────────────────────────────

describe("backfillFields", () => {
  it("copies non-null loser fields into null winner fields", () => {
    const winner = { email: null, phone_number: "555-1234", notes: null };
    const loser = { email: "john@test.com", phone_number: "555-5678", notes: "Good client" };
    const result = _backfillFields(winner, loser, ["email", "phone_number", "notes"]);
    expect(result).toEqual({ email: "john@test.com", notes: "Good client" });
  });

  it("does not overwrite existing winner fields", () => {
    const winner = { email: "existing@test.com" };
    const loser = { email: "other@test.com" };
    const result = _backfillFields(winner, loser, ["email"]);
    expect(result).toEqual({});
  });

  it("treats empty string as null for backfill", () => {
    const winner = { notes: "" };
    const loser = { notes: "Some notes" };
    const result = _backfillFields(winner, loser, ["notes"]);
    expect(result).toEqual({ notes: "Some notes" });
  });
});
