import dictionary from "@/i18n/dictionaries/en/mcp-tools.json";

/**
 * MCP discovery currently has no negotiated locale, just like its English
 * capability descriptions. Titles are display copy; invocation IDs stay in
 * the capability registry and never depend on this dictionary.
 */
export function mcpToolDisplayTitle(name: string): string {
  if (Object.prototype.hasOwnProperty.call(dictionary.titles, name)) {
    return dictionary.titles[name as keyof typeof dictionary.titles];
  }

  // Future, trusted registry IDs remain readable until their copy is added.
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
