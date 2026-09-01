/**
 * Element-reference helpers for the bug-report element picker (bug 1f2bf7e9).
 *
 * Every export here is pure: it reads the DOM and returns data. Nothing
 * mutates the document, registers a listener, or holds state — the picker
 * overlay owns all of that. Keeping the identity logic side-effect free is
 * what lets it be unit-tested against hand-built fixtures in jsdom.
 *
 * Contract consumed by the drawer and the admin detail:
 * `ElementReference` in `@/lib/types/bug-report-element`.
 */

import {
  type ElementReference,
  ELEMENT_CROP_PADDING_PX,
} from "@/lib/types/bug-report-element";

// ─── Tunables ──────────────────────────────────────────────────────────────

/** Label snippet cap — long enough to identify a control, short enough to chip. */
const MAX_LABEL_LENGTH = 60;
/** Text snippet cap for the reference payload. */
const MAX_TEXT_LENGTH = 120;
/** Structural selectors stop climbing here — deeper paths break on any reflow. */
const MAX_SELECTOR_DEPTH = 6;
/** An id longer than this is almost always a generated/random token. */
const MAX_USABLE_ID_LENGTH = 40;
/** Nearest N named React components kept in the chain. */
const MAX_COMPONENT_CHAIN = 3;
/** Guard against a malformed fiber ring — never walk forever. */
const MAX_FIBER_HOPS = 60;

/** React attaches its fiber to the host node under a randomly suffixed key. */
const FIBER_KEY_PREFIX = "__reactFiber$";

/** Marks the picker overlay subtree — never pickable, never captured. */
export const PICKER_ROOT_ATTR = "data-element-picker-root";
/** Existing opt-out honoured by the screenshot capture and the drawer. */
const IGNORE_SELECTOR = '[data-bug-report-ignore="true"]';
const PICKER_ROOT_SELECTOR = `[${PICKER_ROOT_ATTR}]`;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ElementDescription {
  label: string;
  role: string;
  tag: string;
  classes: string;
  testId: string | null;
  text: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

interface FiberLike {
  type?: unknown;
  return?: FiberLike | null;
}

// ─── Text helpers ──────────────────────────────────────────────────────────

function collapse(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * `innerText` is layout-aware and preferable in a browser, but jsdom does
 * not implement it. Fall back to `textContent` so the helper behaves
 * identically under test and in production for the snippet's purpose.
 */
function readVisibleText(el: Element): string {
  const inner = (el as HTMLElement).innerText;
  if (typeof inner === "string") return collapse(inner);
  return collapse(el.textContent);
}

// ─── describeElement ───────────────────────────────────────────────────────

const TEXTBOX_INPUT_TYPES = new Set(["text", "email", "search", "url", "tel"]);

function implicitRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
      return "button";
    case "a":
      return el.hasAttribute("href") ? "link" : "generic";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (TEXTBOX_INPUT_TYPES.has(type)) return "textbox";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "generic";
    }
    default:
      return "generic";
  }
}

/**
 * Human-facing identity of an element: what the operator would call it,
 * what it acts as, and the raw hooks (classes / testid) triage greps for.
 *
 * Label precedence — aria-label, visible text, placeholder, alt, title,
 * tag name. The first non-empty wins; each is collapsed and capped.
 */
export function describeElement(el: Element): ElementDescription {
  const tag = el.tagName.toLowerCase();
  const text = clamp(readVisibleText(el), MAX_TEXT_LENGTH);

  const candidates = [
    collapse(el.getAttribute("aria-label")),
    clamp(readVisibleText(el), MAX_LABEL_LENGTH),
    collapse(el.getAttribute("placeholder")),
    collapse(el.getAttribute("alt")),
    collapse(el.getAttribute("title")),
  ];
  const label = candidates.find((c) => c.length > 0) ?? tag;

  return {
    label: clamp(label, MAX_LABEL_LENGTH),
    role: collapse(el.getAttribute("role")) || implicitRole(el),
    tag,
    classes: el.getAttribute("class") ?? "",
    testId: el.getAttribute("data-testid"),
    text,
  };
}

