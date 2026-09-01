import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { evaluateExpression, formatResult } from "../expression";

/**
 * Narrowing helper — every success assertion goes through this so a
 * failure reports the actual error branch instead of `undefined`.
 */
function value(input: string): number {
  const result = evaluateExpression(input);
  if (!result.ok) {
    throw new Error(`expected "${input}" to evaluate, got error "${result.error}"`);
  }
  return result.value;
}

describe("evaluateExpression — precedence and grouping", () => {
  it("applies multiplication before addition", () => {
    expect(value("2+3*4")).toBe(14);
  });

  it("honours parentheses", () => {
    expect(value("(2+3)*4")).toBe(20);
  });

  it("nests parentheses", () => {
    expect(value("((2+3)*4)/2")).toBe(10);
  });

  it("divides to a fraction", () => {
    expect(value("10/4")).toBe(2.5);
  });

  it("subtracts left-associatively", () => {
    expect(value("10-3-2")).toBe(5);
  });

  it("rejects the exponent operator — the grammar is + - * / ( ) % only", () => {
    expect(evaluateExpression("2*3^2")).toEqual({ ok: false, error: "malformed" });
  });
});

describe("evaluateExpression — operator glyph aliases", () => {
  it("accepts the multiplication glyph", () => {
    expect(value("6×7")).toBe(42);
  });

  it("accepts the division glyph", () => {
    expect(value("84÷2")).toBe(42);
  });

  it("accepts a lowercase x between digits as multiply", () => {
    expect(value("12x16")).toBe(192);
  });

  it("accepts an uppercase X between digits as multiply", () => {
    expect(value("12X16")).toBe(192);
  });

  it("rejects a leading x — it is an operator, not an operand", () => {
    expect(evaluateExpression("x16")).toEqual({ ok: false, error: "malformed" });
  });
});

describe("evaluateExpression — unary minus", () => {
  it("negates a leading operand", () => {
    expect(value("-5+2")).toBe(-3);
  });

  it("negates an operand after a binary operator", () => {
    expect(value("3*-2")).toBe(-6);
  });

  it("negates a parenthesised group", () => {
    expect(value("-(2+3)")).toBe(-5);
  });
});

describe("evaluateExpression — percent", () => {
  it("treats a postfix percent as a divide-by-one-hundred on the preceding number", () => {
    expect(value("200*10%")).toBe(20);
  });

  it("evaluates a bare percentage", () => {
    expect(value("50%")).toBe(0.5);
  });

  it("applies a postfix percent to a parenthesised group", () => {
    expect(value("(2+3)%")).toBe(0.05);
  });

  it("rejects a percent with no preceding operand", () => {
    expect(evaluateExpression("%5")).toEqual({ ok: false, error: "malformed" });
  });
});

describe("evaluateExpression — separators and whitespace", () => {
  it("tolerates thousands separators and surrounding spaces", () => {
    expect(value(" 1,200 + 300 ")).toBe(1500);
  });

  it("tolerates spaces around every operator", () => {
    expect(value("12 * 4.5 + 120")).toBe(174);
  });

  it("rejects a comma that is not a thousands separator", () => {
    expect(evaluateExpression("1,+2")).toEqual({ ok: false, error: "malformed" });
  });
});

describe("evaluateExpression — decimals and float hygiene", () => {
  it("returns the raw floating-point sum; formatting is what rounds it", () => {
    const raw = value("0.1+0.2");
    expect(raw).toBeCloseTo(0.3, 10);
    expect(formatResult(raw)).toBe("0.3");
  });

  it("evaluates a leading decimal point", () => {
    expect(value(".5*4")).toBe(2);
  });

  it("rejects a number with two decimal points", () => {
    expect(evaluateExpression("1.2.3")).toEqual({ ok: false, error: "malformed" });
  });
});

