import "server-only";

import { JSDOM } from "jsdom";

import { MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES } from "./limits";
import {
  hashNormalizedCorrespondenceEnvelope,
  hashOriginalCorrespondenceContent,
  isCanonicalRfc3339UtcTimestamp,
  SHA256_SOURCE_VERSION_PATTERN,
  sourceVersionForCorrespondence,
} from "./source-version";
import { hasUnsafeUnicodeControls } from "./unicode-safety";
import type {
  CorrespondenceAttachmentInput,
  NormalizeCorrespondenceInput,
  NormalizedCorrespondenceAttachment,
  NormalizedCorrespondenceEvidence,
} from "./types";

export type { NormalizeCorrespondenceInput } from "./types";

const MAX_ID_LENGTH = 512;
const MAX_RAW_ID_LENGTH = 2_048;
const MAX_METADATA_LENGTH = 2_048;
const MAX_RAW_METADATA_LENGTH = 8_192;
const MAX_ATTACHMENTS = 100;
const MAX_HTML_ELEMENTS = 5_000;
const MAX_CSS_RULES = 20_000;
const MAX_CSS_CASCADE_WORK = 250_000;
const MAX_MSO_HIDE_SELECTORS = 128;
const MAX_MSO_HIDE_SELECTOR_CHARACTERS = 32_768;
const MINIMUM_DISCERNIBLE_TEXT_CONTRAST = 1.8;
const INLINE_HIDDEN_STYLE =
  /(?:^|;)\s*(?:mso-hide\s*:\s*all|content-visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i;
const UNRESOLVED_VISIBILITY_STYLE =
  /(?:^|[;{])\s*(?:-webkit-text-fill-color|background(?:-color)?|block-size|bottom|clip(?:-path)?|color|content-visibility|display|filter|font(?:-size)?|height|inline-size|inset(?:-[a-z]+)?|left|line-height|margin(?:-[a-z]+)?|max-(?:block-size|height|inline-size|width)|min-(?:block-size|height|inline-size|width)|opacity|overflow(?:-[xy])?|position|right|rotate|scale|text-indent|top|transform|translate|visibility|width)\s*:[^;{}]*(?:var|calc|min|max|clamp|round|mod|rem|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|abs|sign)\s*\(/i;
const UNSUPPORTED_VISIBILITY_DECLARATION =
  /(?:^|[;{])\s*(?:-moz-opacity|-webkit-(?:clip-path|filter|text-security|transform)|-webkit-mask(?:-[a-z]+)?|-webkit-text-stroke(?:-[a-z]+)?|animation(?:-[a-z]+)?|backface-visibility|background-blend-mode|content|direction|flex-(?:direction|flow)|float|grid-[a-z-]+|inset-(?:block|inline)(?:-(?:end|start))?|letter-spacing|margin-(?:block|inline)(?:-(?:end|start))?|mask(?:-[a-z]+)?|mix-blend-mode|order|text-decoration(?:-[a-z]+)?|text-overflow|text-shadow|text-transform|transition(?:-[a-z]+)?|unicode-bidi|word-spacing|writing-mode|z-index|zoom)\s*:/i;
const UNSUPPORTED_CSS_AT_RULE = /@[a-z-]+\b/i;
const OUTLOOK_CONDITIONAL_MARKUP =
  /(?:<!--|<!)[^>]{0,128}\[\s*if\b|\[\s*endif\s*\][^>]{0,128}(?:-->|>)/i;
const UNSUPPORTED_LAYOUT_DISPLAY =
  /(?:^|[;{])\s*display\s*:\s*(?:flex|grid|inline-flex|inline-grid)\b/i;
const SYMBOL_FONT_DECLARATION =
  /(?:^|[;{])\s*font(?:-family)?\s*:[^;{}]*(?:dingbats|symbol|webdings|wingdings)/i;
const ZERO_FONT_SHORTHAND =
  /(?:^|[;{])\s*font\s*:\s*(?:(?:normal|italic|oblique|small-caps|bold|bolder|lighter|[1-9]00)\s+)*0(?:\.0+)?(?:[a-z%]+)?(?:\s*\/\s*0(?:\.0+)?(?:[a-z%]+)?)?/i;
const SUPPORTED_CSS_DECLARATIONS = new Set([
  "-webkit-text-fill-color",
  "background",
  "background-attachment",
  "background-clip",
  "background-color",
  "background-image",
  "background-origin",
  "background-position",
  "background-repeat",
  "background-size",
  "block-size",
  "border",
  "border-bottom",
  "border-bottom-color",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-bottom-style",
  "border-bottom-width",
  "border-collapse",
  "border-color",
  "border-left",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-radius",
  "border-right",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-spacing",
  "border-style",
  "border-top",
  "border-top-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-top-style",
  "border-top-width",
  "border-width",
  "bottom",
  "box-sizing",
  "clip",
  "clip-path",
  "color",
  "content-visibility",
  "cursor",
  "display",
  "filter",
  "font",
  "font-family",
  "font-feature-settings",
  "font-kerning",
  "font-optical-sizing",
  "font-size",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-variant-caps",
  "font-variant-east-asian",
  "font-variant-ligatures",
  "font-variant-numeric",
  "font-variation-settings",
  "font-weight",
  "height",
  "hyphens",
  "inline-size",
  "inset",
  "left",
  "line-height",
  "list-style",
  "list-style-image",
  "list-style-position",
  "list-style-type",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-block-size",
  "max-height",
  "max-inline-size",
  "max-width",
  "min-block-size",
  "min-height",
  "min-inline-size",
  "min-width",
  "mso-hide",
  "opacity",
  "outline",
  "outline-color",
  "outline-offset",
  "outline-style",
  "outline-width",
  "overflow",
  "overflow-wrap",
  "overflow-x",
  "overflow-y",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "pointer-events",
  "position",
  "right",
  "rotate",
  "scale",
  "table-layout",
  "text-align",
  "text-indent",
  "text-rendering",
  "top",
  "transform",
  "translate",
  "vertical-align",
  "visibility",
  "white-space",
  "width",
  "word-break",
  "word-wrap",
]);
const SAFE_TEXT_FONT_FAMILIES = new Set([
  "-apple-system",
  "arial",
  "arial black",
  "arial narrow",
  "blinkmacsystemfont",
  "calibri",
  "cambria",
  "courier",
  "courier new",
  "georgia",
  "helvetica",
  "helvetica neue",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "tahoma",
  "times",
  "times new roman",
  "trebuchet ms",
  "ui-monospace",
  "ui-sans-serif",
  "ui-serif",
  "verdana",
]);
const NON_TEXT_TAGS = new Set([
  "script",
  "style",
  "textarea",
  "option",
  "noscript",
  "template",
  "head",
  "title",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "canvas",
  "img",
  "picture",
  "video",
  "audio",
  "source",
  "link",
  "meta",
]);
const LEGACY_VISIBILITY_ATTRIBUTES = [
  "background",
  "bgcolor",
  "color",
  "height",
  "nowrap",
  "size",
  "text",
  "width",
] as const;
const BLOCK_DISPLAY_VALUES = new Set([
  "block",
  "flow-root",
  "flex",
  "grid",
  "list-item",
  "table",
  "table-caption",
  "table-footer-group",
  "table-header-group",
  "table-row",
  "table-row-group",
]);
const INLINE_DISPLAY_VALUES = new Set([
  "contents",
  "inline",
  "inline-block",
  "inline-flex",
  "inline-grid",
  "inline-table",
  "ruby",
  "ruby-base",
  "ruby-text",
  "table-column",
  "table-column-group",
]);
const DEFAULT_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);

function indeterminateCss(): never {
  throw new TypeError("content CSS cannot be evaluated safely");
}

function assertSupportedCssDeclarations(value: string): void {
  // CSS escapes can disguise both property names and selectors. The evidence
  // boundary only accepts declarations whose visibility impact we model.
  if (value.includes("\\") || /\/\*|\*\//.test(value)) {
    return indeterminateCss();
  }
  for (const match of value.matchAll(
    /(?:^|[;{])\s*((?:--|-?[a-z])[a-z0-9-]*)\s*:/gi
  )) {
    if (!SUPPORTED_CSS_DECLARATIONS.has(match[1]!.toLowerCase())) {
      return indeterminateCss();
    }
  }
}

function cleanControls(value: string, allowTextWhitespace = false): string {
  const transportNormalized = value.replace(/\r\n?/g, "\n");
  if (hasUnsafeUnicodeControls(transportNormalized, { allowTextWhitespace })) {
    throw new TypeError("content contains unsafe Unicode controls");
  }
  return transportNormalized.replace(/\u00a0/g, " ").normalize("NFC");
}

function requireRawStringBound(
  value: unknown,
  name: string,
  maximumLength: number
): asserts value is string {
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new TypeError(`${name} is invalid`);
  }
}

function requireRawUtf8ByteBound(
  value: unknown,
  name: string,
  maximumBytes: number
): asserts value is string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new TypeError(`${name} is invalid`);
  }
}

function normalizePlainText(value: string): string {
  const lines = cleanControls(value, true)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));
  return lines.join("\n").trim();
}

function colorAlpha(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (!normalized) return null;
  if (normalized === "transparent") return 0;

  let rawAlpha: string | undefined;
  const slashAlpha = normalized.match(/\/([^/)]+)\)$/);
  if (slashAlpha) {
    rawAlpha = slashAlpha[1];
  } else if (/^(?:rgba|hsla)\(/.test(normalized)) {
    rawAlpha = normalized.slice(0, -1).split(",").at(-1);
  }
  if (!rawAlpha) return 1;
  const alpha = rawAlpha.endsWith("%")
    ? Number.parseFloat(rawAlpha) / 100
    : Number.parseFloat(rawAlpha);
  return Number.isFinite(alpha) ? alpha : null;
}

function isOpaqueColor(value: string): boolean {
  const alpha = colorAlpha(value);
  return alpha !== null && alpha >= 0.99;
}

interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function parsedCanonicalColor(value: string): RgbColor | null {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (normalized === "canvastext") {
    return { red: 0, green: 0, blue: 0 };
  }
  if (normalized === "canvas") {
    return { red: 255, green: 255, blue: 255 };
  }
  const match = normalized.match(
    /^rgba?\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:,(?:\d+(?:\.\d+)?|\.\d+))?\)$/
  );
  if (!match) return null;
  const channels = match.slice(1, 4).map(Number);
  if (channels.some((channel) => !Number.isFinite(channel) || channel > 255)) {
    return null;
  }
  return {
    red: channels[0]!,
    green: channels[1]!,
    blue: channels[2]!,
  };
}

