/**
 * Safe arithmetic evaluator for the line-item calculator.
 *
 * The grammar is deliberately tiny — `+ - * / ( ) %` over decimal literals,
 * plus unary minus. There is no dynamic code execution anywhere in this
 * module and there never may be: the input is operator-typed text from an
 * estimate form, and a parser is the only defensible way to read it.
 *
 * Pipeline: normalise → tokenise → shunting-yard to RPN → fold.
 */

/** A postfix `%` divides the operand it follows by this. */
const PERCENT_DIVISOR = 100;

/**
 * Results past a trillion are rejected rather than rounded. No estimate line
 * needs that magnitude, and beyond it the ×100 round-trip used for cent
 * rounding starts losing whole units — an error state is honest where a
 * silently mangled number is not.
 */
const MAX_RESULT_MAGNITUDE = 1e12;

export type ExpressionError =
  | "empty"
  | "malformed"
  | "divide_by_zero"
  | "out_of_range";

export type ExpressionResult =
  | { ok: true; value: number }
  | { ok: false; error: ExpressionError };

type BinaryOperator = "+" | "-" | "*" | "/";
type StackOperator = BinaryOperator | "u-" | "(";

type Token =
  | { kind: "number"; value: number }
  | { kind: "operator"; value: BinaryOperator }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "percent" };

type RpnNode =
  | { kind: "number"; value: number }
  | { kind: "binary"; value: BinaryOperator }
  | { kind: "negate" }
  | { kind: "percent" };

/** Binding power. Higher binds tighter; unary minus outranks both tiers. */
const PRECEDENCE: Record<Exclude<StackOperator, "(">, number> = {
  "+": 2,
  "-": 2,
  "*": 3,
  "/": 3,
  "u-": 4,
};

const MALFORMED: ExpressionResult = { ok: false, error: "malformed" };

/**
 * Strips thousands separators — but only commas that genuinely sit between
 * digits, so a stray comma still fails as malformed instead of vanishing.
 */
function stripThousandsSeparators(input: string): string {
  return input.replace(/(\d),(?=\d)/g, "$1");
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

/** Returns null when the input contains a character outside the grammar. */
function tokenise(input: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }

    if (isDigit(char) || char === ".") {
      let literal = "";
      let seenDot = false;
      while (index < input.length) {
        const next = input[index];
        if (isDigit(next)) {
          literal += next;
          index += 1;
          continue;
        }
        if (next === ".") {
          // A second dot in one literal is malformed, not a token boundary.
          if (seenDot) return null;
          seenDot = true;
          literal += next;
          index += 1;
          continue;
        }
        break;
      }
      if (literal === ".") return null;
      const parsed = Number(literal);
      if (!Number.isFinite(parsed)) return null;
      tokens.push({ kind: "number", value: parsed });
      continue;
    }

    index += 1;

    switch (char) {
      case "+":
      case "-":
      case "*":
      case "/":
        tokens.push({ kind: "operator", value: char });
        continue;
      // Glyph aliases: the keypad and pasted text both produce these.
      case "×":
        tokens.push({ kind: "operator", value: "*" });
        continue;
      case "÷":
        tokens.push({ kind: "operator", value: "/" });
        continue;
      // `12x16` is how a trade writes a multiplication by hand.
      case "x":
      case "X":
        tokens.push({ kind: "operator", value: "*" });
        continue;
      case "(":
        tokens.push({ kind: "lparen" });
        continue;
      case ")":
        tokens.push({ kind: "rparen" });
        continue;
      case "%":
        tokens.push({ kind: "percent" });
        continue;
      default:
        return null;
    }
  }

  return tokens;
}

/**
 * Shunting-yard. `expectOperand` is the whole validity check: it is true
 * wherever a value may legally start, so a doubled operator, an empty group
 * or a trailing operator all fall out of it without a second pass.
 */
