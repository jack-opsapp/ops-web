/**
 * Unit tests for the inbox header's in-place search composition.
 *
 * The threads endpoint (`/api/inbox/threads?q=…`) ILIKEs across four
 * columns (subject, latest_snippet, latest_sender_name, latest_sender_email)
 * and composes that disjunction with the active rail predicate via an
 * additional `.or(...)` chained onto the Supabase query builder. PostgREST
 * chains multiple `.or()` calls with implicit AND semantics, so the search
 * filter narrows whatever rail the operator is on rather than replacing it.
 *
 * Two surfaces are tested here:
 *
 *   1. `buildSearchOrExpression` — escapes user input so commas, periods,
 *      parens, ILIKE wildcards, and quotes can't break the `.or()` filter
 *      expression or silently turn into a SQL wildcard.
 *   2. Composition with `applyRailPredicate` — a mock query builder records
 *      every `.or(...)` call. The rail predicate's `.or` and the search's
 *      `.or` should both fire and be independent strings (the AND happens
 *      at the PostgREST parser layer; the builder just chains them).
 */

import { describe, expect, it } from "vitest";
import { buildSearchOrExpression } from "@/lib/api/services/email-thread-service";
import { applyRailPredicate } from "@/lib/inbox/rail-predicates";

const NOW = "2026-05-12T15:00:00Z";

describe("buildSearchOrExpression — user input escaping", () => {
  it("wraps the value in double quotes and covers all four searchable columns", () => {
    const expr = buildSearchOrExpression("acme");
    expect(expr).toBe(
      [
        'subject.ilike."%acme%"',
        'latest_snippet.ilike."%acme%"',
        'latest_sender_name.ilike."%acme%"',
        'latest_sender_email.ilike."%acme%"',
      ].join(","),
    );
  });

  it("keeps each column term whole when the input contains a comma", () => {
    const expr = buildSearchOrExpression("a, b");
    // PostgREST's .or() uses commas to separate filter expressions but
    // allows commas inside double-quoted values — so a naive split(",")
    // here would see eight pieces (four column terms + four embedded
    // commas), and that's fine: the PostgREST parser tracks quote state.
    // What we DO want to assert is that no column term got duplicated or
    // truncated by the comma in the user's input.
    expect(expr.match(/subject\.ilike\./g)?.length).toBe(1);
    expect(expr.match(/latest_snippet\.ilike\./g)?.length).toBe(1);
    expect(expr.match(/latest_sender_name\.ilike\./g)?.length).toBe(1);
    expect(expr.match(/latest_sender_email\.ilike\./g)?.length).toBe(1);
    expect(expr).toContain('"%a, b%"');
  });

  it("preserves periods and parens inside the quoted value", () => {
    const expr = buildSearchOrExpression("(acme).co");
    expect(expr).toContain('"%(acme).co%"');
    expect(expr.match(/subject\.ilike\./g)?.length).toBe(1);
  });

  it("escapes ILIKE wildcards so user input matches literally", () => {
    // ILIKE layer turns `%` into `\%`; PostgREST-quoted layer doubles each
    // resulting `\` to `\\`. So on the wire, a literal `%` typed by the
    // operator shows up as `\\%` inside the quoted value — PostgREST
    // de-quotes that to `\%`, which ILIKE parses as a literal `%`.
    const exprPct = buildSearchOrExpression("100%");
    expect(exprPct).toContain('"%100\\\\%%"');
    const exprUnd = buildSearchOrExpression("foo_bar");
    expect(exprUnd).toContain('"%foo\\\\_bar%"');
  });

  it("escapes a literal backslash through both the ILIKE and PostgREST layers", () => {
    // Layer 1 turns `\` into `\\` (the SQL escape sequence for a literal
    // backslash inside ILIKE). Layer 2 then escapes both of those for the
    // PostgREST quoted value — so each user-typed backslash becomes four
    // backslashes on the wire, which PostgREST de-quotes to `\\`, which
    // SQL ILIKE parses as a single literal backslash. Test exactly that
    // shape.
    const expr = buildSearchOrExpression("a\\b");
    expect(expr).toContain('"%a\\\\\\\\b%"');
  });

  it("escapes embedded double quotes so the PostgREST quoted value parses", () => {
    const expr = buildSearchOrExpression('a"b');
    expect(expr).toContain('"%a\\"b%"');
  });
});

