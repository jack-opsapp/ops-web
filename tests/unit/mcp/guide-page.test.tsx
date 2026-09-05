import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { McpGuidePage } from "@/app/developers/mcp/_components/mcp-guide-page";
import { getMcpDocsCopy } from "@/lib/agent-control-plane/mcp/docs/copy";
import { resolvePublicMcpReference } from "@/lib/agent-control-plane/mcp/docs/reference";

function renderGuide() {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";
  return render(
    <McpGuidePage
      copy={getMcpDocsCopy("en")}
      reference={resolvePublicMcpReference()}
    />
  );
}

function renderSpanishGuide() {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";
  return render(
    <McpGuidePage
      copy={getMcpDocsCopy("es")}
      reference={resolvePublicMcpReference("es")}
    />
  );
}

function sectionNamed(name: RegExp): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

describe("public MCP developer guide", () => {
  it("renders the Spanish source-derived catalog without English fallback copy", () => {
    renderSpanishGuide();

    expect(
      screen.getByText(
        "Busca clientes a los que puedes acceder por nombre, correo electrónico exacto o teléfono exacto. Nunca devuelve los datos de contacto."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ver tus trabajos y su estado")
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      "Find customers you can access by name"
    );
    expect(document.body).not.toHaveTextContent("Access: read");
    expect(document.body).toHaveTextContent("Acceso: Solo lectura");
    expect(
      screen.getByRole("textbox", { name: "Correo de trabajo" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: "¿Qué debería hacer la herramienta?",
      })
    ).toBeInTheDocument();
  });

  it("renders the active source-derived counts and field-grounded examples", () => {
    renderGuide();

    expect(
      screen.getByRole("heading", { level: 1, name: "OPS MCP server" })
    ).toBeInTheDocument();

    const overview = sectionNamed(/^OPS MCP server$/i);
    expect(overview).toHaveTextContent(/available tools\s*35/i);
    expect(overview).toHaveTextContent(/permission scopes\s*21/i);
    const pageText = document.body.textContent ?? "";
    expect(pageText).toMatch(/latest site visit.*still needs follow-up/i);
    expect(pageText).toMatch(/deck design geometry.*(?:this|the) job/i);
    expect(screen.getByText("list_site_visits")).toBeInTheDocument();
    expect(screen.getByText("get_deck_design_geometry")).toBeInTheDocument();
  });

  it("gives each supported host its real connection path and verification state", () => {
    renderGuide();

    const codex = sectionNamed(/^Codex$/i);
    const claude = sectionNamed(/^Claude$/i);
    const chatgpt = sectionNamed(/^ChatGPT$/i);

    expect(codex).toHaveTextContent(
      /codex mcp add ops --url https:\/\/app\.opsapp\.co\/api\/mcp/i
    );
    expect(claude).toHaveTextContent(
      /claude mcp add --transport http ops https:\/\/app\.opsapp\.co\/api\/mcp/i
    );
    expect(chatgpt).toHaveTextContent(/Developer mode/i);
    expect(chatgpt).toHaveTextContent(
      /not (?:yet )?listed in (?:the )?public plugin directory/i
    );

    expect(codex).toHaveTextContent(/34 read tools verified end to end/i);
    expect(claude).toHaveTextContent(
      /OAuth and (?:the )?original 11-tool catalog verified/i
    );
    expect(claude).toHaveTextContent(/current 35-tool acceptance pending/i);
    expect(chatgpt).toHaveTextContent(/registration path verified/i);
    expect(chatgpt).toHaveTextContent(
      /authenticated 35-tool acceptance pending/i
    );
  });

  it("states exact approval is required before business changes", () => {
    renderGuide();

    const boundary = sectionNamed(/you approve every change/i);
    expect(boundary).toHaveTextContent(
      /business changes require your approval inside OPS/i
    );
    expect(boundary).toHaveTextContent(/no sends/i);
    expect(boundary).toHaveTextContent(
      /prepare exact customer notes or lead updates/i
    );
  });

  it("explains OAuth, server-enforced permissions, and revocation", () => {
    renderGuide();

    const security = sectionNamed(/security and permissions/i);
    expect(security).toHaveTextContent(/OAuth/i);
    expect(security).toHaveTextContent(/PKCE(?:\s+S256)?/i);
    expect(security).toHaveTextContent(
      /company and operator permissions.*every request/i
    );
    expect(security).toHaveTextContent(/revoke access/i);
  });

  it("embeds a semantic two-field request form without soliciting secrets or records", () => {
    renderGuide();

    const heading = screen.getByRole("heading", { name: /request a tool/i });
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    const form = within(section as HTMLElement).getByRole("form", {
      name: "Request a tool",
    });

    expect(
      within(form).getByRole("textbox", { name: "Work email" })
    ).toBeRequired();
    expect(
      within(form).getByRole("textbox", {
        name: "What should the tool do?",
      })
    ).toBeRequired();
    expect(within(form).getAllByRole("textbox")).toHaveLength(2);
    expect(
      within(form).getByRole("button", { name: "Send request" })
    ).toBeInTheDocument();
    expect(section?.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(section).toHaveTextContent(
      /do not (?:send|include) passwords, (?:access )?tokens, or customer records/i
    );
  });

  it("cross-links the REST API when the page owns the shared developer header", () => {
    renderGuide();

    const header = screen.queryByRole("banner");
    if (header === null) return;

    expect(
      within(header).getByRole("link", { name: /REST API/i })
    ).toHaveAttribute("href", "/developers/api");
  });
});
