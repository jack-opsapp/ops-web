import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { McpGuidePage } from "@/app/developers/mcp/_components/mcp-guide-page";
import { OPS_SUPPORT_EMAIL } from "@/lib/email/constants";
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
  });

  it("renders the active source-derived counts and field-grounded examples", () => {
    renderGuide();

    expect(
      screen.getByRole("heading", { level: 1, name: "OPS MCP server" })
    ).toBeInTheDocument();

    const overview = sectionNamed(/^OPS MCP server$/i);
    expect(overview).toHaveTextContent(/available tools\s*34/i);
    expect(overview).toHaveTextContent(/read scopes\s*20/i);
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

    expect(codex).toHaveTextContent(
      /full 34-tool catalog verified end to end/i
    );
    expect(claude).toHaveTextContent(
      /OAuth and (?:the )?original 11-tool catalog verified/i
    );
    expect(claude).toHaveTextContent(/current 34-tool acceptance pending/i);
    expect(chatgpt).toHaveTextContent(/registration path verified/i);
    expect(chatgpt).toHaveTextContent(
      /authenticated 34-tool acceptance pending/i
    );
  });

  it("states the read-only boundary without implying send or edit authority", () => {
    renderGuide();

    const boundary = sectionNamed(/read-only/i);
    expect(boundary).toHaveTextContent(/read-only/i);
    expect(boundary).toHaveTextContent(/no sends/i);
    expect(boundary).toHaveTextContent(/no edits/i);
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

  it("routes tool requests to support without soliciting secrets or records", () => {
    renderGuide();

    expect(
      screen.getByRole("heading", { name: /request a tool/i })
    ).toBeInTheDocument();

    const supportAddress = screen.getByText(OPS_SUPPORT_EMAIL, { exact: true });
    const supportLink = supportAddress.closest("a");
    expect(supportLink).not.toBeNull();

    const href = supportLink?.getAttribute("href") ?? "";
    expect(href).toMatch(
      new RegExp(`^mailto:${OPS_SUPPORT_EMAIL.replace(".", "\\.")}\\?`)
    );
    expect(href).toContain("subject=OPS%20MCP%20tool%20request");
    expect(document.body.textContent).toMatch(
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
