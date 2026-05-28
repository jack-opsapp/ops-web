/**
 * One-off render harness for SPEC Phase 1 templates.
 *
 * Renders each spec.* template with its previewProps and prints subject +
 * plaintext + length-of-HTML so a reviewer can eyeball the output without
 * needing a SendGrid send. Used at Stage H handoff time.
 *
 * Run with: npx tsx scripts/spec-template-render-sample.ts
 */
import * as React from "react";
import { render as renderEmail } from "@react-email/render";
import { TEMPLATE_REGISTRY } from "../src/lib/email/template-registry";

async function main() {
  const specEntries = TEMPLATE_REGISTRY.filter((t) => t.templateId.startsWith("spec."));
  for (const entry of specEntries) {
    const el = React.createElement(entry.Component as React.ComponentType<unknown>, entry.previewProps);
    const html = await renderEmail(el, { pretty: false });
    const text = await renderEmail(el, { plainText: true });
    const firstLine = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)[0] ?? "(empty)";
    const secondLine =
      text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)[1] ?? "(empty)";
    console.log("─".repeat(72));
    console.log(`templateId    : ${entry.templateId}`);
    console.log(`displayName   : ${entry.displayName}`);
    console.log(`defaultSubject: ${entry.defaultSubject}`);
    console.log(`html length   : ${html.length} chars`);
    console.log(`text length   : ${text.length} chars`);
    console.log(`first line    : ${firstLine}`);
    console.log(`second line   : ${secondLine}`);
  }
  console.log("─".repeat(72));
  console.log(`Rendered ${specEntries.length} SPEC templates.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
