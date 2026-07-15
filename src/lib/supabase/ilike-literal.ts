/** Escape a literal before passing it to a PostgREST `like`/`ilike` filter. */
export function escapeIlikeLiteral(value: string): string {
  return value.replace(/[%_\\]/g, (character) => `\\${character}`);
}