describe("search + rail predicate composition", () => {
  /**
   * A minimal recording double for the Supabase query builder. Each chained
   * call returns the same instance and stamps the call onto `calls`, so a
   * test can assert that BOTH the rail predicate and the search filter
   * produced `.or(...)` invocations during the chain.
   */
  function makeRecorder() {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const recorder: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of [
      "is",
      "not",
      "or",
      "gt",
      "contains",
      "eq",
      "in",
      "order",
      "limit",
      "lt",
    ]) {
      recorder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return recorder;
      };
    }
    return { recorder, calls };
  }

  it("YOUR_MOVE composes with search — both predicates produce independent .or() calls", () => {
    const { recorder, calls } = makeRecorder();
    let q = recorder as unknown as Parameters<typeof applyRailPredicate>[0];

    // Apply the rail predicate first (as the production path does).
    q = applyRailPredicate(q, "YOUR_MOVE", NOW);
    // Then apply the search filter (as the production path does).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).or(buildSearchOrExpression("acme"));

    const orCalls = calls.filter((c) => c.method === "or");
    // YOUR_MOVE emits TWO .or() calls (snooze guard + ball-in-court union);
    // the search filter adds a THIRD. Treating them as independent strings
    // is exactly what we want — PostgREST ANDs them.
    expect(orCalls.length).toBe(3);

    const searchOr = orCalls[orCalls.length - 1].args[0] as string;
    expect(searchOr).toContain("subject.ilike.");
    expect(searchOr).toContain("latest_snippet.ilike.");
    expect(searchOr).toContain("latest_sender_name.ilike.");
    expect(searchOr).toContain("latest_sender_email.ilike.");
    expect(searchOr).toContain('"%acme%"');

    // Sanity: the search expression must NOT mention any rail-predicate
    // columns. If we ever accidentally merge the two predicates into one
    // string we'd lose AND semantics.
    expect(searchOr).not.toContain("has_unresolved_commitments");
    expect(searchOr).not.toContain("agent_blocking_question");
  });

  it("WAITING composes with search — search filter is appended, predicate columns untouched", () => {
    const { recorder, calls } = makeRecorder();
    let q = recorder as unknown as Parameters<typeof applyRailPredicate>[0];

    q = applyRailPredicate(q, "WAITING", NOW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).or(buildSearchOrExpression("invoice"));

    const orCalls = calls.filter((c) => c.method === "or");
    const searchOr = orCalls[orCalls.length - 1].args[0] as string;
    expect(searchOr).toContain('"%invoice%"');

    // WAITING applies `archived_at IS NULL`, the snooze guard `.or`, an
    // equality on `has_unresolved_commitments`, a NOT-contains on labels,
    // an `agent_blocking_question IS NULL`, AND the direction `.or` — none
    // of those columns should appear in the search expression.
    expect(searchOr).not.toContain("archived_at");
    expect(searchOr).not.toContain("latest_direction");
  });

  it("ARCHIVED composes with search — the only rail predicate call is `archived_at IS NOT NULL`", () => {
    const { recorder, calls } = makeRecorder();
    let q = recorder as unknown as Parameters<typeof applyRailPredicate>[0];

    q = applyRailPredicate(q, "ARCHIVED", NOW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).or(buildSearchOrExpression("legal"));

    const orCalls = calls.filter((c) => c.method === "or");
    expect(orCalls.length).toBe(1);
    expect(orCalls[0].args[0]).toContain('"%legal%"');
  });
});
