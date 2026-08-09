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

export function stripUnsafeUnicodeControls(value: string): string {
  return value.replace(UNSAFE_UNICODE_CONTROLS, (character) =>
    character === "\n" || character === "\t" ? character : ""
  );
}
