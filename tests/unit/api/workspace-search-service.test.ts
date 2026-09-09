import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyWorkspaceSearchResult,
  parseWorkspaceSearchResult,
} from "@/lib/types/workspace-search";

// vi.mock is hoisted above the imports; vi.hoisted keeps the spy alive at that
// point instead of hitting the module-scope temporal dead zone.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ rpc }),
}));

import { WorkspaceSearchService } from "@/lib/api/services/workspace-search-service";

const ENVELOPE = {
  query: "hidden",
  tokens: ["hidden"],
  projects: { total: 0, items: [] },
  clients: { total: 0, items: [] },
  leads: { total: 0, items: [] },
  tasks: { total: 0, items: [] },
  documents: { total: 0, items: [] },
};

describe("parseWorkspaceSearchResult", () => {
  it("returns the empty envelope for anything that is not an envelope", () => {
    expect(parseWorkspaceSearchResult(null)).toEqual(emptyWorkspaceSearchResult());
    expect(parseWorkspaceSearchResult(undefined)).toEqual(emptyWorkspaceSearchResult());
    expect(parseWorkspaceSearchResult("nope")).toEqual(emptyWorkspaceSearchResult());
    expect(parseWorkspaceSearchResult(42)).toEqual(emptyWorkspaceSearchResult());
    expect(parseWorkspaceSearchResult([])).toEqual(emptyWorkspaceSearchResult());
  });

  it("keeps well-formed items and drops malformed ones without throwing", () => {
    const parsed = parseWorkspaceSearchResult({
      query: "hidden",
      tokens: ["hidden"],
      projects: {
        total: 2,
        items: [
          {
            id: "p1",
            title: "Hidden Oaks",
            address: null,
            status: "in_progress",
            client_name: "A",
            updated_at: "2026-09-01T00:00:00Z",
          },
          { title: "no id" },
        ],
      },
      clients: { total: 0, items: [] },
      leads: { total: 0, items: [] },
      tasks: { total: 0, items: [] },
      documents: {
        total: 1,
        items: [
          {
            id: "i1",
            kind: "invoice",
            number: "INV-1042",
            title: null,
            client_name: "A",
            total: "4812.50",
            status: "sent",
            updated_at: null,
          },
        ],
      },
    });
    expect(parsed.projects.items).toHaveLength(1);
    expect(parsed.projects.total).toBe(2);
    expect(parsed.documents.items[0]).toMatchObject({
      kind: "invoice",
      number: "INV-1042",
      total: 4812.5,
    });
  });

  it("preserves nulls, keeps every kind, and never returns a shared mutable envelope", () => {
    const parsed = parseWorkspaceSearchResult({
      query: "smith",
      tokens: ["smith", "smith", 7],
      clients: {
        total: 1,
        items: [
          {
            id: "c1",
            name: "Smith",
            email: null,
            phone: "250-555-1234",
            address: null,
            updated_at: null,
          },
        ],
      },
      leads: {
        total: 1,
        items: [
          {
            id: "l1",
            title: "Smith deck",
            contact_name: "Smith",
            stage: "quoted",
            address: null,
            updated_at: "2026-09-02T00:00:00Z",
          },
        ],
      },
      tasks: {
        total: 1,
        items: [
          {
            id: "t1",
            title: "Frame",
            project_id: "p9",
            project_title: "Smith deck",
            task_type: "Framing",
            status: "active",
            updated_at: null,
          },
        ],
      },
    });
    expect(parsed.query).toBe("smith");
    expect(parsed.tokens).toEqual(["smith", "smith"]);
    expect(parsed.clients.items[0]).toEqual({
      id: "c1",
      name: "Smith",
      email: null,
      phone: "250-555-1234",
      address: null,
      updated_at: null,
    });
    expect(parsed.leads.items[0]?.stage).toBe("quoted");
    expect(parsed.tasks.items[0]?.project_id).toBe("p9");
    // Groups the envelope omitted default to empty, and every call builds its
    // own — there is no shared empty envelope for a caller to mutate.
    expect(parsed.projects).toEqual({ total: 0, items: [] });
    expect(parsed.documents).toEqual({ total: 0, items: [] });
    expect(parsed.projects).not.toBe(parseWorkspaceSearchResult(null).projects);
  });

  it("drops documents with an unknown kind and non-finite totals become null", () => {
    const parsed = parseWorkspaceSearchResult({
      query: "inv",
      tokens: ["inv"],
      documents: {
        total: 3,
        items: [
          { id: "d1", kind: "receipt", number: "R-1" },
          { id: "d2", kind: "estimate", number: "EST-9", total: "not a number" },
          { id: "d3", kind: "invoice", number: "INV-3", total: 12 },
        ],
      },
    });
    expect(parsed.documents.items.map((d) => d.id)).toEqual(["d2", "d3"]);
    expect(parsed.documents.items[0]?.total).toBeNull();
    expect(parsed.documents.items[1]?.total).toBe(12);
    expect(parsed.documents.total).toBe(3);
  });

  it("falls back to the kept item count when a group total is malformed", () => {
    const parsed = parseWorkspaceSearchResult({
      query: "oak",
      tokens: ["oak"],
      projects: { total: "many", items: [{ id: "p1", title: "Oak" }] },
    });
    expect(parsed.projects.total).toBe(1);
    expect(parsed.projects.items[0]).toEqual({
      id: "p1",
      title: "Oak",
      address: null,
      status: null,
      client_name: null,
      updated_at: null,
    });
  });

  it("keeps the item count when the total is not a number or numeric string", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `p${index}`,
      title: `Oak ${index}`,
    }));
    // `Number()` happily turns null, "", [] and true into finite numbers, so
    // the coercion has to gate on the type first — otherwise a heading reads
    // "Projects · 0" over eight visible rows.
    for (const bogus of [null, undefined, "", [], true, false, {}, [4]]) {
      const parsed = parseWorkspaceSearchResult({
        query: "oak",
        tokens: ["oak"],
        projects: { total: bogus, items },
      });
      expect(parsed.projects.items).toHaveLength(8);
      expect(parsed.projects.total).toBe(8);
    }
  });

  it("accepts a total that jsonb carried across as a numeric string", () => {
    const parsed = parseWorkspaceSearchResult({
      query: "oak",
      tokens: ["oak"],
      projects: { total: "12", items: [{ id: "p1", title: "Oak" }] },
    });
    expect(parsed.projects.total).toBe(12);
  });

  it("treats a group whose items are not an array as empty", () => {
    const parsed = parseWorkspaceSearchResult({
      query: "oak",
      tokens: ["oak"],
      projects: { total: 3, items: "nope" },
    });
    // A heading claiming three hits above zero rows is exactly the half-built
    // render the parser exists to prevent.
    expect(parsed.projects).toEqual({ total: 0, items: [] });
  });

  it("treats a group that is not an object as empty", () => {
    const parsed = parseWorkspaceSearchResult({
      query: "oak",
      tokens: ["oak"],
      projects: [],
      clients: "nope",
      leads: 7,
      tasks: null,
    });
    for (const group of [parsed.projects, parsed.clients, parsed.leads, parsed.tasks]) {
      expect(group).toEqual({ total: 0, items: [] });
    }
  });

  it("falls back to an empty string when the query is not a string", () => {
    for (const bogus of [null, undefined, 42, ["oak"], { q: "oak" }, true]) {
      expect(parseWorkspaceSearchResult({ query: bogus, tokens: [] }).query).toBe("");
    }
  });
});