function relativeLuminance(color: RgbColor): number {
  const linear = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(color.red) +
    0.7152 * linear(color.green) +
    0.0722 * linear(color.blue)
  );
}

function contrastRatio(left: RgbColor, right: RgbColor): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

function compositeColor(
  foreground: RgbColor,
  background: RgbColor,
  alpha: number
): RgbColor {
  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  return {
    red: foreground.red * boundedAlpha + background.red * (1 - boundedAlpha),
    green:
      foreground.green * boundedAlpha + background.green * (1 - boundedAlpha),
    blue: foreground.blue * boundedAlpha + background.blue * (1 - boundedAlpha),
  };
}

function hasOnlySafeTextFontFamilies(value: string): boolean {
  if (!value.trim()) return true;
  const families = value.split(",").map((family) =>
    family
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2")
      .toLowerCase()
  );
  return (
    families.length > 0 &&
    families.every(
      (family) => family.length > 0 && SAFE_TEXT_FONT_FAMILIES.has(family)
    )
  );
}

function cssScalar(value: string): number | null {
  const match = value
    .trim()
    .match(
      /^(-?(?:\d+(?:\.\d+)?|\.\d+))(?:%|cap|ch|cm|cqb|cqh|cqi|cqmax|cqmin|cqw|dvb|dvh|dvi|dvw|em|ex|ic|in|lh|lvb|lvh|lvi|lvw|mm|pc|pt|px|q|rcap|rch|rem|rex|ric|rlh|svb|svh|svi|svw|vb|vh|vi|vmax|vmin|vw)?$/i
    );
  if (!match) return null;
  const scalar = Number.parseFloat(match[1]!);
  return Number.isFinite(scalar) ? scalar : null;
}

function isFarOffscreen(value: string): boolean {
  const match = value.trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z]+|%)?$/i);
  if (!match) return false;
  const scalar = Math.abs(Number.parseFloat(match[1]!));
  const unit = match[2]?.toLowerCase() ?? "number";
  if (
    [
      "%",
      "dvb",
      "dvh",
      "dvi",
      "dvw",
      "lvb",
      "lvh",
      "lvi",
      "lvw",
      "svb",
      "svh",
      "svi",
      "svw",
      "vb",
      "vh",
      "vi",
      "vmax",
      "vmin",
      "vw",
    ].includes(unit)
  ) {
    return scalar >= 100;
  }
  const pixelsPerUnit: Readonly<Record<string, number>> = {
    number: 1,
    px: 1,
    q: 96 / 101.6,
    mm: 96 / 25.4,
    cm: 96 / 2.54,
    pt: 96 / 72,
    pc: 16,
    in: 96,
  };
  const pixels = pixelsPerUnit[unit];
  if (pixels === undefined) return indeterminateCss();
  return scalar * pixels >= 1_000;
}

function isZeroLength(value: string): boolean {
  const scalar = cssScalar(value);
  return scalar !== null && Math.abs(scalar) <= 0.01;
}

