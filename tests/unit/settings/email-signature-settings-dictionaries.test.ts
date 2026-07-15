import { describe, expect, it } from "vitest";

import en from "@/i18n/dictionaries/en/settings.json";
import es from "@/i18n/dictionaries/es/settings.json";

const keys = [
  "integrations.signature.title",
  "integrations.signature.sectionTitle",
  "integrations.signature.sectionDescription",
  "integrations.signature.source.ops",
  "integrations.signature.source.gmail",
  "integrations.signature.source.microsoft365",
  "integrations.signature.missing",
  "integrations.signature.preview",
  "integrations.signature.opsLabel",
  "integrations.signature.placeholder",
  "integrations.signature.gmailHelp",
  "integrations.signature.microsoft365Help",
  "integrations.signature.importGmail",
  "integrations.signature.edit",
  "integrations.signature.cancel",
  "integrations.signature.save",
  "integrations.signature.saved",
  "integrations.signature.saveFailed",
  "integrations.signature.imported",
  "integrations.signature.importFailed",
  "integrations.signature.loadFailed",
  "integrations.signature.retry",
] as const;

describe("email signature settings dictionaries", () => {
  it.each(keys)("defines %s in English and Spanish", (key) => {
    expect(en[key]).toBeTruthy();
    expect(es[key]).toBeTruthy();
  });
});
