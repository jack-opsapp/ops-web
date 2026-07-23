// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const lifecycleSettingsSource = readFileSync(
  join(process.cwd(), "src/components/settings/lifecycle-settings-tab.tsx"),
  "utf8"
);
const settingsDomainsSource = readFileSync(
  join(process.cwd(), "src/components/settings/settings-domains.tsx"),
  "utf8"
);
const followUpSendSource = readFileSync(
  join(process.cwd(), "src/lib/api/services/lead-follow-up-send-service.ts"),
  "utf8"
);
const englishSettings = JSON.parse(
  readFileSync(
    join(process.cwd(), "src/i18n/dictionaries/en/settings.json"),
    "utf8"
  )
) as Record<string, string>;
const spanishSettings = JSON.parse(
  readFileSync(
    join(process.cwd(), "src/i18n/dictionaries/es/settings.json"),
    "utf8"
  )
) as Record<string, string>;

describe("one-tap follow-up template settings", () => {
  it("keeps the company template editable and persists the full lifecycle config", () => {
    expect(lifecycleSettingsSource).toContain(
      "value={config.follow_up_template_body}"
    );
    expect(lifecycleSettingsSource).toContain(
      "updateConfig({ follow_up_template_body: event.target.value })"
    );
    expect(lifecycleSettingsSource).toContain(
      'fetch("/api/settings/lifecycle", {'
    );
    expect(lifecycleSettingsSource).toContain(
      "body: JSON.stringify({ companyId, config })"
    );
  });

  it("gates the settings surface with the same company permission as its API", () => {
    expect(settingsDomainsSource).toMatch(
      /\{ id: "lifecycle",[\s\S]*?permission: "settings\.company",[\s\S]*?component: LifecycleSettingsTab/
    );
  });

  it("states exactly what the subject, body, and save action control", () => {
    expect(englishSettings["lifecycle.templateBody"]).toBe(
      "The body is used for one-tap follow-ups. The subject is used for local drafts. Saving sends nothing."
    );
    expect(spanishSettings["lifecycle.templateBody"]).toBe(
      "El cuerpo se usa en seguimientos de un toque. El asunto se usa en borradores locales. Guardar no envía nada."
    );
  });

  it("uses the stored company body at the one-tap provider boundary", () => {
    expect(followUpSendSource).toContain('.select("follow_up_template_body")');
    expect(followUpSendSource).toContain(
      "normalizedText(settings.follow_up_template_body)"
    );
  });
});