function hasHiddenScale(value: string): boolean {
  const scaleScalar = (part: string): number | null => {
    const match = part.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(%?)$/);
    if (!match) return null;
    const scalar = Number.parseFloat(match[1]!);
    return match[2] === "%" ? scalar / 100 : scalar;
  };
  const normalized = value.trim().toLowerCase();
  if (normalized && !normalized.includes("(")) {
    const individualScales = normalized
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(scaleScalar);
    if (
      individualScales.length < 1 ||
      individualScales.length > 3 ||
      individualScales.some((scalar) => scalar === null)
    ) {
      return indeterminateCss();
    }
    const x = individualScales[0]!;
    const y = individualScales[1] ?? x;
    return Math.abs(x) <= 0.01 || Math.abs(y) <= 0.01;
  }

  const matches = normalized.matchAll(/scale(3d|x|y)?\(([^)]*)\)/gi);
  for (const match of matches) {
    const kind = match[1] ?? "";
    const scalars = match[2]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(scaleScalar);
    if (scalars.some((scalar) => scalar === null)) return indeterminateCss();
    if (kind === "x" || kind === "y") {
      if (scalars.length !== 1) return indeterminateCss();
      return Math.abs(scalars[0]!) <= 0.01;
    }
    if (kind === "3d") {
      if (scalars.length !== 3) return indeterminateCss();
      return Math.abs(scalars[0]!) <= 0.01 || Math.abs(scalars[1]!) <= 0.01;
    }
    if (scalars.length < 1 || scalars.length > 2) return indeterminateCss();
    const x = scalars[0]!;
    const y = scalars[1] ?? x;
    return Math.abs(x) <= 0.01 || Math.abs(y) <= 0.01;
  }

  for (const match of value.matchAll(/matrix\(([^)]*)\)/gi)) {
    const matrix = match[1]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (
      matrix.length === 6 &&
      matrix.every(Number.isFinite) &&
      (Math.abs(matrix[0]! * matrix[3]! - matrix[1]! * matrix[2]!) <= 0.0001 ||
        isFarOffscreen(String(matrix[4])) ||
        isFarOffscreen(String(matrix[5])))
    ) {
      return true;
    }
  }
  for (const match of value.matchAll(/matrix3d\(([^)]*)\)/gi)) {
    const matrix = match[1]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (matrix.length !== 16 || !matrix.every(Number.isFinite)) {
      return indeterminateCss();
    }
    if (
      Math.abs(matrix[0]! * matrix[5]! - matrix[1]! * matrix[4]!) <= 0.0001 ||
      isFarOffscreen(String(matrix[12])) ||
      isFarOffscreen(String(matrix[13]))
    ) {
      return true;
    }
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (!matrix.every((scalar, index) => scalar === identity[index])) {
      return indeterminateCss();
    }
  }
  return false;
}

function hasHiddenTranslation(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return false;
  if (!normalized.includes("(")) {
    const components = normalized.split(/[\s,]+/).filter(Boolean);
    if (components.length < 1 || components.length > 3) {
      return indeterminateCss();
    }
    return components.slice(0, 2).some(isFarOffscreen);
  }

  const match = normalized.match(/^translate(3d|x|y)?\(([^)]*)\)$/i);
  if (!match) return false;
  const kind = match[1] ?? "";
  const components = match[2]!.split(/[\s,]+/).filter(Boolean);
  if (kind === "x" || kind === "y") {
    if (components.length !== 1) return indeterminateCss();
    return isFarOffscreen(components[0]!);
  }
  if (kind === "3d") {
    if (components.length !== 3) return indeterminateCss();
    return components.slice(0, 2).some(isFarOffscreen);
  }
  if (components.length < 1 || components.length > 2) {
    return indeterminateCss();
  }
  return components.some(isFarOffscreen);
}

function angleInRadians(value: string): number | null {
  const match = value
    .trim()
    .match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(deg|grad|rad|turn)$/i);
  if (!match) return null;
  const scalar = Number.parseFloat(match[1]!);
  switch (match[2]!.toLowerCase()) {
    case "deg":
      return (scalar * Math.PI) / 180;
    case "grad":
      return (scalar * Math.PI) / 200;
    case "turn":
      return scalar * 2 * Math.PI;
    default:
      return scalar;
  }
}

function hasEdgeOnRotation(value: string): boolean {
  for (const match of value.matchAll(/rotate[xy]\(([^)]*)\)/gi)) {
    const angle = angleInRadians(match[1]!);
    if (angle !== null && Math.abs(Math.cos(angle)) <= 0.01) return true;
  }
  return false;
}

function hasHiddenIndividualRotation(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return false;
  const match = normalized.match(/^(?:(x|y|z)\s+)?(.+)$/);
  if (!match) return indeterminateCss();
  const angle = angleInRadians(match[2]!);
  if (angle === null) return indeterminateCss();
  return (
    (match[1] === "x" || match[1] === "y") && Math.abs(Math.cos(angle)) <= 0.01
  );
}

function hasUnsupportedTransform(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return false;
  const supported = new Set([
    "matrix",
    "matrix3d",
    "rotate",
    "rotatex",
    "rotatey",
    "rotatez",
    "scale",
    "scale3d",
    "scalex",
    "scaley",
    "translate",
    "translate3d",
    "translatex",
    "translatey",
  ]);
  const functions = Array.from(
    normalized.matchAll(/([a-z][a-z0-9]*)\s*\(/g),
    (match) => match[1]!
  );
  return (
    functions.length !== 1 || functions.some((name) => !supported.has(name))
  );
}

function cssScaleScalar(value: string): number | null {
  const match = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(%?)$/);
  if (!match) return null;
  const scalar = Number.parseFloat(match[1]!);
  return match[2] === "%" ? scalar / 100 : scalar;
}

function isIdentityTransformInPlane(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return true;

  const match = normalized.match(/^([a-z][a-z0-9]*)\(([^)]*)\)$/);
  if (!match) return false;
  const kind = match[1]!;
  const components = match[2]!.split(/[\s,]+/).filter(Boolean);

  if (["scale", "scalex", "scaley", "scale3d"].includes(kind)) {
    const scalars = components.map(cssScaleScalar);
    if (scalars.some((scalar) => scalar === null)) return false;
    if (kind === "scalex" || kind === "scaley") {
      return scalars.length === 1 && Math.abs(scalars[0]! - 1) <= 0.0001;
    }
    if (kind === "scale3d") {
      return (
        scalars.length === 3 &&
        Math.abs(scalars[0]! - 1) <= 0.0001 &&
        Math.abs(scalars[1]! - 1) <= 0.0001
      );
    }
    const x = scalars[0];
    const y = scalars[1] ?? x;
    return (
      scalars.length >= 1 &&
      scalars.length <= 2 &&
      Math.abs(x! - 1) <= 0.0001 &&
      Math.abs(y! - 1) <= 0.0001
    );
  }

  if (["translate", "translatex", "translatey", "translate3d"].includes(kind)) {
    if (kind === "translatex" || kind === "translatey") {
      return components.length === 1 && isZeroLength(components[0]!);
    }
    if (kind === "translate3d") {
      return (
        components.length === 3 &&
        isZeroLength(components[0]!) &&
        isZeroLength(components[1]!)
      );
    }
    return (
      components.length >= 1 &&
      components.length <= 2 &&
      components.every(isZeroLength)
    );
  }

  if (["rotate", "rotatex", "rotatey", "rotatez"].includes(kind)) {
    if (components.length !== 1) return false;
    const angle = angleInRadians(components[0]!);
    return (
      angle !== null &&
      Math.abs(Math.sin(angle)) <= 0.0001 &&
      Math.abs(Math.cos(angle) - 1) <= 0.0001
    );
  }

  if (kind === "matrix") {
    const matrix = components.map(Number);
    const identity = [1, 0, 0, 1, 0, 0];
    return (
      matrix.length === identity.length &&
      matrix.every(
        (scalar, index) =>
          Number.isFinite(scalar) &&
          Math.abs(scalar - identity[index]!) <= 0.0001
      )
    );
  }

  if (kind === "matrix3d") {
    const matrix = components.map(Number);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return (
      matrix.length === identity.length &&
      matrix.every(
        (scalar, index) =>
          Number.isFinite(scalar) &&
          Math.abs(scalar - identity[index]!) <= 0.0001
      )
    );
  }

  return false;
}