describe("evaluateExpression — errors", () => {
  it("reports an empty input", () => {
    expect(evaluateExpression("")).toEqual({ ok: false, error: "empty" });
  });

  it("reports whitespace-only input as empty", () => {
    expect(evaluateExpression("   ")).toEqual({ ok: false, error: "empty" });
  });

  it("reports a trailing operator as malformed", () => {
    expect(evaluateExpression("2+")).toEqual({ ok: false, error: "malformed" });
  });

  it("reports an unclosed parenthesis as malformed", () => {
    expect(evaluateExpression("(2+3")).toEqual({ ok: false, error: "malformed" });
  });

  it("reports an unopened parenthesis as malformed", () => {
    expect(evaluateExpression("2+3)")).toEqual({ ok: false, error: "malformed" });
  });

  it("reports a doubled operator as malformed", () => {
    expect(evaluateExpression("2++3")).toEqual({ ok: false, error: "malformed" });
  });

  it("reports letters as malformed", () => {
    expect(evaluateExpression("abc")).toEqual({ ok: false, error: "malformed" });
  });

  it("reports an empty group as malformed", () => {
    expect(evaluateExpression("()")).toEqual({ ok: false, error: "malformed" });
  });

  it("reports division by a literal zero", () => {
    expect(evaluateExpression("5/0")).toEqual({ ok: false, error: "divide_by_zero" });
  });

  it("reports division by an expression that evaluates to zero", () => {
    expect(evaluateExpression("5/(3-3)")).toEqual({
      ok: false,
      error: "divide_by_zero",
    });
  });
});

describe("evaluateExpression — magnitude gate", () => {
  it("accepts a result at the one-trillion ceiling", () => {
    expect(value("1000000*1000000")).toBe(1e12);
  });

  it("rejects a result past the ceiling rather than rounding it badly", () => {
    expect(evaluateExpression("1000000*10000000")).toEqual({
      ok: false,
      error: "out_of_range",
    });
  });

  it("rejects a negative result past the ceiling", () => {
    expect(evaluateExpression("-1000000*10000000")).toEqual({
      ok: false,
      error: "out_of_range",
    });
  });

  it("reports an overflow to infinity as out of range", () => {
    expect(evaluateExpression("9999999999999999*9999999999999999")).toEqual({
      ok: false,
      error: "out_of_range",
    });
  });
});

describe("evaluateExpression — no dynamic code execution", () => {
  it("never reaches eval or the Function constructor", () => {
    // Read the shipped source rather than trusting behaviour: a parser that
    // silently fell back to eval would still pass every test above.
    // NOTE: the plan's literal regex /eval|new Function/ would match the
    // exported name `evaluateExpression`; these patterns pin the actual
    // hazard — a call to `eval` or a `Function` constructor.
    // Resolved from this test's own location. `import.meta.url` is an http://
    // URL under the jsdom environment, so `fileURLToPath` cannot be used here.
    const source = readFileSync(path.resolve(__dirname, "../expression.ts"), "utf8");
    expect(source).not.toMatch(/\beval\b/);
    expect(source).not.toMatch(/new\s+Function/);
    expect(source).not.toMatch(/\bFunction\s*\(/);
  });
});

describe("formatResult", () => {
  it("renders a whole number with no decimal tail", () => {
    expect(formatResult(192)).toBe("192");
  });

  it("groups thousands", () => {
    expect(formatResult(1200.5)).toBe("1,200.5");
  });

  it("trims trailing zeros", () => {
    expect(formatResult(1240.5)).toBe("1,240.5");
    expect(formatResult(45.0)).toBe("45");
  });

  it("rounds half up at two decimals", () => {
    expect(formatResult(2.345)).toBe("2.35");
    expect(formatResult(0.125)).toBe("0.13");
    expect(formatResult(1240.567)).toBe("1,240.57");
  });

  it("rounds 1.005 down — the stored double is 1.00499…, not a true tie", () => {
    // Documented, not desired: `toFixed` rounds the decimal expansion of the
    // binary value. Correcting it needs a decimal library, and the error is a
    // hundredth of a cent. Pinned so a future change to the rounding rule has
    // to acknowledge it.
    expect(formatResult(1.005)).toBe("1");
  });

  it("collapses a negative value that rounds to zero", () => {
    expect(formatResult(-0.001)).toBe("0");
  });

  it("honours a custom maximum-decimals argument", () => {
    expect(formatResult(1.23456, 4)).toBe("1.2346");
    expect(formatResult(211.2, 1)).toBe("211.2");
  });

  it("renders negative zero as zero", () => {
    expect(formatResult(-0)).toBe("0");
  });

  it("keeps the sign on a real negative", () => {
    expect(formatResult(-1234.5)).toBe("-1,234.5");
  });

  it("never falls back to scientific notation", () => {
    // 1e12 is the largest value the evaluator will hand over; `String(1e12)`
    // would still be "1000000000000" but `String(1e21)` is exponential, and
    // grouping must survive at the ceiling either way.
    expect(formatResult(1e12)).toBe("1,000,000,000,000");
  });
});