describe("WorkspaceSearchService.search", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("calls search_workspace with the query and limit and parses the envelope", async () => {
    rpc.mockResolvedValue({ data: ENVELOPE, error: null });
    const result = await WorkspaceSearchService.search("Hidden", 8);
    expect(rpc).toHaveBeenCalledWith("search_workspace", {
      p_query: "Hidden",
      p_limit_per_kind: 8,
    });
    expect(result.query).toBe("hidden");
    expect(result.projects).toEqual({ total: 0, items: [] });
  });

  it("defaults the per-kind limit to 8", async () => {
    rpc.mockResolvedValue({ data: ENVELOPE, error: null });
    await WorkspaceSearchService.search("Hidden");
    expect(rpc).toHaveBeenCalledWith("search_workspace", {
      p_query: "Hidden",
      p_limit_per_kind: 8,
    });
  });

  it("throws the PostgREST message with its code attached", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function search_workspace", code: "42501" },
    });
    const thrown: unknown = await WorkspaceSearchService.search("x").then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/permission denied/);
    // The code rides along so a denied RPC is distinguishable from a dropped
    // connection without parsing the message.
    expect((thrown as Error & { code?: string }).code).toBe("42501");
  });

  it("returns the empty envelope when the RPC answers with no data", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const result = await WorkspaceSearchService.search("x");
    expect(result).toEqual(emptyWorkspaceSearchResult());
  });
});