function isIdentityIndividualScaleInPlane(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return true;
  const scalars = normalized
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(cssScaleScalar);
  if (
    scalars.length < 1 ||
    scalars.length > 3 ||
    scalars.some((scalar) => scalar === null)
  ) {
    return false;
  }
  const x = scalars[0]!;
  const y = scalars[1] ?? x;
  return Math.abs(x - 1) <= 0.0001 && Math.abs(y - 1) <= 0.0001;
}

function isIdentityIndividualTranslationInPlane(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return true;
  const components = normalized.split(/[\s,]+/).filter(Boolean);
  return (
    components.length >= 1 &&
    components.length <= 3 &&
    components.slice(0, 2).every(isZeroLength)
  );
}

function isIdentityIndividualRotationInPlane(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return true;
  const match = normalized.match(/^(?:(?:x|y|z)\s+)?(.+)$/);
  if (!match) return false;
  const angle = angleInRadians(match[1]!);
  return (
    angle !== null &&
    Math.abs(Math.sin(angle)) <= 0.0001 &&
    Math.abs(Math.cos(angle) - 1) <= 0.0001
  );
}

function hasNonZeroLayoutLength(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "auto" || normalized === "normal") {
    return false;
  }
  const scalar = cssScalar(normalized);
  if (scalar === null) return indeterminateCss();
  return Math.abs(scalar) > 0.01;
}

function expandedInsetPercentages(value: string): readonly number[] | null {
  const match = value.trim().match(/^inset\(([^)]*)\)$/i);
  if (!match) return null;
  const rawParts = match[1]!
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^0(?:\.0+)?(?:%|[a-z]+)?$/i.test(part)) return 0;
      const percentage = part.match(/^(\d+(?:\.\d+)?|\.\d+)%$/);
      return percentage ? Number.parseFloat(percentage[1]!) : null;
    });
  if (
    rawParts.length < 1 ||
    rawParts.length > 4 ||
    rawParts.some((part) => part === null)
  ) {
    return null;
  }

  const parts = rawParts as number[];
  if (parts.length === 1) return [parts[0]!, parts[0]!, parts[0]!, parts[0]!];
  if (parts.length === 2) return [parts[0]!, parts[1]!, parts[0]!, parts[1]!];
  if (parts.length === 3) return [parts[0]!, parts[1]!, parts[2]!, parts[1]!];
  return parts;
}

function clipPathIsComplete(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return false;

  const inset = expandedInsetPercentages(normalized);
  if (normalized.startsWith("inset(")) {
    if (!inset) return indeterminateCss();
    if (inset.every((edge) => edge === 0)) return false;
    if (inset[0]! + inset[2]! >= 100 || inset[1]! + inset[3]! >= 100) {
      return true;
    }
    return indeterminateCss();
  }

  const circle = normalized.match(/^circle\(([^)]*)\)$/);
  if (circle) {
    const radius = circle[1]!.split(/\s+at\s+/)[0]!.trim();
    if (!radius || ["closest-side", "farthest-side"].includes(radius)) {
      return indeterminateCss();
    }
    if (cssScalar(radius) === null) return indeterminateCss();
    if (isZeroLength(radius)) return true;
    return indeterminateCss();
  }

  const ellipse = normalized.match(/^ellipse\(([^)]*)\)$/);
  if (ellipse) {
    const radii = ellipse[1]!
      .split(/\s+at\s+/)[0]!
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      radii.length !== 2 ||
      radii.some(
        (radius) =>
          !["closest-side", "farthest-side"].includes(radius) &&
          cssScalar(radius) === null
      )
    ) {
      return indeterminateCss();
    }
    if (radii.some(isZeroLength)) return true;
    return indeterminateCss();
  }

  const polygon = normalized.match(/^polygon\(([^)]*)\)$/);
  if (polygon) {
    const rawPoints = polygon[1]!
      .replace(/^(?:evenodd|nonzero)\s*,\s*/, "")
      .split(",")
      .map((point) => point.trim().split(/\s+/));
    if (rawPoints.length < 3 || rawPoints.some((point) => point.length !== 2)) {
      return indeterminateCss();
    }
    const coordinates = rawPoints.map((point) =>
      point.map((coordinate) => {
        const match = coordinate.match(
          /^(-?(?:\d+(?:\.\d+)?|\.\d+))(%|[a-z]+)?$/i
        );
        return match
          ? {
              scalar: Number.parseFloat(match[1]!),
              unit: match[2]?.toLowerCase() ?? "number",
            }
          : null;
      })
    );
    if (coordinates.some((point) => point.some((value) => value === null))) {
      return indeterminateCss();
    }
    for (const axis of [0, 1] as const) {
      const units = new Set(
        coordinates
          .map((point) => point[axis]!)
          .filter((coordinate) => coordinate!.scalar !== 0)
          .map((coordinate) => coordinate!.unit)
      );
      if (units.size > 1) return indeterminateCss();
    }
    const points = coordinates as Array<
      [
        { readonly scalar: number; readonly unit: string },
        { readonly scalar: number; readonly unit: string },
      ]
    >;
    const origin = points[0]!;
    const direction = points.find(
      (point) =>
        point[0].scalar !== origin[0].scalar ||
        point[1].scalar !== origin[1].scalar
    );
    if (!direction) return true;
    const isDegenerate = points.every((point) => {
      const crossProduct =
        (direction[0].scalar - origin[0].scalar) *
          (point[1].scalar - origin[1].scalar) -
        (direction[1].scalar - origin[1].scalar) *
          (point[0].scalar - origin[0].scalar);
      return Math.abs(crossProduct) <= 0.0001;
    });
    if (isDegenerate) return true;
    return indeterminateCss();
  }

  const xywh = normalized.match(/^xywh\(([^)]*)\)$/);
  if (xywh) {
    const dimensions = xywh[1]!
      .split(/\s+round\s+/)[0]!
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      dimensions.length !== 4 ||
      dimensions.some((part) => cssScalar(part) === null)
    ) {
      return indeterminateCss();
    }
    if (isZeroLength(dimensions[2]!) || isZeroLength(dimensions[3]!)) {
      return true;
    }
    if (
      isZeroLength(dimensions[0]!) &&
      isZeroLength(dimensions[1]!) &&
      /^100(?:\.0+)?%$/.test(dimensions[2]!) &&
      /^100(?:\.0+)?%$/.test(dimensions[3]!)
    ) {
      return false;
    }
    return indeterminateCss();
  }

  if (
    /^(?:border-box|content-box|fill-box|padding-box|stroke-box|view-box)$/.test(
      normalized
    )
  ) {
    return false;
  }

  // Path/url/unsupported geometry cannot be proven visible without a layout
  // engine. Reject the whole item rather than silently deleting a real claim.
  return indeterminateCss();
}

