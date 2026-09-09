import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transform } = require("next/dist/build/swc");

// Vitest and TypeScript do not enforce Next's server/client directive rules.
// Exercise the installed production compiler against both review boundaries.
for (const filename of [
  "src/components/agent/action-detail.tsx",
  "src/components/agent/catalog-changes-preview.tsx",
]) {
  test(`${filename} is a valid Next client boundary`, async () => {
    const source = await readFile(filename, "utf8");
    const result = await transform(source, {
      filename,
      jsc: { parser: { syntax: "typescript", tsx: true } },
      serverComponents: {
        isReactServerLayer: true,
        cacheComponentsEnabled: false,
        useCacheEnabled: false,
      },
    });
    assert.match(result.code, /__next_internal_client_entry_do_not_use__/);
  });
}
