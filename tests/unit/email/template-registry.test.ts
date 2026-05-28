import { describe, it, expect } from "vitest";
import {
  TEMPLATE_REGISTRY,
  getTemplateEntry,
  renderTemplate,
} from "@/lib/email/template-registry";

describe("template-registry", () => {
  it("has 27 entries", () => {
    expect(TEMPLATE_REGISTRY.length).toBe(27);
  });

  it("every entry has required fields", () => {
    for (const e of TEMPLATE_REGISTRY) {
      expect(e.templateId).toBeTruthy();
      expect(e.displayName).toBeTruthy();
      expect(e.defaultSubject).toBeTruthy();
      expect(e.previewProps).toBeDefined();
      expect(e.Component).toBeDefined();
      expect(e.sourcePath).toMatch(/\.tsx$/);
    }
  });

  it("templateIds are unique", () => {
    const ids = TEMPLATE_REGISTRY.map((t) => t.templateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getTemplateEntry returns null for unknown id", () => {
    expect(getTemplateEntry("nonexistent")).toBeNull();
  });

  it("getTemplateEntry returns entry for password_reset", () => {
    const entry = getTemplateEntry("password_reset");
    expect(entry).not.toBeNull();
    expect(entry?.displayName).toBe("Password Reset");
  });

  it("renderTemplate returns html for password_reset", async () => {
    const r = await renderTemplate("password_reset", {
      resetLink: "https://x.example/y",
    });
    expect(r).not.toBeNull();
    expect(r!.html.length).toBeGreaterThan(500);
    expect(r!.text.length).toBeGreaterThan(20);
  });

  it("renderTemplate returns null for unknown id", async () => {
    const r = await renderTemplate("nonexistent", {});
    expect(r).toBeNull();
  });
});
