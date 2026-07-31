import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import en from "@/i18n/dictionaries/en/external-api-docs.json";
import { ApiReferencePage } from "@/app/developers/api/_components/api-reference-page";
import { externalApiCodeExamples } from "@/lib/external-api/docs/code-examples";
import { externalApiReference } from "@/lib/external-api/docs/reference";
import { metadata } from "@/app/developers/api/page";

function renderReference() {
  return render(
    <ApiReferencePage
      copy={en}
      reference={externalApiReference}
      codeExamples={externalApiCodeExamples}
    />
  );
}

describe("public external API reference page", () => {
  it("presents itself as a professional OPS API reference", () => {
    renderReference();

    expect(metadata).toMatchObject({
      title: "External Lead API Reference",
      description: expect.stringContaining("lead intake"),
    });
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "External Lead API",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "API reference" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download OpenAPI" })
    ).toHaveAttribute("href", "/developers/api/openapi.json");
    expect(screen.getByText("REST API · V1")).toBeInTheDocument();
    expect(screen.getAllByText("https://app.opsapp.co").length).toBeGreaterThan(
      0
    );
  });

  it("renders all six OpenAPI operations exactly once", () => {
    const { container } = renderReference();

    for (const operation of externalApiReference.operations) {
      const section = container.querySelectorAll(
        `[data-operation-id="${operation.operationId}"]`
      );
      expect(section).toHaveLength(1);
      expect(
        within(section[0] as HTMLElement).getByText(operation.path)
      ).toBeInTheDocument();
      expect(
        within(section[0] as HTMLElement).getByRole("heading", {
          name: operation.summary,
        })
      ).toBeInTheDocument();
      expect(
        within(section[0] as HTMLElement).getByText(
          operation.requiredScopes[0] as string
        )
      ).toBeInTheDocument();
    }
  });

  it("makes the original-submission and server-only credential boundaries explicit", () => {
    renderReference();

    expect(
      screen.getByRole("heading", { name: "Original submission only" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Send the original form submission. OPS captures later messages and attachments from the email thread."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keep every OPS credential on your server. Never place it in browser code, a mobile app, or a public repository."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The browser receives only the single-use upload capability returned by your server."
      )
    ).toBeInTheDocument();
  });

  it("provides accessible request-language tabs and copy controls", async () => {
    const user = userEvent.setup();
    renderReference();

    const firstOperation = screen
      .getAllByRole("region", { name: /request example/i })
      .at(0);
    expect(firstOperation).toBeDefined();
    const tabs = within(firstOperation as HTMLElement).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "HTTP / cURL",
      "JavaScript",
      "TypeScript",
      "PHP",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    await user.click(tabs[2] as HTMLElement);

    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(
      within(firstOperation as HTMLElement).getByRole("button", {
        name: "Copy TypeScript example",
      })
    ).toBeInTheDocument();
  });

  it("includes operational guidance without a live console or credential form", () => {
    renderReference();

    expect(
      screen.getByRole("heading", { name: "Errors and retries" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Limits and security" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Lead synchronization" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/try it/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/console/i)).not.toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toContain("norcut");
  });
});