// ─── buildStableSelector ───────────────────────────────────────────────────

/** Quote-safe attribute value for a `[attr="value"]` selector segment. */
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Ids we are willing to anchor on. Excluded: pure digits (list indices),
 * anything over 40 chars (generated tokens), and anything that is not a
 * bare CSS identifier — those would need escaping and are rarely authored.
 */
function isUsableId(id: string | null): id is string {
  if (!id) return false;
  if (id.length > MAX_USABLE_ID_LENGTH) return false;
  if (/^\d+$/.test(id)) return false;
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);
}

function nthOfType(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 1;
  let index = 0;
  for (const sibling of Array.from(parent.children)) {
    if (sibling.tagName === el.tagName) {
      index++;
      if (sibling === el) return index;
    }
  }
  return index || 1;
}

interface Segment {
  segment: string;
  anchor: boolean;
}

function segmentFor(el: Element): Segment {
  const tag = el.tagName.toLowerCase();

  const testId = el.getAttribute("data-testid");
  if (testId) {
    return { segment: `${tag}[data-testid="${escapeAttrValue(testId)}"]`, anchor: true };
  }

  const id = el.getAttribute("id");
  if (isUsableId(id)) {
    return { segment: `#${id}`, anchor: true };
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) {
    return {
      segment: `${tag}[aria-label="${escapeAttrValue(ariaLabel)}"]`,
      anchor: false,
    };
  }

  return { segment: `${tag}:nth-of-type(${nthOfType(el)})`, anchor: false };
}

function resolvesUniquely(doc: Document, selector: string, el: Element): boolean {
  try {
    return doc.querySelector(selector) === el;
  } catch {
    return false;
  }
}

/**
 * A bounded structural CSS path back to `el`.
 *
 * Utility classes are deliberately never emitted — Tailwind strings churn
 * on every restyle, so a class-based path rots within a sprint. The path is
 * built from testid / id / aria-label / `:nth-of-type` segments joined with
 * the child combinator, climbs at most 6 levels, and stops early once an
 * anchor segment (testid or id) already resolves uniquely.
 */
export function buildStableSelector(el: Element): string {
  const doc = el.ownerDocument ?? document;
  const segments: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current && depth < MAX_SELECTOR_DEPTH) {
    const tag = current.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;

    const { segment, anchor } = segmentFor(current);
    segments.unshift(segment);
    depth++;

    const candidate = segments.join(" > ");
    if (anchor && resolvesUniquely(doc, candidate, el)) return candidate;

    current = current.parentElement;
  }

  return segments.join(" > ");
}

// ─── Pickability ───────────────────────────────────────────────────────────

/**
 * SVG children are not `HTMLElement`s and cannot carry the identity we need,
 * so a click on an icon path resolves to the control that owns it.
 */