interface ComparableCssLength {
  readonly scalar: number;
  readonly unit: string;
}

function comparableCssLength(value: string): ComparableCssLength | null {
  const match = value.trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z]+)?$/i);
  if (!match) return null;
  return {
    scalar: Number.parseFloat(match[1]!),
    unit: match[2]?.toLowerCase() ?? "number",
  };
}

function compareCssLengths(
  left: ComparableCssLength,
  right: ComparableCssLength
): number | null {
  if (left.unit === right.unit) return left.scalar - right.scalar;
  if (left.scalar === 0 || right.scalar === 0) {
    return left.scalar - right.scalar;
  }
  const absolutePixels: Readonly<Record<string, number>> = {
    number: 1,
    px: 1,
    q: 96 / 101.6,
    mm: 96 / 25.4,
    cm: 96 / 2.54,
    pt: 96 / 72,
    pc: 16,
    in: 96,
  };
  const leftFactor = absolutePixels[left.unit];
  const rightFactor = absolutePixels[right.unit];
  if (leftFactor === undefined || rightFactor === undefined) return null;
  return left.scalar * leftFactor - right.scalar * rightFactor;
}

function legacyClipIsComplete(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "auto") return false;
  const match = normalized.match(/^rect\(([^)]*)\)$/);
  if (!match) return indeterminateCss();
  const rawEdges = match[1]!.split(/[\s,]+/).filter(Boolean);
  if (rawEdges.length !== 4) return indeterminateCss();
  const edges = rawEdges.map(comparableCssLength);
  if (edges.some((edge) => edge === null)) return indeterminateCss();
  const [top, right, bottom, left] = edges as ComparableCssLength[];
  const verticalExtent = compareCssLengths(bottom!, top!);
  const horizontalExtent = compareCssLengths(right!, left!);
  if (verticalExtent === null || horizontalExtent === null) {
    return indeterminateCss();
  }
  return verticalExtent <= 0 || horizontalExtent <= 0;
}

function hasCompleteClip(style: CSSStyleDeclaration): boolean {
  return (
    clipPathIsComplete(style.clipPath) ||
    (["absolute", "fixed"].includes(style.position) &&
      legacyClipIsComplete(style.clip))
  );
}

function filterOpacityFraction(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") return 1;
  const match = normalized.match(
    /^opacity\(\s*(-?(?:\d+(?:\.\d+)?|\.\d+))(%?)\s*\)$/
  );
  if (!match) return indeterminateCss();
  const opacity = match[2] === "%" ? Number(match[1]) / 100 : Number(match[1]);
  if (!Number.isFinite(opacity)) return indeterminateCss();
  return opacity;
}

function hasHiddenFilter(value: string): boolean {
  return filterOpacityFraction(value) <= 0.01;
}

function opacityFraction(value: string): number {
  const normalized = value.trim();
  if (!normalized) return 1;
  const match = normalized.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(%?)$/);
  if (!match) return indeterminateCss();
  const opacity = match[2] === "%" ? Number(match[1]) / 100 : Number(match[1]);
  return Number.isFinite(opacity) ? opacity : indeterminateCss();
}

function hasNearZeroFontSize(value: string): boolean {
  if (isZeroLength(value)) return true;
  const pixels = value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)px$/i);
  return pixels !== null && Number.parseFloat(pixels[1]!) <= 1;
}

function isAtMostOnePixel(value: string): boolean {
  const pixels = value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)px$/i);
  return (
    isZeroLength(value) ||
    (pixels !== null && Number.parseFloat(pixels[1]!) <= 1)
  );
}

function hasOffscreenLayout(
  style: CSSStyleDeclaration,
  tagName: string
): boolean {
  if (hasUnsupportedTransform(style.transform)) return indeterminateCss();
  const positioned = ["absolute", "fixed", "relative", "sticky"].includes(
    style.position
  );
  const offscreenPosition =
    positioned &&
    [
      style.left,
      style.right,
      style.top,
      style.bottom,
      ...style.getPropertyValue("inset").split(/\s+/).filter(Boolean),
    ].some(isFarOffscreen);
  const margins = [
    style.marginLeft,
    style.marginRight,
    style.marginTop,
    style.marginBottom,
  ];
  const hasOnlyDefaultBodyMargin =
    tagName === "body" && margins.every((margin) => margin === "8px");
  const clippingDimensions = [
    style.width,
    style.height,
    style.maxWidth,
    style.maxHeight,
    style.getPropertyValue("block-size"),
    style.getPropertyValue("inline-size"),
    style.getPropertyValue("max-block-size"),
    style.getPropertyValue("max-inline-size"),
  ];
  const overflowClips = [style.overflow, style.overflowX, style.overflowY].some(
    (overflow) => overflow === "hidden" || overflow === "clip"
  );
  const zeroClippedBox = overflowClips && clippingDimensions.some(isZeroLength);
  const zeroLineClippedBox =
    overflowClips &&
    isZeroLength(style.lineHeight) &&
    [style.height, style.maxHeight].some(isAtMostOnePixel);
  const hidden =
    offscreenPosition ||
    hasHiddenScale(style.transform) ||
    hasHiddenScale(style.getPropertyValue("scale")) ||
    hasHiddenTranslation(style.transform) ||
    hasHiddenTranslation(style.getPropertyValue("translate")) ||
    hasEdgeOnRotation(style.transform) ||
    hasHiddenIndividualRotation(style.getPropertyValue("rotate")) ||
    hasHiddenFilter(style.filter) ||
    hasCompleteClip(style) ||
    zeroClippedBox ||
    zeroLineClippedBox;
  if (hidden) return true;
  if (isZeroLength(style.lineHeight)) {
    return indeterminateCss();
  }
  if (overflowClips) {
    return indeterminateCss();
  }
  const positionOffsets = [
    style.left,
    style.right,
    style.top,
    style.bottom,
    ...style.getPropertyValue("inset").split(/\s+/).filter(Boolean),
  ];
  if (positioned && positionOffsets.some(hasNonZeroLayoutLength)) {
    return indeterminateCss();
  }
  if (
    (!hasOnlyDefaultBodyMargin && margins.some(hasNonZeroLayoutLength)) ||
    hasNonZeroLayoutLength(style.textIndent) ||
    !isIdentityTransformInPlane(style.transform) ||
    !isIdentityIndividualScaleInPlane(style.getPropertyValue("scale")) ||
    !isIdentityIndividualTranslationInPlane(
      style.getPropertyValue("translate")
    ) ||
    !isIdentityIndividualRotationInPlane(style.getPropertyValue("rotate"))
  ) {
    return indeterminateCss();
  }
  if (style.position === "absolute" || style.position === "fixed") {
    return indeterminateCss();
  }
  return false;
}

