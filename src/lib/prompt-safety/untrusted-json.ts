const SAFE_JSON_STRINGIFY = JSON.stringify;

/**
 * Escape only the characters that can manufacture the structural XML-like
 * delimiters around untrusted JSON in OPS prompts. Keeping this function
 * shared makes production prompt length and shadow measurement identical.
 */
export function escapeUntrustedPromptJson(serialized: string): string {
  let escaped = "";
  for (let index = 0; index < serialized.length; index += 1) {
    const character = serialized[index]!;
    switch (character) {
      case "<":
        escaped += "\\u003c";
        break;
      case ">":
        escaped += "\\u003e";
        break;
      case "&":
        escaped += "\\u0026";
        break;
      default:
        escaped += character;
    }
  }
  return escaped;
}

export function serializeUntrustedPromptData(value: unknown): string {
  const serialized = SAFE_JSON_STRINGIFY(value);
  if (typeof serialized !== "string") {
    throw new TypeError("Untrusted prompt data is not JSON serializable");
  }
  return escapeUntrustedPromptJson(serialized);
}