export function resolvePickTarget(el: Element | null): HTMLElement | null {
  let current: Element | null = el;
  while (current) {
    if (current instanceof HTMLElement) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Can the operator point at this? Excluded: the document shell, zero-size
 * nodes, the picker's own overlay, and anything the bug reporter already
 * opts out of (the drawer and the create cluster carry that attribute).
 * An `<iframe>` is pickable as itself — its contents are another document.
 */
export function isPickable(el: Element | null): boolean {
  if (!el || typeof el.tagName !== "string") return false;

  const tag = el.tagName.toLowerCase();
  if (tag === "html" || tag === "body") return false;

  if (typeof el.closest !== "function") return false;
  if (el.closest(PICKER_ROOT_SELECTOR)) return false;
  if (el.closest(IGNORE_SELECTOR)) return false;

  const rect = el.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;

  return true;
}

/**
 * Hit-test through the overlay. The overlay itself is `pointer-events: auto`
 * (it owns the crosshair and the listeners), so `elementsFromPoint` always
 * returns its subtree first — we skip past it rather than toggling
 * `pointer-events`, which flickers the cursor on every move.
 */
export function pickFromPoint(
  x: number,
  y: number,
  doc: Document = document
): HTMLElement | null {
  const from = (doc as Document).elementsFromPoint;
  if (typeof from !== "function") return null;

  const candidates = from.call(doc, x, y) as Element[] | undefined;
  for (const candidate of candidates ?? []) {
    const target = resolvePickTarget(candidate);
    if (target && isPickable(target)) return target;
  }
  return null;
}

// ─── React component chain ─────────────────────────────────────────────────

/**
 * Nearest named React components owning this node — best effort.
 *
 * Production builds minify component names, so this is documented as often
 * empty; when it does resolve (dev, or a build that keeps names) it is the
 * single most useful line in a triage report. Host components (string
 * types) and anonymous functions are skipped.
 */
export function readComponentChain(el: Element, max: number = MAX_COMPONENT_CHAIN): string[] {
  const key = Object.keys(el).find((k) => k.startsWith(FIBER_KEY_PREFIX));
  if (!key) return [];

  let fiber = (el as unknown as Record<string, FiberLike | null | undefined>)[key] ?? null;
  const names: string[] = [];
  let hops = 0;

  while (fiber && names.length < max && hops < MAX_FIBER_HOPS) {
    hops++;
    const type = fiber.type;
    if (typeof type === "function") {
      const named = type as { displayName?: string; name?: string };
      const name = collapse(named.displayName || named.name);
      if (name) names.push(name);
    }
    fiber = fiber.return ?? null;
  }

  return names;
}

// ─── Crop geometry ─────────────────────────────────────────────────────────

/**
 * The crop window for an element: its rect plus breathing room on every
 * side, clamped to the viewport (a crop cannot read outside the capture)
 * and scaled to the capture's device-pixel space. Integers only — canvas
 * source rectangles on fractional pixels resample and blur.
 */
export function computeCropRect(
  rect: Rect,
  viewport: Size,
  padding: number = ELEMENT_CROP_PADDING_PX,
  scale: number = 1
): Rect {
  const left = Math.max(0, rect.x - padding);
  const top = Math.max(0, rect.y - padding);
  const right = Math.min(viewport.width, rect.x + rect.width + padding);
  const bottom = Math.min(viewport.height, rect.y + rect.height + padding);

  return {
    x: Math.round(left * scale),
    y: Math.round(top * scale),
    width: Math.max(1, Math.round((right - left) * scale)),
    height: Math.max(1, Math.round((bottom - top) * scale)),
  };
}

// ─── buildElementReference ─────────────────────────────────────────────────

function generateId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface BuildElementReferenceOptions {
  /** ISO timestamp — injected in tests, `now` in production. */
  now?: string;
  /** Stable id within the report — injected in tests. */
  id?: string;
}

/**
 * The full payload written to `custom_metadata.elementReferences`.
 * `attachmentIndex` starts null and is assigned by the drawer at submit
 * time, once it knows which references produced a crop.
 */
export function buildElementReference(
  el: HTMLElement,
  options: BuildElementReferenceOptions = {}
): ElementReference {
  const description = describeElement(el);
  const r = el.getBoundingClientRect();
  const rect: Rect = { x: r.x, y: r.y, width: r.width, height: r.height };

  return {
    id: options.id ?? generateId(),
    label: description.label,
    role: description.role,
    tag: description.tag,
    selector: buildStableSelector(el),
    classes: description.classes,
    testId: description.testId,
    text: description.text,
    rect,
    page: {
      x: rect.x + (window.scrollX ?? 0),
      y: rect.y + (window.scrollY ?? 0),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    componentChain: readComponentChain(el),
    capturedAt: options.now ?? new Date().toISOString(),
    attachmentIndex: null,
  };
}