function normalizeHtmlText(value: string): string {
  if (OUTLOOK_CONDITIONAL_MARKUP.test(value)) return indeterminateCss();
  const dom = new JSDOM(value, { contentType: "text/html" });
  try {
    const { document, Node: DomNode } = dom.window;
    if (
      Array.from(document.querySelectorAll("link[rel]")).some((link) =>
        (link.getAttribute("rel") ?? "")
          .toLowerCase()
          .split(/\s+/)
          .includes("stylesheet")
      )
    ) {
      return indeterminateCss();
    }
    const elements = Array.from(document.querySelectorAll("*"));
    if (elements.length > MAX_HTML_ELEMENTS) {
      throw new TypeError("content HTML is too complex");
    }
    for (const element of elements) {
      const inlineStyle = element.getAttribute("style") ?? "";
      assertSupportedCssDeclarations(inlineStyle);
      if (
        UNRESOLVED_VISIBILITY_STYLE.test(inlineStyle) ||
        UNSUPPORTED_VISIBILITY_DECLARATION.test(inlineStyle) ||
        UNSUPPORTED_LAYOUT_DISPLAY.test(inlineStyle) ||
        SYMBOL_FONT_DECLARATION.test(inlineStyle)
      ) {
        return indeterminateCss();
      }
      const tagName = element.tagName.toLowerCase();
      const visibleAlternative = [
        element.getAttribute("alt"),
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("title"),
        element.getAttribute("value"),
      ].some((candidate) => candidate?.trim());
      if (
        ["bdi", "bdo"].includes(tagName) ||
        element.hasAttribute("dir") ||
        ["del", "s", "strike"].includes(tagName) ||
        ["select", "textarea"].includes(tagName) ||
        (["meter", "progress"].includes(tagName) &&
          ((element.textContent ?? "").trim().length > 0 ||
            visibleAlternative)) ||
        (tagName === "input" &&
          (element.getAttribute("type") ?? "text").toLowerCase() !==
            "hidden") ||
        (["canvas", "iframe", "math", "object", "svg"].includes(tagName) &&
          ((element.textContent ?? "").trim().length > 0 ||
            visibleAlternative)) ||
        (["embed", "img", "picture", "video"].includes(tagName) &&
          visibleAlternative)
      ) {
        return indeterminateCss();
      }
      if (
        !NON_TEXT_TAGS.has(tagName) &&
        LEGACY_VISIBILITY_ATTRIBUTES.some((attribute) =>
          element.hasAttribute(attribute)
        )
      ) {
        return indeterminateCss();
      }
    }
    for (const styleElement of Array.from(document.querySelectorAll("style"))) {
      const cssText = styleElement.textContent ?? "";
      assertSupportedCssDeclarations(cssText);
      if (
        UNRESOLVED_VISIBILITY_STYLE.test(cssText) ||
        UNSUPPORTED_VISIBILITY_DECLARATION.test(cssText) ||
        UNSUPPORTED_CSS_AT_RULE.test(cssText) ||
        UNSUPPORTED_LAYOUT_DISPLAY.test(cssText) ||
        SYMBOL_FONT_DECLARATION.test(cssText) ||
        ZERO_FONT_SHORTHAND.test(cssText)
      ) {
        return indeterminateCss();
      }
    }

    const msoHiddenElements = new WeakSet<Element>();
    const msoHiddenSelectors: string[] = [];
    let cssRuleCount = 0;
    let msoHiddenSelectorCharacters = 0;
    const markMsoHiddenRules = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        cssRuleCount += 1;
        if (cssRuleCount > MAX_CSS_RULES) {
          throw new TypeError("content CSS is too complex");
        }
        if ("selectorText" in rule && "style" in rule) {
          const styleRule = rule as CSSStyleRule;
          if (styleRule.selectorText.includes(":")) {
            return indeterminateCss();
          }
          if (UNRESOLVED_VISIBILITY_STYLE.test(styleRule.cssText)) {
            throw new TypeError("content CSS cannot be evaluated safely");
          }
          if (
            styleRule.style
              .getPropertyValue("mso-hide")
              .trim()
              .toLowerCase() === "all"
          ) {
            msoHiddenSelectors.push(styleRule.selectorText);
            msoHiddenSelectorCharacters += styleRule.selectorText.length;
            if (
              msoHiddenSelectors.length > MAX_MSO_HIDE_SELECTORS ||
              msoHiddenSelectorCharacters > MAX_MSO_HIDE_SELECTOR_CHARACTERS
            ) {
              throw new TypeError("content CSS is too complex");
            }
          }
        }
        const nestedRules = (rule as CSSRule & { cssRules?: CSSRuleList })
          .cssRules;
        if (nestedRules) markMsoHiddenRules(nestedRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      markMsoHiddenRules(sheet.cssRules);
    }
    if (
      cssRuleCount > 0 &&
      elements.length * cssRuleCount > MAX_CSS_CASCADE_WORK
    ) {
      throw new TypeError("content CSS is too complex");
    }
    if (msoHiddenSelectors.length > 0) {
      try {
        for (const element of Array.from(
          document.querySelectorAll(msoHiddenSelectors.join(","))
        )) {
          msoHiddenElements.add(element);
        }
      } catch {
        throw new TypeError("content CSS cannot be evaluated safely");
      }
    }

    const styleCache = new WeakMap<Element, CSSStyleDeclaration>();
    const styleFor = (element: Element): CSSStyleDeclaration => {
      const cached = styleCache.get(element);
      if (cached) return cached;
      const style = dom.window.getComputedStyle(element);
      styleCache.set(element, style);
      return style;
    };

    const colorIdentityCache = new Map<string, string>();
    const canonicalColorIdentity = (value: string): string => {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return "";
      const cached = colorIdentityCache.get(normalized);
      if (cached) return cached;
      const probe = document.createElement("span");
      probe.style.color = normalized;
      if (!probe.style.color) return indeterminateCss();
      const canonical = dom.window.getComputedStyle(probe).color;
      if (!canonical) return indeterminateCss();
      const identity = canonical.replace(/\s+/g, "").toLowerCase();
      colorIdentityCache.set(normalized, identity);
      return identity;
    };

    const renderedSeparator = (element: Element): "" | "\n" | "\t" => {
      const style = styleFor(element);
      const display = style.display.trim().toLowerCase();
      let authoredDirection = "";
      let directionElement: Element | null = element;
      while (directionElement && !authoredDirection) {
        authoredDirection = (
          directionElement.getAttribute("dir") ?? ""
        ).toLowerCase();
        directionElement = directionElement.parentElement;
      }
      const direction =
        style.direction.trim().toLowerCase() || authoredDirection;
      if (
        [
          "flex",
          "grid",
          "inline-flex",
          "inline-grid",
          "inline-table",
          "table",
          "table-row",
          "table-row-group",
        ].includes(display) &&
        direction === "rtl"
      ) {
        return indeterminateCss();
      }
      if (BLOCK_DISPLAY_VALUES.has(display)) return "\n";
      if (INLINE_DISPLAY_VALUES.has(display)) return "";
      if (display === "table-cell") return "\t";
      if (display === "none") return "";
      if (!display) {
        const tagName = element.tagName.toLowerCase();
        if (tagName === "td" || tagName === "th") return "\t";
        return DEFAULT_BLOCK_TAGS.has(tagName) ? "\n" : "";
      }
      return indeterminateCss();
    };

    const effectiveTextColorFor = (element: Element): string => {
      let fillElement: Element | null = element;
      while (fillElement) {
        const fillColor = styleFor(fillElement)
          .getPropertyValue("-webkit-text-fill-color")
          .trim();
        if (fillColor) {
          const normalizedFill = fillColor.toLowerCase();
          if (normalizedFill === "inherit" || normalizedFill === "unset") {
            fillElement = fillElement.parentElement;
            continue;
          }
          if (normalizedFill === "currentcolor") {
            return styleFor(element).color;
          }
          if (
            normalizedFill === "initial" ||
            normalizedFill === "revert" ||
            normalizedFill === "revert-layer"
          ) {
            return styleFor(element).color;
          }
          return fillColor;
        }
        fillElement = fillElement.parentElement;
      }
      return styleFor(element).color;
    };

    const assertComposableTransformChain = (element: Element): void => {
      let transformedAncestors = 0;
      let transformElement: Element | null = element;
      while (transformElement) {
        const style = styleFor(transformElement);
        const transformValues = [
          style.transform,
          style.getPropertyValue("scale"),
          style.getPropertyValue("rotate"),
          style.getPropertyValue("translate"),
        ];
        for (const rawValue of transformValues) {
          const value = rawValue.trim().toLowerCase();
          if (
            value &&
            value !== "none" &&
            value !== "1" &&
            value !== "1 1" &&
            value !== "1 1 1" &&
            value !== "0deg" &&
            value !== "0px" &&
            value !== "0px 0px" &&
            value !== "0px 0px 0px"
          ) {
            transformedAncestors += 1;
          }
        }
        if (transformedAncestors > 1) return indeterminateCss();
        transformElement = transformElement.parentElement;
      }
    };

    const cumulativeTextAlpha = (
      element: Element,
      effectiveTextColor: string
    ): number => {
      const foregroundAlpha = colorAlpha(effectiveTextColor);
      if (foregroundAlpha === null) return indeterminateCss();
      let alpha = foregroundAlpha;
      let alphaElement: Element | null = element;
      while (alphaElement) {
        const style = styleFor(alphaElement);
        alpha *=
          opacityFraction(style.opacity) * filterOpacityFraction(style.filter);
        alphaElement = alphaElement.parentElement;
      }
      return alpha;
    };

    const hidesSubtree = (element: Element): boolean => {
      const tagName = element.tagName.toLowerCase();
      if (NON_TEXT_TAGS.has(tagName)) return true;
      const inlineStyle = element.getAttribute("style") ?? "";
      if (
        element.hasAttribute("hidden") ||
        element.hasAttribute("popover") ||
        msoHiddenElements.has(element) ||
        INLINE_HIDDEN_STYLE.test(inlineStyle) ||
        ZERO_FONT_SHORTHAND.test(inlineStyle)
      ) {
        return true;
      }
      const style = styleFor(element);
      const opacity = opacityFraction(style.opacity);
      return (
        style.display === "none" ||
        style.contentVisibility === "hidden" ||
        opacity <= 0.01 ||
        hasOffscreenLayout(style, tagName)
      );
    };

    const textIsVisible = (element: Element): boolean => {
      const style = styleFor(element);
      assertComposableTransformChain(element);
      if (!hasOnlySafeTextFontFamilies(style.fontFamily)) {
        return indeterminateCss();
      }
      const fontSize = Number.parseFloat(style.fontSize || "1");
      const effectiveTextColor = effectiveTextColorFor(element);
      const effectiveTextAlpha = cumulativeTextAlpha(
        element,
        effectiveTextColor
      );
      if (effectiveTextAlpha <= 0.01 + Number.EPSILON) return false;
      let backgroundElement: Element | null = element;
      let effectiveBackgroundColor = "rgb(255, 255, 255)";
      while (backgroundElement) {
        const backgroundStyle = styleFor(backgroundElement);
        const backgroundImage = backgroundStyle.backgroundImage
          .trim()
          .toLowerCase();
        if (backgroundImage && backgroundImage !== "none") {
          return indeterminateCss();
        }
        const backgroundColor = backgroundStyle.backgroundColor;
        const backgroundAlpha = colorAlpha(backgroundColor);
        if (
          backgroundAlpha !== null &&
          backgroundAlpha > 0.01 &&
          backgroundAlpha < 0.99
        ) {
          return indeterminateCss();
        }
        if (isOpaqueColor(backgroundColor)) {
          effectiveBackgroundColor = backgroundColor;
          break;
        }
        backgroundElement = backgroundElement.parentElement;
      }
      const foregroundIdentity = canonicalColorIdentity(effectiveTextColor);
      const backgroundIdentity = canonicalColorIdentity(
        effectiveBackgroundColor
      );
      if (foregroundIdentity === backgroundIdentity) return false;
      const foregroundColor = parsedCanonicalColor(foregroundIdentity);
      const backgroundColor = parsedCanonicalColor(backgroundIdentity);
      if (!foregroundColor || !backgroundColor) return indeterminateCss();
      const renderedForeground = compositeColor(
        foregroundColor,
        backgroundColor,
        effectiveTextAlpha
      );
      const renderedContrast = contrastRatio(
        renderedForeground,
        backgroundColor
      );
      if (renderedContrast < MINIMUM_DISCERNIBLE_TEXT_CONTRAST) {
        return indeterminateCss();
      }
      return (
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        (Number.isNaN(fontSize) || !hasNearZeroFontSize(style.fontSize)) &&
        effectiveTextAlpha > 0.01 + Number.EPSILON
      );
    };

    const output: string[] = [];
    const visit = (node: Node, ancestorHidden: boolean): void => {
      if (node.nodeType === DomNode.TEXT_NODE) {
        const parent = node.parentElement;
        if (!ancestorHidden && parent && textIsVisible(parent)) {
          output.push(node.nodeValue ?? "");
        }
        return;
      }
      if (node.nodeType !== DomNode.ELEMENT_NODE) return;

      const element = node as Element;
      const tagName = element.tagName.toLowerCase();
      const hidden = ancestorHidden || hidesSubtree(element);
      if (hidden) return;
      if (tagName === "br") {
        output.push("\n");
        return;
      }
      if (tagName === "details" && !element.hasAttribute("open")) {
        const summary = Array.from(element.children).find(
          (child) => child.tagName.toLowerCase() === "summary"
        );
        if (summary) visit(summary, false);
        return;
      }
      const separator = renderedSeparator(element);
      if (separator) output.push(separator);
      if (tagName === "li") output.push("- ");
      for (const child of Array.from(element.childNodes)) {
        visit(child, hidden);
      }
      if (separator) output.push(separator);
    };

    visit(document.body, false);
    return cleanControls(output.join(""), true)
      .replace(/[^\S\n]+/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
  } finally {
    dom.window.close();
  }
}

function requiredText(
  value: unknown,
  name: string,
  max = MAX_ID_LENGTH
): string {
  requireRawStringBound(value, name, MAX_RAW_ID_LENGTH);
  const normalized = cleanControls(value).trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${name} is invalid`);
  }
  return normalized;
}

function metadataText(value: unknown, name: string): string {
  requireRawStringBound(value, name, MAX_RAW_METADATA_LENGTH);
  const normalized = cleanControls(value).replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > MAX_METADATA_LENGTH) {
    throw new TypeError(`${name} is invalid`);
  }
  return normalized;
}

function nullableMetadataText(value: unknown, name: string): string | null {
  if (value === null) return null;
  requireRawStringBound(value, name, MAX_RAW_METADATA_LENGTH);
  const normalized = cleanControls(value).replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length > MAX_METADATA_LENGTH) {
    throw new TypeError(`${name} is invalid`);
  }
  return normalized;
}

function normalizedTimestamp(value: unknown): string {
  if (!isCanonicalRfc3339UtcTimestamp(value)) {
    throw new TypeError("occurredAt is invalid");
  }
  return value;
}

interface NormalizedAttachmentPair {
  readonly original: CorrespondenceAttachmentInput;
  readonly normalized: NormalizedCorrespondenceAttachment;
}

function normalizeAttachment(value: unknown): NormalizedAttachmentPair {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("attachment is invalid");
  }
  const attachment = value as Record<string, unknown>;
  if (
    attachment.sizeBytes !== null &&
    (!Number.isSafeInteger(attachment.sizeBytes) ||
      (attachment.sizeBytes as number) < 0)
  ) {
    throw new TypeError("attachment sizeBytes is invalid");
  }
  if (typeof attachment.inline !== "boolean") {
    throw new TypeError("attachment inline is invalid");
  }
  if (attachment.contentHash !== null) {
    requireRawStringBound(
      attachment.contentHash,
      "attachment contentHash",
      256
    );
  }
  const contentHash =
    typeof attachment.contentHash === "string"
      ? attachment.contentHash.trim().toLowerCase()
      : null;
  if (
    contentHash !== null &&
    !SHA256_SOURCE_VERSION_PATTERN.test(contentHash)
  ) {
    throw new TypeError("attachment contentHash is invalid");
  }

  requireRawStringBound(
    attachment.attachmentId,
    "attachmentId",
    MAX_RAW_ID_LENGTH
  );
  requireRawStringBound(
    attachment.filename,
    "filename",
    MAX_RAW_METADATA_LENGTH
  );
  if (attachment.mimeType !== null) {
    requireRawStringBound(
      attachment.mimeType,
      "mimeType",
      MAX_RAW_METADATA_LENGTH
    );
  }

  const original = Object.freeze({
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType as string | null,
    sizeBytes: attachment.sizeBytes as number | null,
    inline: attachment.inline,
    contentHash: attachment.contentHash as string | null,
  });
  const normalized = Object.freeze({
    attachmentId: requiredText(attachment.attachmentId, "attachmentId"),
    filename: metadataText(attachment.filename, "filename"),
    mimeType:
      nullableMetadataText(attachment.mimeType, "mimeType")?.toLowerCase() ??
      null,
    sizeBytes: attachment.sizeBytes as number | null,
    inline: attachment.inline,
    contentHash,
  });
  return Object.freeze({ original, normalized });
}

function compareAttachmentPairs(
  left: NormalizedAttachmentPair,
  right: NormalizedAttachmentPair
): number {
  const leftKey = `${left.normalized.attachmentId}\u0000${left.normalized.filename}`;
  const rightKey = `${right.normalized.attachmentId}\u0000${right.normalized.filename}`;
  return Buffer.compare(
    Buffer.from(leftKey, "utf8"),
    Buffer.from(rightKey, "utf8")
  );
}

export function normalizeCorrespondence(
  input: NormalizeCorrespondenceInput
): NormalizedCorrespondenceEvidence {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Correspondence source is required");
  }
  if (Object.prototype.hasOwnProperty.call(input, "sourceKind")) {
    throw new TypeError("Caller-selected correspondence trust is invalid");
  }
  if (
    typeof input.content !== "object" ||
    input.content === null ||
    typeof input.content.value !== "string" ||
    !["text/plain", "text/html"].includes(input.content.mediaType)
  ) {
    throw new TypeError("content is invalid");
  }
  requireRawUtf8ByteBound(
    input.content.value,
    "content",
    MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES
  );
  // Reject hidden/bidirectional instruction channels before HTML parsing can
  // discard them. CR/LF and tab are the only transport controls normalized.
  cleanControls(input.content.value, true);
  if (input.subject !== null) {
    requireRawStringBound(input.subject, "subject", MAX_RAW_METADATA_LENGTH);
  }
  if (
    input.attachments !== undefined &&
    (!Array.isArray(input.attachments) ||
      input.attachments.length > MAX_ATTACHMENTS)
  ) {
    throw new TypeError("attachments are invalid");
  }

  const rawAttachments = input.attachments ?? [];
  const attachmentPairs: NormalizedAttachmentPair[] = [];
  for (let index = 0; index < rawAttachments.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(rawAttachments, index)) {
      throw new TypeError("attachments are invalid");
    }
    attachmentPairs.push(normalizeAttachment(rawAttachments[index]));
  }
  attachmentPairs.sort(compareAttachmentPairs);
  for (let index = 1; index < attachmentPairs.length; index += 1) {
    if (
      attachmentPairs[index - 1]!.normalized.attachmentId ===
      attachmentPairs[index]!.normalized.attachmentId
    ) {
      throw new TypeError("attachmentId is duplicated");
    }
  }

  const evidenceId = requiredText(input.evidenceId, "evidenceId");
  const companyId = requiredText(input.companyId, "companyId");
  const sourceDomain = requiredText(input.sourceDomain, "sourceDomain");
  const sourceType = requiredText(input.sourceType, "sourceType");
  const sourceId = requiredText(input.sourceId, "sourceId");
  const occurredAt = normalizedTimestamp(input.occurredAt);
  const trust = "delivered_correspondence" as const;
  const subject = nullableMetadataText(input.subject, "subject");
  const normalizedPlainText =
    input.content.mediaType === "text/html"
      ? normalizeHtmlText(input.content.value)
      : normalizePlainText(input.content.value);
  const attachments = Object.freeze(
    attachmentPairs.map((pair) => pair.normalized)
  );
  const originalAttachments = Object.freeze(
    attachmentPairs.map((pair) => pair.original)
  );
  const originalContentHash = hashOriginalCorrespondenceContent({
    subject: input.subject,
    content: Object.freeze({
      mediaType: input.content.mediaType,
      value: input.content.value,
    }),
    attachments: originalAttachments,
  });
  const normalizedContentHash = hashNormalizedCorrespondenceEnvelope({
    evidenceId,
    companyId,
    sourceDomain,
    sourceType,
    sourceId,
    occurredAt,
    trust,
    originalContentHash,
    subject,
    normalizedPlainText,
    attachments,
    delivery: null,
    redactionKinds: [],
  });

  return Object.freeze({
    evidenceId,
    companyId,
    sourceDomain,
    sourceType,
    sourceId,
    occurredAt,
    trust,
    subject,
    normalizedPlainText,
    attachments,
    delivery: null,
    redactionKinds: Object.freeze([]),
    originalContentHash,
    normalizedContentHash,
    sourceVersion: sourceVersionForCorrespondence({
      sourceDomain,
      sourceType,
      sourceId,
      originalContentHash,
    }),
  });
}