function toRpn(tokens: Token[]): RpnNode[] | null {
  const output: RpnNode[] = [];
  const operators: StackOperator[] = [];
  let expectOperand = true;

  for (const token of tokens) {
    switch (token.kind) {
      case "number": {
        if (!expectOperand) return null;
        output.push({ kind: "number", value: token.value });
        expectOperand = false;
        break;
      }
      case "lparen": {
        if (!expectOperand) return null;
        operators.push("(");
        break;
      }
      case "rparen": {
        if (expectOperand) return null;
        let matched = false;
        while (operators.length > 0) {
          const top = operators.pop() as StackOperator;
          if (top === "(") {
            matched = true;
            break;
          }
          output.push(top === "u-" ? { kind: "negate" } : { kind: "binary", value: top });
        }
        if (!matched) return null;
        expectOperand = false;
        break;
      }
      case "percent": {
        // Postfix: it binds to the operand just emitted, so it can go
        // straight to the output with no precedence negotiation.
        if (expectOperand) return null;
        output.push({ kind: "percent" });
        break;
      }
      case "operator": {
        if (expectOperand) {
          // Only minus may be unary — this is what makes `2++3` malformed
          // while `2+-3` stays legal.
          if (token.value !== "-") return null;
          operators.push("u-");
          break;
        }
        const precedence = PRECEDENCE[token.value];
        while (operators.length > 0) {
          const top = operators[operators.length - 1];
          if (top === "(") break;
          // Every binary operator here is left-associative, and unary minus
          // outranks all of them, so `>=` is correct for both.
          if (PRECEDENCE[top] < precedence) break;
          operators.pop();
          output.push(top === "u-" ? { kind: "negate" } : { kind: "binary", value: top });
        }
        operators.push(token.value);
        expectOperand = true;
        break;
      }
    }
  }

  if (expectOperand) return null;

  while (operators.length > 0) {
    const top = operators.pop() as StackOperator;
    if (top === "(") return null;
    output.push(top === "u-" ? { kind: "negate" } : { kind: "binary", value: top });
  }

  return output;
}

function fold(nodes: RpnNode[]): ExpressionResult {
  const stack: number[] = [];

  for (const node of nodes) {
    switch (node.kind) {
      case "number":
        stack.push(node.value);
        break;
      case "negate": {
        const operand = stack.pop();
        if (operand === undefined) return MALFORMED;
        stack.push(-operand);
        break;
      }
      case "percent": {
        const operand = stack.pop();
        if (operand === undefined) return MALFORMED;
        stack.push(operand / PERCENT_DIVISOR);
        break;
      }
      case "binary": {
        const right = stack.pop();
        const left = stack.pop();
        if (right === undefined || left === undefined) return MALFORMED;
        if (node.value === "/" && right === 0) {
          return { ok: false, error: "divide_by_zero" };
        }
        switch (node.value) {
          case "+":
            stack.push(left + right);
            break;
          case "-":
            stack.push(left - right);
            break;
          case "*":
            stack.push(left * right);
            break;
          case "/":
            stack.push(left / right);
            break;
        }
        break;
      }
    }
  }

  if (stack.length !== 1) return MALFORMED;
  const [result] = stack;
  // Overflow to Infinity is not an answer anyone can insert into a quote.
  if (!Number.isFinite(result)) return { ok: false, error: "out_of_range" };
  if (Math.abs(result) > MAX_RESULT_MAGNITUDE) {
    return { ok: false, error: "out_of_range" };
  }
  return { ok: true, value: result };
}

/**
 * Evaluates an arithmetic expression typed into the calculator.
 *
 * Returns the raw floating-point value — rounding for display and for
 * insertion is `formatResult`'s job, so the two never disagree.
 */
export function evaluateExpression(input: string): ExpressionResult {
  if (input.trim() === "") return { ok: false, error: "empty" };

  const tokens = tokenise(stripThousandsSeparators(input));
  if (tokens === null) return MALFORMED;
  if (tokens.length === 0) return { ok: false, error: "empty" };

  const rpn = toRpn(tokens);
  if (rpn === null) return MALFORMED;

  return fold(rpn);
}

/**
 * Rounds to `maxDecimals` via `toFixed`, which rounds ties away from zero on
 * the decimal expansion of the stored double.
 *
 * In practice that is half-up for every value a user can type — `2.345`
 * rounds to `2.35`, `0.125` to `0.13` — with one honest caveat: a literal
 * like `1.005` is *stored* as 1.00499999999999989, so it rounds to `1.00`.
 * No decimal-accurate alternative exists without a decimal library, and the
 * discrepancy is a hundredth of a cent on a quantity field.
 *
 * `evaluateExpression` gates results at 1e12, so the multiply-round-divide
 * precision cliff past the safe-integer range is never reached here.
 */
function roundToDecimals(value: number, maxDecimals: number): number {
  return Number(value.toFixed(maxDecimals));
}

/**
 * Rounds half up to `maxDecimals`, then renders with thousands grouping and
 * no trailing zeros — `192` stays `192`, `1240.567` becomes `1,240.57`.
 */
export function formatResult(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return "0";

  const rounded = roundToDecimals(value, maxDecimals);
  // `Number("-0.00")` is negative zero, which `Intl` renders as "-0".
  // `-0 === 0` is true, so this collapses it without a branch.
  const normalised = rounded === 0 ? 0 : rounded;

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
    useGrouping: true,
  }).format(normalised);
}

/**
 * The single rounding rule for a number leaving the calculator. Insertion and
 * display share it so the field can never disagree with the result readout.
 */
export function roundForInsert(value: number): number {
  const rounded = roundToDecimals(value, 2);
  return rounded === 0 ? 0 : rounded;
}
