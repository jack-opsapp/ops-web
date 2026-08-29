import "server-only";

// Preserve linguistic shaping controls U+200C/U+200D (ZWNJ/ZWJ). Reject C0/C1
// transport controls plus hidden/bidi instruction channels and tag characters.
const UNSAFE_UNICODE_CONTROL =
  /[\p{Cc}\u00ad\u034f\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/u;
const UNSAFE_UNICODE_CONTROLS =
  /[\p{Cc}\u00ad\u034f\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;

export function hasUnsafeUnicodeControls(
  value: string,
  options: { readonly allowTextWhitespace?: boolean } = {}
): boolean {
  for (const character of value) {
    if (
      UNSAFE_UNICODE_CONTROL.test(character) &&
      !(
        options.allowTextWhitespace &&
        (character === "\n" || character === "\t")
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Zero-width code points whose Unicode bidi class is BN. UAX#9 rule X9 removes
 * BN characters before the bidi algorithm assigns any order, and neither one
 * paints a glyph — so deleting them cannot change the characters a reader sees
 * or the order they see them in.
 *
 * Delivered mail carries them constantly and innocently: Apple Mail marks a
 * quoted body with U+FEFF, and preheader padding is built out of U+200B. A
 * reading of that mail is cleaned of them rather than refused.
 *
 * The bidi MARKS are deliberately absent from this set. U+200E is class L and
 * U+200F is class R — both strong directional characters that can reorder a
 * run of neutrals — so they stay unsafe alongside the embeddings, overrides
 * and isolates. This set is for correspondence bodies only; identifiers keep
 * rejecting every control, zero-width ones included.
 */
const INERT_ZERO_WIDTH_INVISIBLES = /[\u200b\ufeff]/g;

export function stripInertZeroWidthInvisibles(value: string): string {
  return value.replace(INERT_ZERO_WIDTH_INVISIBLES, "");
}

export function stripUnsafeUnicodeControls(value: string): string {
  return value.replace(UNSAFE_UNICODE_CONTROLS, (character) =>
    character === "\n" || character === "\t" ? character : ""
  );
}
