import { describe, expect, it } from "vitest";

import en from "@/i18n/dictionaries/en/settings.json";
import es from "@/i18n/dictionaries/es/settings.json";

const keys = [
  "integrations.signature.title",
  "integrations.signature.sectionTitle",
  "integrations.signature.sectionDescription",
  "integrations.signature.state.confirmed",
  "integrations.signature.state.unconfirmed",
  "integrations.signature.held",
  "integrations.signature.signsOffAs",
  "integrations.signature.preview",
  "integrations.signature.fields.name",
  "integrations.signature.fields.title",
  "integrations.signature.fields.optional",
  "integrations.signature.fields.company",
  "integrations.signature.fields.phone",
  "integrations.signature.fields.website",
  "integrations.signature.logo.toggle",
  "integrations.signature.layout.label",
  "integrations.signature.layout.left",
  "integrations.signature.layout.below",
  "integrations.signature.subject.label",
  "integrations.signature.subject.help",
  "integrations.signature.subject.placeholder",
  "integrations.signature.gmailLabel",
  "integrations.signature.gmailHelp",
  "integrations.signature.confirmImported",
  "integrations.signature.buildInstead",
  "integrations.signature.importGmail",
  "integrations.signature.edit",
  "integrations.signature.cancel",
  "integrations.signature.save",
  "integrations.signature.saved",
  "integrations.signature.saveFailed",
  "integrations.signature.imported",
  "integrations.signature.notConfigured",
  "integrations.signature.importFailed",
  "integrations.signature.loadFailed",
  "integrations.signature.retry",
] as const;

/** Retired with the freeform textarea — the builder replaced every one. */
const retiredKeys = [
  "integrations.signature.source.ops",
  "integrations.signature.source.gmail",
  "integrations.signature.source.microsoft365",
  "integrations.signature.missing",
  "integrations.signature.opsLabel",
  "integrations.signature.placeholder",
  "integrations.signature.microsoft365Help",
] as const;

describe("email signature settings dictionaries", () => {
  it.each(keys)("defines %s in English and Spanish", (key) => {
    expect(en[key]).toBeTruthy();
    expect(es[key]).toBeTruthy();
  });

  it.each(retiredKeys)("carries no dead string for %s", (key) => {
    expect(key in en).toBe(false);
    expect(key in es).toBe(false);
  });
});
