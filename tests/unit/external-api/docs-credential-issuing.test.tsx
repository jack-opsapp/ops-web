import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ApiReferencePage } from "@/app/developers/api/_components/api-reference-page";
import { WEBSITE_SETTINGS_PATH } from "@/app/developers/api/_components/credential-issuing";
import { externalApiCodeExamples } from "@/lib/external-api/docs/code-examples";
import { getExternalApiDocsCopy } from "@/lib/external-api/docs/copy";
import { externalApiReference } from "@/lib/external-api/docs/reference";
import { SETTINGS_DOMAINS } from "@/components/settings/settings-domains";

vi.mock("@/components/settings/settings-domains", async () => {
  // The docs page is public and must never import the authenticated settings
  // shell. The domain registry is imported here only to assert that the deep
  // link targets a section id that really exists.
  return await vi.importActual("@/components/settings/settings-domains");
});

function renderPage(locale: "en" | "es" = "en") {
  return render(
    <ApiReferencePage
      copy={getExternalApiDocsCopy(locale)}
      reference={externalApiReference}
      codeExamples={externalApiCodeExamples}
    />
  );
}

describe("developer reference — Get a credential", () => {
  it("tells an integrator who issues a credential and where, before authentication", () => {
    renderPage();

    const section = document.getElementById("get-a-credential");
    expect(section).not.toBeNull();
    expect(
      within(section as HTMLElement).getByRole("heading", {
        level: 2,
        name: "Get a credential",
      })
    ).toBeInTheDocument();

    const authentication = document.getElementById("authentication");
    expect(
      (section as HTMLElement).compareDocumentPosition(
        authentication as HTMLElement
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const scoped = within(section as HTMLElement);
    expect(scoped.getByText("Settings → Comms → Website")).toBeInTheDocument();
    expect(scoped.getAllByText(/Integration settings/).length).toBeGreaterThan(0);
    expect(scoped.getByText(/exactly once/)).toBeInTheDocument();
  });

  it("walks the three issuing steps in order using the real button labels", () => {
    renderPage();
    const section = document.getElementById("get-a-credential") as HTMLElement;
    const steps = within(section)
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("heading", { level: 3 }).textContent);

    expect(steps).toEqual([
      "Register the website",
      "Create an intake credential",
      "Store the secret once",
    ]);
    expect(within(section).getByText("Connect website")).toBeInTheDocument();
    expect(within(section).getByText("Create intake key")).toBeInTheDocument();
    expect(within(section).getByText("Copy key")).toBeInTheDocument();
  });

  it("deep-links to the live Website settings section", () => {
    renderPage();
    const section = document.getElementById("get-a-credential") as HTMLElement;
    const link = within(section).getByRole("link", {
      name: "Open website settings",
    });
    expect(link).toHaveAttribute("href", WEBSITE_SETTINGS_PATH);

    const url = new URL(WEBSITE_SETTINGS_PATH, "https://app.opsapp.co");
    expect(url.pathname).toBe("/settings");
    const sectionId = url.searchParams.get("section");
    const registered = SETTINGS_DOMAINS.flatMap((domain) =>
      domain.sections.map((leaf) => leaf.id)
    );
    expect(registered).toContain(sectionId);
  });

  it("states all three scope names as the contract defines them", () => {
    renderPage();
    const authentication = document.getElementById("authentication") as HTMLElement;
    const terms = within(authentication)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(terms).toEqual([
      "intake.write",
      "analytics.leads.read",
      "analytics.financial.read",
    ]);
  });

  it("is reachable from the page index in both locales", () => {
    for (const locale of ["en", "es"] as const) {
      const { unmount } = renderPage(locale);
      const nav = screen.getByRole("navigation", {
        name: getExternalApiDocsCopy(locale).navigationLabel,
      });
      const links = within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect(links.indexOf("#get-a-credential")).toBeGreaterThan(
        links.indexOf("#overview")
      );
      expect(links.indexOf("#get-a-credential")).toBeLessThan(
        links.indexOf("#authentication")
      );
      unmount();
    }
  });
});
