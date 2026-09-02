#!/usr/bin/env node
// Tailwind's `/NN` modifier REPLACES the alpha channel of a colour token defined as an
// rgba string (`bg-fill-neutral-dim/60` compiles to 60% white, not 60% of 6%), and it
// silently DROPS the whole declaration for a `var()` token (`bg-rose-soft/30` emits no
// CSS at all). Both are always bugs; the ban is documented in CLAUDE.md § Design System.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "tailwind.config.ts");
const SCAN_DIRS = ["src", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".mdx"]);
const UTILITY_PREFIXES = [
  "bg", "border", "text", "ring", "divide", "outline", "from", "via", "to",
  "fill", "stroke", "shadow", "accent", "caret", "decoration", "placeholder",
];
const MIN_EXPECTED_VULNERABLE = 10;

const OPEN_RE = /^\s*["']?([A-Za-z0-9_$-]+)["']?\s*:\s*\{/;
const KV_RE = /^\s*["']?([A-Za-z0-9_$-]+)["']?\s*:\s*(?:"([^"]*)"|'([^']*)')\s*,?\s*$/;

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

function blankStrings(line) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      out += " ";
      if (ch === "\\") {
        out += " ";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

function readColorTokens() {
  const text = readFileSync(CONFIG_PATH, "utf8");
  const match = /colors:\s*\{/.exec(text);
  if (!match) return null;

  const lines = text.slice(match.index).split("\n");
  const tokens = new Map();
  const stack = [];
  let depth = 1;

  for (let i = 1; i < lines.length && depth > 0; i += 1) {
    const line = stripComment(lines[i]);
    const skeleton = blankStrings(line);
    const opens = (skeleton.match(/\{/g) ?? []).length;
    const closes = (skeleton.match(/\}/g) ?? []).length;

    const openMatch = opens > 0 ? OPEN_RE.exec(line) : null;
    if (openMatch) {
      stack.push(openMatch[1]);
      depth += opens;
      continue;
    }

    const kvMatch = KV_RE.exec(line);
    if (kvMatch) {
      const name = [...stack, kvMatch[1]].filter((s) => s !== "DEFAULT").join("-");
      const value = kvMatch[2] ?? kvMatch[3] ?? "";
      if (name) tokens.set(name, value);
      continue;
    }

    for (let c = 0; c < closes; c += 1) {
      depth -= 1;
      if (depth <= 0) break;
      stack.pop();
    }
    depth += opens;
  }

  return tokens;
}

function isVulnerable(value) {
  if (value.includes("<alpha-value>")) return false;
  if (value.includes("var(")) return true;
  const rgba = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(value);
  if (rgba) return Number.parseFloat(rgba[1]) < 1;
  return false;
}

function walk(dir, files) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const tokens = readColorTokens();
if (!tokens) {
  console.error(
    "slash-opacity guard: no `colors: {` block found in tailwind.config.ts — the parser has drifted from the config's shape and must be updated.",
  );
  process.exit(2);
}

const vulnerable = [...tokens.entries()]
  .filter(([, value]) => isVulnerable(value))
  .map(([name]) => name);

if (vulnerable.length < MIN_EXPECTED_VULNERABLE) {
  console.error(
    `slash-opacity guard: parsed only ${vulnerable.length} string-colour tokens from tailwind.config.ts (expected at least ${MIN_EXPECTED_VULNERABLE}).`,
  );
  console.error(
    "The parser has drifted from tailwind.config.ts's shape and must be updated — refusing to pass on an unverified scan.",
  );
  process.exit(2);
}

const names = [...vulnerable]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"));
const pattern = new RegExp(
  `(?:${UTILITY_PREFIXES.join("|")})-(?:${names.join("|")})\\/(?:\\[?[0-9.])`,
  "g",
);

const files = SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir), []));
const violations = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    for (const hit of lines[i].matchAll(pattern)) {
      violations.push(`${path.relative(ROOT, file)}:${i + 1}: ${hit[0]}`);
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  console.error(
    `slash-opacity guard: ${violations.length} violation(s) — the /NN modifier replaces the alpha of rgba-string tokens and drops the declaration for var() tokens. Use the token whose designed value matches the intent (see CLAUDE.md § Design System).`,
  );
  process.exit(1);
}

console.log(
  `slash-opacity guard: ${vulnerable.length} string-color tokens guarded, ${files.length} files clean.`,
);
